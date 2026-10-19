import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
const root = path.resolve("test-output", "option-sizing-delete-" + Date.now());
const env = { ...process.env, MATHECA_TEST_DATA: root };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({
    executablePath: process.env.MATHECA_EXE,
    env,
    args: [
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
    ],
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("h1").waitFor();
  const id = await page.evaluate(async () => {
    await window.matheca.examples();
    const base = (await window.matheca.state()).questions[0];
    const figures = Array.from({ length: 5 }, (_, i) => {
      const c = document.createElement("canvas");
      c.width = 300;
      c.height = 150 + i * 15;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#edf3ff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = "#2967e9";
      ctx.font = "28px sans-serif";
      ctx.fillText(i ? "ABCD"[i - 1] : "STEM", 30, 60);
      return c.toDataURL("image/png");
    });
    await window.matheca.saveQuestion({
      ...base,
      kind: "选择题",
      body: "以下图象中，正确的是（　）。",
      figures,
      figurePlacements: ["stem", "A", "B", "C", "D"],
      figureWidths: [75, 20, 40, 60, 80],
    });
    await window.matheca.saveCollection({
      id: "option-sizing",
      title: "选项尺寸验证",
      paperTitle: "选项尺寸验证",
      createdAt: String(Date.now()),
      examInstructions: "",
      examMinutes: 0,
      totalScore: 0,
    });
    await window.matheca.addQuestions("option-sizing", [base.id]);
    return base.id;
  });
  const card = page.locator(`.question-card[data-question-id="${id}"]`);
  await card.click();
  const width = page.getByRole("spinbutton", {
    name: "选项图片统一宽度（毫米）",
    exact: true,
  });
  await width.waitFor();
  assert.equal(await width.getAttribute("placeholder"), "各图不同");
  await width.fill("50");
  await width.press("Enter");
  const individual = async () =>
    page
      .locator(".question-figures input[type=number]")
      .evaluateAll((xs) => xs.map((x) => x.value));
  assert.deepEqual(await individual(), ["75", "50", "50", "50", "50"]);
  await page
    .getByRole("slider", { name: "选项图片统一宽度滑块", exact: true })
    .fill("60");
  assert.deepEqual(await individual(), ["75", "60", "60", "60", "60"]);
  await page.getByRole("button", { name: "全部自动大小", exact: true }).click();
  assert.deepEqual(await individual(), ["75", "", "", "", ""]);
  await width.fill("50");
  await width.press("Enter");
  await page.waitForTimeout(450);
  const sizes = await page
    .locator(".editor .choice-preview img")
    .evaluateAll((xs) =>
      xs.map((x) => ({
        width: x.getBoundingClientRect().width,
        ratio:
          x.getBoundingClientRect().width / x.getBoundingClientRect().height,
        natural: x.naturalWidth / x.naturalHeight,
      })),
    );
  assert.equal(sizes.length, 4);
  for (const size of sizes) {
    assert.ok(Math.abs(size.width - (50 * 96) / 25.4) < 1);
    assert.ok(Math.abs(size.ratio - size.natural) < 0.01);
  }
  await page.locator(".option-figure-size").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "test-output/option-sizing-delete-desktop.png",
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1024, 700),
  );
  await page.waitForTimeout(450);
  await page.locator(".option-figure-size").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-output/option-sizing-delete-small.png" });
  const footer = page.locator(".editor-footer");
  assert.equal(
    await footer
      .locator("button")
      .evaluateAll(
        (xs) => new Set(xs.map((x) => x.getBoundingClientRect().height)).size,
      ),
    1,
  );
  await page.getByRole("button", { name: "确认已校对", exact: true }).click();
  await page.locator(".editor").waitFor({ state: "hidden" });
  const getQuestion = () =>
    page.evaluate(
      async (id) =>
        (await window.matheca.state()).questions.find((q) => q.id === id),
      id,
    );
  const q = await getQuestion();
  assert.deepEqual(q.figureWidths, [75, 50, 50, 50, 50]);
  const printWidths = await app.evaluate(async ({ BrowserWindow }, q) => {
    const main = BrowserWindow.getAllWindows().find((w) => w.isVisible());
    const host = new BrowserWindow({
      show: false,
      width: 3200,
      height: 3200,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    try {
      await host.loadURL(
        main.webContents.getURL().replace(/index\.html$/, "render.html"),
      );
      return await host.webContents.executeJavaScript(
        `(async()=>{await window.renderEngine.prepare([${JSON.stringify(q)}],{paperTitle:'',examInstructions:'',examMinutes:0,totalScore:0});return [...document.querySelectorAll('.question-figure')].map(x=>x.getBoundingClientRect().width)})()`,
      );
    } finally {
      host.destroy();
    }
  }, q);
  assert.deepEqual(
    printWidths.map((x) => Math.round((x * 25.4) / 96)),
    [75, 50, 50, 50, 50],
  );
  assert.equal(await card.locator(".card-review").innerText(), "修改");
  await card.locator(".card-review").click();
  await width.waitFor();
  assert.equal(await width.inputValue(), "50");
  await width.fill("60");
  await width.press("Enter");
  const body = page.locator(".editor textarea").first();
  await body.fill("以下图象中，正确的是（　）。删除前的修改需要撤销恢复。");
  const deletion = page.getByRole("button", {
    name: "长按删除此题",
    exact: true,
  });
  await deletion.click();
  assert.ok(await getQuestion());
  await deletion.focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(450);
  const progress = await deletion.evaluate((el) =>
    Number(el.style.getPropertyValue("--hold-progress")),
  );
  assert.ok(progress > 0.1 && progress < 1);
  await page.keyboard.up("Space");
  assert.ok(await getQuestion());
  await deletion.focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(1450);
  await page.keyboard.up("Space");
  await page.locator(".editor").waitFor({ state: "hidden" });
  assert.equal(await getQuestion(), undefined);
  await page
    .locator(".swipe-toast")
    .getByRole("button", { name: "撤销", exact: true })
    .click();
  await card.waitFor();
  const restored = await getQuestion();
  assert.deepEqual(restored.figureWidths, [75, 60, 60, 60, 60]);
  assert.ok(restored.body.includes("删除前的修改"));
  const state = await page.evaluate(() => window.matheca.state());
  assert.ok(
    state.items.some(
      (i) => i.collectionId === "option-sizing" && i.questionId === id,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: uniform option widths, auto/reset, stem isolation, aspect ratios, persistence, print widths, matching footer height, short/cancelled/full hold, delete undo with edits and collection membership; normal/minimum screenshots. Isolated data: " +
      root,
  );
} finally {
  await app?.close();
}
