import { _electron as electron } from "playwright";
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
const env = {
  ...process.env,
  MATHECA_TEST_DATA: path.resolve(
    "test-output",
    "sidebar-performance-" + Date.now(),
  ),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.MATHECA_EXE,
  env,
  args: [
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
  ],
});
try {
  const page = await app.firstWindow();
  await page.locator("h1").waitFor();
  await page.evaluate(() => window.matheca.examples());
  const base = (await page.evaluate(() => window.matheca.state()))
    .questions[0];
  const db = new Database(path.join(env.MATHECA_TEST_DATA, "library.sqlite"));
  const insert = db.prepare("INSERT INTO questions VALUES(?,?,?)");
  const image =
    "data:image/png;base64," +
    fs.readFileSync("assets/vision-test.png").toString("base64");
  db.transaction(() => {
    for (let i = 0; i < 97; i++) {
      const q = {
        ...base,
        id: "perf-" + i,
        body: base.body + "\n" + base.body + "\n" + base.body,
        createdAt: String(Date.now() + i),
        figures: i % 4 === 0 ? [image] : [],
        figureWidths: i % 4 === 0 ? [40] : [],
        figurePlacements: i % 4 === 0 ? ["stem"] : [],
      };
      insert.run(q.id, Number(q.createdAt), JSON.stringify(q));
    }
  })();
  db.close();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .webContents.send("state:changed"),
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".question-card").length === 100,
  );
  await page.waitForTimeout(500);
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  const metrics = async () =>
    Object.fromEntries(
      (await client.send("Performance.getMetrics")).metrics.map((m) => [
        m.name,
        m.value,
      ]),
    );
  const results = [];
  for (const label of Array.from({ length: 20 }, (_, i) =>
    i % 2 ? "收起" : "展开",
  )) {
    const before = await metrics();
    await page.evaluate(() => {
      window.perfFrames = [];
      let prev = performance.now();
      const end = prev + 700;
      const tick = (now) => {
        window.perfFrames.push(now - prev);
        prev = now;
        if (now < end) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page
      .getByRole("button", {
        name: label === "展开" ? "显示侧边栏" : "隐藏侧边栏",
        exact: true,
      })
      .click();
    await page.waitForTimeout(750);
    const after = await metrics();
    const frames = await page.evaluate(() => window.perfFrames);
    results.push({
      action: label,
      layouts: after.LayoutCount - before.LayoutCount,
      styleRecalculations: after.RecalcStyleCount - before.RecalcStyleCount,
      layoutMs: Math.round(
        (after.LayoutDuration - before.LayoutDuration) * 1000,
      ),
      scriptMs: Math.round(
        (after.ScriptDuration - before.ScriptDuration) * 1000,
      ),
      longFrames: frames.filter((t) => t > 50).length,
      maxFrameMs: Math.round(Math.max(...frames)),
    });
  }
  console.log("100-card sidebar measurements: " + JSON.stringify(results));
  const percentile = (values, p) =>
    values.sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
  const summaries = ["展开", "收起"].map((action) => {
    const samples = results.filter((r) => r.action === action);
    return {
      action,
      samples: samples.length,
      layoutP50: percentile(
        samples.map((r) => r.layoutMs),
        0.5,
      ),
      layoutP95: percentile(
        samples.map((r) => r.layoutMs),
        0.95,
      ),
      longFrames: samples.reduce((sum, r) => sum + r.longFrames, 0),
      longestFrame: Math.max(...samples.map((r) => r.maxFrameMs)),
    };
  });
  console.log(
    "Mixed text/formula/image P50/P95 summary: " + JSON.stringify(summaries),
  );
  fs.writeFileSync(
    path.join(env.MATHECA_TEST_DATA, "performance.md"),
    "# 100 张混合题卡侧边栏，20 次切换\n\n" +
      summaries
        .map(
          (r) =>
            `${r.action}：${r.samples} 次，布局 P50 ${r.layoutP50}ms / P95 ${r.layoutP95}ms；超过 50ms 帧 ${r.longFrames} 个，最长 ${r.longestFrame}ms。`,
        )
        .join("\n\n") +
      "\n",
  );
  if (!process.argv.includes("--baseline")) {
    for (const r of results)
      assert.ok(
        r.layouts < 12,
        "sidebar should settle layout once instead of relayout every animation frame: " +
          JSON.stringify(r),
      );
    for (let i = 0; i < 6; i++) {
      await page
        .getByRole("button", {
          name: i % 2 ? "隐藏侧边栏" : "显示侧边栏",
          exact: true,
        })
        .click();
      await page.waitForTimeout(45);
    }
    await page.waitForTimeout(600);
    assert.equal(
      await page
        .locator(".knowledge-slot")
        .evaluate((el) => el.getBoundingClientRect().width),
      0,
    );
    assert.equal(
      await page
        .locator(".workspace")
        .evaluate((el) => getComputedStyle(el).transform),
      "none",
    );
    assert.equal(await page.locator(".question-card").count(), 100);
    await page.screenshot({ path: "test-output/sidebar-closed.png" });
    await page.getByRole("button", { name: "显示侧边栏", exact: true }).click();
    await page.waitForTimeout(450);
    await page.screenshot({ path: "test-output/sidebar-open.png" });
    // The FAB floats over the original full-height layout. At the end of the
    // scroll, trailing space must lift the final card above the button.
    for (const factor of [1, 1.25, 1.5, 2]) {
      await client.send("Emulation.setDeviceMetricsOverride", {
        width: 1024,
        height: 700,
        deviceScaleFactor: factor,
        mobile: false,
      });
      await page.waitForTimeout(500);
      await page.waitForFunction(
        () => !document.querySelector('.masonry-grid[data-moving="true"]'),
      );
      await page.evaluate(() => {
        const cards = document.querySelector(".cards");
        cards.scrollTop = cards.scrollHeight;
      });
      await page.waitForTimeout(250);
      assert.ok(
        await page.evaluate(() => {
          const cards = document.querySelector(".cards");
          const last = [...cards.querySelectorAll(".question-card")].at(-1);
          const fab = document.querySelector(".fab").getBoundingClientRect();
          return (
            parseFloat(
              getComputedStyle(document.querySelector(".workspace"))
                .paddingBottom,
            ) === 0 &&
            last.getBoundingClientRect().bottom <= fab.top &&
            document.documentElement.scrollWidth <= innerWidth
          );
        }),
        `minimum window at emulated DPI ${factor}: end scrolling clears the floating shortcut`,
      );
    }
    await client.send("Emulation.clearDeviceMetricsOverride");
    await page.waitForTimeout(150);
    for (let i = 0; i < 20; i++) {
      await page
        .locator(".question-card")
        .nth(i % 5)
        .click();
      await page.locator(".editor").waitFor();
      await page
        .getByRole("button", { name: "关闭题目校对", exact: true })
        .click();
      await page.locator(".editor").waitFor({ state: "detached" });
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "隐藏侧边栏", exact: true }).click();
    await page.waitForTimeout(80);
    assert.equal(
      await page
        .locator(".workspace")
        .evaluate(
          (el) =>
            el.getAnimations().filter((a) => a.playState === "running").length,
        ),
      0,
    );
    console.log(
      "PASS: bounded layout work, rapid reversals, final geometry, full list preserved, reduced motion; isolated packaged EXE.",
    );
  }
} finally {
  await app.close();
}
