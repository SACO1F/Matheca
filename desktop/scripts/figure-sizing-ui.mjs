import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import yauzl from "yauzl";

const env = {
  ...process.env,
  MATHECA_TEST_DATA: path.resolve(
    "test-output",
    "figure-sizing-" + Date.now(),
  ),
};
delete env.ELECTRON_RUN_AS_NODE;
const launch = () =>
  electron.launch({
    executablePath: process.env.MATHECA_EXE,
    args: [
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
    ],
    env,
  });
let app = await launch();
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("h1").waitFor();
  const id = await page.evaluate(async () => {
    await window.matheca.examples();
    const base = (await window.matheca.state()).questions[0];
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 200;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#2967e9";
    ctx.fillRect(0, 0, 400, 200);
    const figure = canvas.toDataURL("image/png");
    await window.matheca.saveQuestion({
      ...base,
      figures: [figure, figure],
      figureWidths: [0, 120],
    });
    for (const id of ["size-paper", "delete-paper"]) {
      await window.matheca.saveCollection({
        id,
        title: id,
        createdAt: Date.now().toString(),
        paperTitle: "图片尺寸验证",
        examInstructions: "",
        examMinutes: 0,
        totalScore: 0,
      });
      await window.matheca.addQuestions(id, [base.id]);
    }
    return base.id;
  });
  const card = page.locator(`.question-card[data-question-id="${id}"]`);
  await card.click();
  const width = page.getByRole("spinbutton", {
    name: "图形 1 宽度（毫米）",
    exact: true,
  });
  await width.fill("100");
  await width.press("Enter");
  const image = page.locator(".question-figures img").first();
  await image.evaluate((img) => img.decode());
  await page.waitForTimeout(150);
  const size = await image.boundingBox();
  assert.ok(
    Math.abs(size.width - (100 * 96) / 25.4) < 3,
    `width ${size.width}`,
  );
  assert.ok(Math.abs(size.width / size.height - 2) < 0.02);
  await width.fill("999");
  await width.press("Enter");
  assert.equal(await width.inputValue(), "160");
  await width.fill("100");
  await width.press("Enter");
  await page
    .locator(".question-figures figure")
    .first()
    .getByRole("button", { name: "自动大小", exact: true })
    .click();
  assert.equal(await width.inputValue(), "");
  await page
    .getByRole("slider", { name: "图形 1 宽度滑块", exact: true })
    .fill("100");
  await page.screenshot({ path: "test-output/figure-sizing-desktop.png" });
  // Removing the first image must preserve the second image's saved width.
  await page.getByRole("button", { name: "移除图形 1", exact: true }).click();
  assert.equal(await width.inputValue(), "120");
  await width.fill("100");
  await width.press("Enter");
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.waitForTimeout(600);
  const q = await page.evaluate(
    async (id) =>
      (await window.matheca.state()).questions.find((q) => q.id === id),
    id,
  );
  assert.deepEqual(q.figureWidths, [100]);
  assert.equal(q.figures.length, 1);
  const cardImage = card.locator(".card-figures img");
  await cardImage.evaluate((img) => img.decode());
  const cardSize = await cardImage.boundingBox();
  assert.ok(Math.abs(cardSize.width - (100 * 96) / 25.4) < 3);
  // Exercise the packaged print renderer used by both PDF preview and export.
  const printSize = await app.evaluate(async ({ BrowserWindow }, q) => {
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
        `(async()=>{await window.renderEngine.prepare([${JSON.stringify(q)}],{paperTitle:'',examInstructions:'',examMinutes:0,totalScore:0}); const img=document.querySelector('.question-figure');return {width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height};})()`,
      );
    } finally {
      host.destroy();
    }
  }, q);
  assert.ok(Math.abs(printSize.width - (100 * 96) / 25.4) < 1);
  assert.ok(Math.abs(printSize.width / printSize.height - 2) < 0.01);
  await app.evaluate(({ dialog }, folder) => {
    dialog.showMessageBox = async () => ({ response: 0 });
    dialog.showSaveDialog = async (_w, options) => ({
      canceled: false,
      filePath: pathUnused(folder, options.defaultPath),
    });
    function pathUnused(folder, file) {
      return folder + "/" + file;
    }
  }, env.MATHECA_TEST_DATA);
  const exports = await page.evaluate(async () => ({
    pdf: await window.matheca.exportCollection("size-paper", "pdf"),
    docx: await window.matheca.exportCollection("size-paper", "docx"),
  }));
  assert.ok(
    fs.readFileSync(exports.pdf.path).includes(Buffer.from("/Subtype /Image")),
  );
  const xml = await new Promise((resolve, reject) =>
    yauzl.open(exports.docx.path, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on("error", reject);
      zip.on("entry", (entry) => {
        if (entry.fileName !== "word/document.xml") return zip.readEntry();
        zip.openReadStream(entry, (err, stream) => {
          if (err) return reject(err);
          const chunks = [];
          stream.on("data", (c) => chunks.push(c));
          stream.on("end", () => {
            resolve(Buffer.concat(chunks).toString());
            zip.close();
          });
        });
      });
      zip.readEntry();
    }),
  );
  assert.ok(
    xml.includes('cx="3600000" cy="1800000"'),
    "Word stores 100mm width with original ratio",
  );
  const nav = (name) =>
    page.locator(".sidebar").getByRole("button", { name, exact: true });
  await nav("题集").click();
  await page
    .locator(".collection-card")
    .filter({ hasText: "delete-paper" })
    .click();
  const deletion = page.getByRole("button", {
    name: "长按删除题集",
    exact: true,
  });
  await deletion.click();
  assert.ok(
    (await page.evaluate(() => window.matheca.state())).collections.some(
      (c) => c.id === "delete-paper",
    ),
  );
  await deletion.press("Space", { delay: 400 });
  assert.ok(
    (await page.evaluate(() => window.matheca.state())).collections.some(
      (c) => c.id === "delete-paper",
    ),
  );
  await page.waitForTimeout(200);
  await page.screenshot({ path: "test-output/collection-delete-hold.png" });
  await deletion.press("Space", { delay: 1400 });
  await page.waitForTimeout(250);
  const state = await page.evaluate(() => window.matheca.state());
  assert.ok(!state.collections.some((c) => c.id === "delete-paper"));
  assert.ok(state.questions.some((q) => q.id === id));
  assert.ok(
    state.items.some(
      (i) => i.collectionId === "size-paper" && i.questionId === id,
    ),
  );
  assert.deepEqual(errors, []);
  await app.close();
  app = await launch();
  const reopened = await app.firstWindow();
  await reopened.locator("h1").waitFor();
  assert.deepEqual(
    await reopened.evaluate(
      async (id) =>
        (await window.matheca.state()).questions.find((q) => q.id === id)
          .figureWidths,
      id,
    ),
    [100],
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1024, 700),
  );
  await reopened.locator(`.question-card[data-question-id="${id}"]`).click();
  await reopened
    .getByRole("spinbutton", { name: "图形 1 宽度（毫米）", exact: true })
    .waitFor();
  assert.ok(
    await reopened.evaluate(
      () => document.documentElement.scrollWidth === innerWidth,
    ),
  );
  await reopened.waitForTimeout(600);
  await reopened.screenshot({ path: "test-output/figure-sizing-minimum.png" });
  console.log(
    "PASS: image widths, reset, clamp, aligned removal, persistence/restart, card/print renderer/Word sizing, real PDF export, short/long collection hold, original questions retained, minimum window",
  );
} finally {
  await app.close();
}
