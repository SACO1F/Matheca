import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import yauzl from "yauzl";

const root = path.resolve("test-output", "image-choices-" + Date.now());
const env = { ...process.env, MATHECA_TEST_DATA: root };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({
    executablePath: process.env.MATHECA_EXE,
    env,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("h1").waitFor();
  const id = await page.evaluate(async () => {
    await window.matheca.examples();
    const base = (await window.matheca.state()).questions[0];
    const figures = [0, 1, 2, 3].map((type) => {
      const canvas = document.createElement("canvas");
      canvas.width = 300;
      canvas.height = 180;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 300, 180);
      ctx.strokeStyle = "#526070";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(20, 140);
      ctx.lineTo(280, 140);
      ctx.moveTo(150, 160);
      ctx.lineTo(150, 15);
      ctx.stroke();
      ctx.fillStyle = "#303948";
      ctx.font = "14px serif";
      ctx.fillText("x", 282, 145);
      ctx.fillText("y", 155, 18);
      ctx.fillText("O", 135, 156);
      ctx.strokeStyle = "#2967e9";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let x = 40; x <= 260; x++) {
        const a = (x - 150) / 55;
        const y =
          type === 0
            ? 140 - a * a * 26
            : type === 1
              ? 36 + a * a * 26
              : type === 2
                ? 140 - Math.abs(a) * 50
                : 90 - a * 38;
        if (x === 40) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      return canvas.toDataURL("image/png");
    });
    await window.matheca.saveQuestion({
      ...base,
      body: "下列图象中，能够表示函数 \\(y=x^2\\) 的是（　）。",
      kind: "选择题",
      figures,
      figureWidths: [160, 0, 0, 0],
      figurePlacements: ["A", "B", "C", "D"],
    });
    await window.matheca.saveCollection({
      id: "image-paper",
      title: "图片选项验证",
      paperTitle: "函数图象练习",
      examInstructions: "",
      examMinutes: 0,
      totalScore: 0,
      createdAt: String(Date.now()),
    });
    await window.matheca.addQuestions("image-paper", [base.id]);
    return base.id;
  });
  const source = path.join(root, "source.png");
  fs.copyFileSync(path.resolve("assets/vision-test.png"), source);
  const db = new Database(path.join(root, "library.sqlite"));
  const record = JSON.parse(
    db.prepare("SELECT data FROM questions WHERE id=?").get(id).data,
  );
  record.sourcePath = source;
  record.sourceLabel = "图片选项测试原图";
  db.prepare("UPDATE questions SET data=? WHERE id=?").run(
    JSON.stringify(record),
    id,
  );
  db.close();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .webContents.send("state:changed"),
  );
  const card = page.locator(`.question-card[data-question-id="${id}"]`);
  await card.locator(".choice-preview img").last().waitFor();
  assert.equal(await card.locator(".choice-preview-option").count(), 4);
  assert.equal(await card.locator(".card-figures img").count(), 0);
  await card
    .locator("img")
    .evaluateAll((images) => Promise.all(images.map((img) => img.decode())));
  await page.waitForTimeout(500);
  const cardBounds = await page
    .locator(".masonry-grid .question-card")
    .evaluateAll((cards) =>
      cards.map((card) => {
        const b = card.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom };
      }),
    );
  for (let i = 1; i < cardBounds.length; i++)
    assert.ok(
      cardBounds[i].top >= cardBounds[i - 1].bottom,
      "loaded choice images never overlap the next card",
    );
  await page.screenshot({ path: "test-output/image-choices-library.png" });
  const metrics = await page
    .locator(".sidebar button:has(.nav-icon)")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const svg = button.querySelector("svg"),
          b = button.getBoundingClientRect(),
          i = svg.getBoundingClientRect();
        return {
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          icon: i.width,
          grid: svg.getAttribute("viewBox"),
          stroke: svg.getAttribute("stroke-width"),
          radius: getComputedStyle(button).borderRadius,
          centered: Math.abs(b.x + b.width / 2 - i.x - i.width / 2) < 0.1,
        };
      }),
    );
  assert.equal(metrics.length, 6);
  for (const m of metrics) {
    assert.equal(m.width, 36);
    assert.equal(m.height, 36);
    assert.equal(m.icon, 22);
    assert.equal(m.grid, "0 0 24 24");
    assert.equal(m.stroke, "1.7");
    assert.equal(m.radius, "10px");
    assert.ok(m.centered);
  }
  for (let i = 1; i < 5; i++) assert.equal(metrics[i].y - metrics[i - 1].y, 44);
  await card.click();
  await page.locator(".editor .choice-preview img").last().waitFor();
  await page
    .getByRole("combobox", { name: "图形 1 位置", exact: true })
    .click();
  await page.getByRole("option", { name: "选项 B", exact: true }).click();
  assert.equal(
    await page
      .locator(".editor .choice-preview-option")
      .nth(1)
      .locator("img")
      .count(),
    2,
  );
  await page
    .getByRole("combobox", { name: "图形 1 位置", exact: true })
    .click();
  await page.getByRole("option", { name: "选项 A", exact: true }).click();
  // Crop into B, then move the extracted image into the stem.
  await page
    .getByRole("combobox", { name: "提取图形位置", exact: true })
    .click();
  await page.getByRole("option", { name: "选项 B", exact: true }).click();
  await page.getByRole("button", { name: "放大原图", exact: true }).click();
  const zoom = await page.locator(".source-tools output").textContent();
  await page.getByRole("button", { name: "提取图形", exact: true }).click();
  const crop = await page.locator(".source-canvas").boundingBox();
  await page.mouse.move(crop.x + crop.width * 0.4, crop.y + crop.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(crop.x + crop.width * 0.6, crop.y + crop.height * 0.6);
  await page.mouse.up();
  await page.getByRole("button", { name: "插入图形", exact: true }).click();
  await page
    .locator(".editor .choice-preview-option")
    .nth(1)
    .locator("img")
    .nth(1)
    .waitFor();
  await page
    .getByRole("combobox", { name: "图形 5 位置", exact: true })
    .click();
  await page.getByRole("option", { name: "题干插图", exact: true }).click();
  await page.locator(".editor .preview .card-figures img").waitFor();
  assert.equal(await page.locator(".source-tools output").textContent(), zoom);
  await page.locator(".editor-scroll").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: "test-output/image-choices-editor.png" });
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.waitForTimeout(500);
  const q = await page.evaluate(
    async (id) =>
      (await window.matheca.state()).questions.find((q) => q.id === id),
    id,
  );
  assert.deepEqual(q.figurePlacements, ["A", "B", "C", "D", "stem"]);
  const print = await app.evaluate(async ({ BrowserWindow }, q) => {
    const main = BrowserWindow.getAllWindows().find((w) => w.isVisible());
    const host = new BrowserWindow({ show: false, width: 1400, height: 2000 });
    try {
      await host.loadURL(
        main.webContents.getURL().replace(/index\.html$/, "render.html"),
      );
      return await host.webContents.executeJavaScript(
        `(async()=>{ await window.renderEngine.prepare(${JSON.stringify([q])},{title:'图片选项',paperTitle:'图片选项'}); return {stem: document.querySelectorAll('article > img').length, cells:[...document.querySelectorAll('.options td')].map(cell=>({text:cell.innerText,images:cell.querySelectorAll('img').length,width:cell.getBoundingClientRect().width,imageWidth:cell.querySelector('img')?.getBoundingClientRect().width,ratio:cell.querySelector('img')?.getBoundingClientRect().width/cell.querySelector('img')?.getBoundingClientRect().height}))}; })()`,
      );
    } finally {
      host.destroy();
    }
  }, q);
  assert.equal(print.stem, 1);
  assert.equal(print.cells.length, 4);
  for (const [i, c] of print.cells.entries()) {
    assert.ok(c.text.startsWith("ABCD"[i] + "."));
    assert.equal(c.images, 1);
    assert.ok(c.imageWidth <= c.width);
    assert.ok(Math.abs(c.ratio - 300 / 180) < 0.01);
  }
  await app.evaluate(({ dialog }, root) => {
    dialog.showMessageBox = async () => ({ response: 0 });
    dialog.showSaveDialog = async (_window, options) => ({
      canceled: false,
      filePath: root + "/" + options.defaultPath,
    });
  }, root);
  const files = await page.evaluate(async () => ({
    pdf: await window.matheca.exportCollection("image-paper", "pdf"),
    docx: await window.matheca.exportCollection("image-paper", "docx"),
  }));
  assert.ok(
    fs.readFileSync(files.pdf.path).includes(Buffer.from("/Subtype /Image")),
  );
  const xml = await new Promise((resolve, reject) =>
    yauzl.open(files.docx.path, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on("error", reject);
      zip.on("entry", (entry) => {
        if (entry.fileName !== "word/document.xml") return zip.readEntry();
        zip.openReadStream(entry, (err, stream) => {
          if (err) return reject(err);
          const chunks = [];
          stream.on("data", (b) => chunks.push(b));
          stream.on("end", () => {
            resolve(Buffer.concat(chunks).toString());
            zip.close();
          });
        });
      });
      zip.readEntry();
    }),
  );
  const cells = [...xml.matchAll(/<w:tc>.*?<\/w:tc>/gs)].map((m) => m[0]);
  assert.equal(cells.length, 4);
  for (const [i, cell] of cells.entries()) {
    assert.ok(cell.includes("ABCD"[i] + ". "));
    assert.equal((cell.match(/<w:drawing>/g) || []).length, 1);
  }
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "题集", exact: true })
    .click();
  await page
    .locator(".collection-card")
    .filter({ hasText: "图片选项验证" })
    .click();
  await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
  await page.locator(".document-preview canvas").waitFor();
  await page.waitForTimeout(700);
  await page.screenshot({ path: "test-output/image-choices-export.png" });
  await page.getByRole("button", { name: "返回编辑", exact: true }).click();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1024, 700),
  );
  await page.waitForTimeout(350);
  await page.screenshot({ path: "test-output/image-choices-small.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: original icon grid/spacing, pure image choice cards, placement changes, source crop retains zoom, saved roles, proportional PDF/Word options in matching cells, preview and small window; isolated packaged EXE. " +
      root,
  );
} finally {
  if (app) await app.close();
}
