import { _electron as electron } from "playwright";
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const output = path.resolve("test-output", `editor-performance-${Date.now()}`);
const data = path.join(output, "data");
fs.mkdirSync(output, { recursive: true });
const exe =
  process.env.MATHECA_EXE ||
  fs
    .readFileSync("releases/latest.txt", "utf8")
    .match(/^EXE: (.+)$/m)[1]
    .trim();
const env = { ...process.env, MATHECA_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({ executablePath: exe, env });
const baseline = process.argv.includes("--baseline");
const measurements = [];
try {
  const page = await application.firstWindow();
  page.setDefaultTimeout(10000);
  await page.locator("h1").waitFor();
  await page.evaluate(() => window.matheca.examples());
  const base = (await page.evaluate(() => window.matheca.state()))
    .questions[0];
  const db = new Database(path.join(data, "library.sqlite"));
  const insert = db.prepare("INSERT INTO questions VALUES(?,?,?)");
  const image =
    "data:image/png;base64," +
    fs.readFileSync("assets/vision-test.png").toString("base64");
  db.transaction(() => {
    for (let i = 0; i < 97; i++) {
      const q = {
        ...base,
        id: `editor-stress-${i}`,
        body: Array.from({ length: 8 }, () => base.body).join("\n"),
        createdAt: String(Date.now() + i),
        figures: i % 4 === 0 ? [image] : [],
        figureWidths: i % 4 === 0 ? [40] : [],
        figurePlacements: i % 4 === 0 ? ["stem"] : [],
      };
      insert.run(q.id, Number(q.createdAt), JSON.stringify(q));
    }
  })();
  db.close();
  await page.reload();
  await page.waitForFunction(
    () => document.querySelectorAll(".question-card").length === 100,
  );
  await page.waitForTimeout(700);
  if (!baseline) {
    const widths = [];
    for (const width of [1024, 1440, 1800]) {
      await application.evaluate(
        ({ BrowserWindow }, width) =>
          BrowserWindow.getAllWindows()[0].setSize(width, 940),
        width,
      );
      widths.push(
        await page
          .locator(".question-card")
          .evaluateAll((cards) =>
            cards.map((card) => card.getBoundingClientRect().width),
          ),
      );
    }
    assert.ok(
      widths.flat().every((width) => Math.abs(width - 760) < 1),
      "all 100 cards retain 760px width across window sizes",
    );
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 940),
    );
    await page.screenshot({
      path: path.join(output, "fixed-width-library.png"),
    });
  }
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  const metrics = async () =>
    Object.fromEntries(
      (await client.send("Performance.getMetrics")).metrics.map((m) => [
        m.name,
        m.value,
      ]),
    );
  for (let round = 0; round < 4; round++) {
    await page
      .locator(".card-review")
      .nth(round === 3 ? 99 : round)
      .scrollIntoViewIfNeeded();
    const originalScroll = await page
      .locator(".library-list > .cards")
      .evaluate((el) => el.scrollTop);
    const before = await metrics(),
      start = Date.now();
    await page
      .locator(".card-review")
      .nth(round === 3 ? 99 : round)
      .click();
    await page.locator(".editor").waitFor();
    if (!baseline)
      assert.equal(
        await page
          .locator(".editor-reveal")
          .evaluate(
            (el) =>
              el
                .getAnimations({ subtree: true })
                .filter(
                  (animation) =>
                    animation.effect?.target === el ||
                    animation.effect?.target?.classList?.contains(
                      "editor-body",
                    ),
                ).length,
          ),
        0,
        "opening editor has no transition animation",
      );
    const body = page.getByRole("textbox", { name: "题干与小题", exact: true });
    const text = await body.inputValue();
    await body.click();
    await body.fill(text + "\n响应验证");
    const inputMs = Date.now() - start;
    assert.match(await body.inputValue(), /响应验证/);
    await page.waitForTimeout(650);
    const settled = await metrics();
    await page.waitForTimeout(550);
    const idle = await metrics();
    measurements.push({
      round,
      inputMs,
      layouts: Math.round(settled.LayoutCount - before.LayoutCount),
      idleLayouts: Math.round(idle.LayoutCount - settled.LayoutCount),
      layoutMs: Math.round(
        (settled.LayoutDuration - before.LayoutDuration) * 1000,
      ),
    });
    if (!baseline) {
      assert.ok(
        inputMs < 4000,
        `editor remains clickable and accepts input: ${inputMs}ms`,
      );
      assert.ok(
        idle.LayoutCount - settled.LayoutCount <= 4,
        "editor idle has no repeated relayout loop",
      );
      assert.equal(await page.locator(".card-expansion-surface").count(), 0);
    }
    if (round === 0)
      await page.screenshot({ path: path.join(output, "editor.png") });
    if (round === 3 && !baseline) await body.press("Control+Enter");
    else
      await page
        .getByRole("button", {
          name: baseline ? "关闭题目校对" : "确认已校对",
          exact: true,
        })
        .click();
    await page.locator(".editor").waitFor({ state: "detached" });
    if (!baseline) {
      await page.waitForFunction(
        (top) =>
          Math.abs(
            document.querySelector(".library-list > .cards").scrollTop - top,
          ) < 2,
        originalScroll,
      );
      assert.equal(await page.locator("h1").innerText(), "题库");
    }
  }
  fs.writeFileSync(
    path.join(output, "MEASUREMENTS.md"),
    "# 100题校对响应\n\n" +
      measurements
        .map(
          (m) =>
            `- 第${m.round + 1}次：点击到输入 ${m.inputMs}ms，布局 ${m.layouts} 次 / ${m.layoutMs}ms，稳定后额外布局 ${m.idleLayouts} 次。`,
        )
        .join("\n"),
  );
  console.log(
    (baseline ? "BASELINE" : "PASS") +
      ": " +
      output +
      " " +
      JSON.stringify(measurements),
  );
} finally {
  await application.close();
}
