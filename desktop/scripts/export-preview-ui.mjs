import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
const env = {
  ...process.env,
  MATHECA_TEST_DATA: path.resolve("test-output", "preview-" + Date.now()),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.MATHECA_EXE,
  args: [
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
  ],
  env,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("h1").waitFor();
  await page.evaluate(
    async (figure) => {
      await window.matheca.examples();
      const base = (await window.matheca.state()).questions[0];
      await window.matheca.saveCollection({
        id: "preview-paper",
        createdAt: Date.now().toString(),
        title: "导出预览验证",
        paperTitle: "预览主标题",
        examMinutes: 90,
        totalScore: 150,
        examInstructions: "检查公式、图片与题目排序。",
      });
      const ids = [];
      for (let index = 0; index < 12; index++) {
        const id = "preview-question-" + index;
        ids.push(id);
        await window.matheca.saveQuestion(
          {
            ...base,
            id,
            title: "分页题目" + index,
            kind: "解答题",
            body:
              `预览排序验证 ${index + 1}：计算 \\(x^2+1\\)。\n` +
              "请认真阅读题目，并写出推理与计算过程。\n".repeat(10),
            figures: index === 0 ? [figure] : [],
          },
          true,
        );
      }
      await window.matheca.addQuestions("preview-paper", ids);
    },
    "data:image/png;base64," +
      fs.readFileSync("assets/vision-test.png").toString("base64"),
  );
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "题集", exact: true })
    .click();
  await page
    .locator(".collection-card")
    .filter({ hasText: "导出预览验证" })
    .click();
  const cards = page.locator(".collection-question-list .question-card");
  const up = cards.first().getByRole("button", { name: "上移", exact: true });
  const down = cards.first().getByRole("button", { name: "下移", exact: true });
  assert.equal(await up.locator("svg").count(), 1);
  assert.equal(await down.locator("svg").count(), 1);
  assert.equal((await down.textContent()).trim(), "");
  assert.equal((await down.boundingBox()).width, 30);
  const remove = cards
    .first()
    .getByRole("button", { name: "从题集中删去", exact: true });
  const style = await remove.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, text: s.color, border: s.borderTopWidth };
  });
  assert.deepEqual(style, {
    bg: "rgb(239, 89, 98)",
    text: "rgb(255, 255, 255)",
    border: "1px",
  });
  const settings = page.locator(".collection-settings");
  const actionHeights = await page
    .locator(".collection-question-list .question-card")
    .first()
    .locator(".order-icon-button, .collection-remove, .card-review")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height),
    );
  assert.deepEqual(actionHeights, [30, 30, 30, 30]);
  const actionFonts = await cards
    .first()
    .locator(".collection-remove, .card-review")
    .evaluateAll((buttons) =>
      buttons.map((button) => getComputedStyle(button).fontSize),
    );
  assert.deepEqual(actionFonts, ["12px", "12px"]);
  const actionRadii = await cards
    .first()
    .locator(".collection-remove, .card-review")
    .evaluateAll((buttons) =>
      buttons.map((button) => getComputedStyle(button).borderRadius),
    );
  assert.deepEqual(actionRadii, ["8px", "8px"]);
  await settings
    .getByLabel("试卷主标题", { exact: true })
    .fill("最新文档设置预览");
  await app.evaluate(({ dialog }, folder) => {
    globalThis.exportDialogCalls = 0;
    globalThis.cancelExport = false;
    dialog.showSaveDialog = async (_win, options) => {
      globalThis.exportDialogCalls++;
      return globalThis.cancelExport
        ? { canceled: true }
        : { canceled: false, filePath: folder + "/" + options.defaultPath };
    };
  }, env.MATHECA_TEST_DATA);
  const pdf = settings.getByRole("button", { name: "导出 PDF", exact: true });
  const word = settings.getByRole("button", { name: "导出 Word", exact: true });
  const preview = page.getByRole("dialog", { name: "导出预览", exact: true });
  await pdf.click();
  await preview.locator("canvas.ready").waitFor();
  assert.equal(await app.evaluate(() => globalThis.exportDialogCalls), 0);
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).collections[0]
      .paperTitle,
    "最新文档设置预览",
  );
  const stats = await preview.locator("canvas").evaluate((canvas) => {
    const pixels = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100) dark++;
    return { width: canvas.width, height: canvas.height, dark };
  });
  assert.ok(stats.width > 800 && stats.height > 1000 && stats.dark > 100);
  assert.ok(
    await preview
      .getByRole("button", { name: "上一页", exact: true })
      .isDisabled(),
  );
  assert.ok(
    await preview
      .getByRole("button", { name: "下一页", exact: true })
      .isEnabled(),
  );
  await page.screenshot({ path: "test-output/export-preview-pdf.png" });
  await preview.getByRole("button", { name: "下一页", exact: true }).click();
  await preview.locator("canvas.ready").waitFor();
  assert.ok(
    (
      await preview.locator(".preview-page-controls span").textContent()
    ).startsWith("2 /"),
  );
  await preview.getByRole("button", { name: "上一页", exact: true }).click();
  await preview.locator("canvas.ready").waitFor();
  await preview.getByRole("button", { name: "放大预览", exact: true }).click();
  assert.equal(
    await preview.locator(".preview-zoom-controls span").textContent(),
    "125%",
  );
  await preview.getByRole("button", { name: "适应宽度", exact: true }).click();
  await preview.getByRole("button", { name: "返回编辑", exact: true }).click();
  await preview.waitFor({ state: "hidden" });
  assert.ok(await pdf.evaluate((el) => document.activeElement === el));
  assert.equal(await app.evaluate(() => globalThis.exportDialogCalls), 0);
  await pdf.click();
  await preview
    .getByRole("button", { name: "确认导出 PDF", exact: true })
    .click();
  await preview.waitFor({ state: "hidden" });
  assert.ok(
    fs.existsSync(path.join(env.MATHECA_TEST_DATA, "导出预览验证.pdf")),
  );
  await word.click();
  await preview.locator("canvas.ready").waitFor();
  assert.ok(await preview.locator(".word-preview-note").isVisible());
  await page.screenshot({ path: "test-output/export-preview-word.png" });
  await app.evaluate(() => {
    globalThis.cancelExport = true;
  });
  await preview
    .getByRole("button", { name: "确认导出 Word", exact: true })
    .click();
  await page.waitForFunction(
    () => !document.querySelector(".document-preview-footer .primary").disabled,
  );
  assert.ok(await preview.isVisible());
  assert.ok(
    !fs.existsSync(path.join(env.MATHECA_TEST_DATA, "导出预览验证.docx")),
  );
  await app.evaluate(() => {
    globalThis.cancelExport = false;
  });
  await preview
    .getByRole("button", { name: "确认导出 Word", exact: true })
    .click();
  await preview.waitFor({ state: "hidden" });
  assert.ok(
    fs.existsSync(path.join(env.MATHECA_TEST_DATA, "导出预览验证.docx")),
  );
  const win = await app.browserWindow(page);
  await win.evaluate((win) => win.setSize(900, 640));
  await pdf.click();
  await preview.locator("canvas.ready").waitFor();
  await page.screenshot({ path: "test-output/export-preview-minimum.png" });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.keyboard.press("Escape");
  await preview.waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: uniform 30px action buttons, SVG reorder icons, red/white outlined remove button, actual A4 PDF preview with formulas/images, pagination/zoom, latest settings, cancel without save dialog, PDF and Word confirmation, canceled save keeps preview, minimum window, Escape/focus.",
  );
} finally {
  await app.close();
}
