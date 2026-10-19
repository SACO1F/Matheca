import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import yauzl from "yauzl";
const root = path.resolve("test-output", "layout-add-undo-" + Date.now());
const env = { ...process.env, MATHECA_TEST_DATA: root };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.MATHECA_EXE,
  env,
});
try {
  const page = await app.firstWindow();
  await page.locator("h1").waitFor();
  const ids = await page.evaluate(async () => {
    await window.matheca.examples();
    const ids = (await window.matheca.state()).questions.map((q) => q.id);
    await window.matheca.saveCollection({
      id: "layout-paper",
      title: "自主排版题集",
      createdAt: String(Date.now()),
      paperTitle: "自主排版",
      examMinutes: 60,
      totalScore: 100,
      examInstructions: "",
    });
    await window.matheca.addQuestions("layout-paper", ids.slice(0, 2));
    return ids;
  });
  const nav = (name) =>
    page.locator(".sidebar").getByRole("button", { name, exact: true });
  const toast = page.getByRole("region", { name: "通知", exact: true });
  const undo = async () => {
    await toast.getByRole("button", { name: "撤销", exact: true }).click();
    await page.waitForTimeout(200);
    assert.ok((await toast.innerText()).includes("已撤销加入"));
    await toast.getByRole("button", { name: "关闭通知", exact: true }).click();
  };
  const members = async () =>
    (await page.evaluate(() => window.matheca.state())).items
      .filter((i) => i.collectionId === "layout-paper")
      .map((i) => i.questionId);
  // The library joining dialog.
  await page
    .locator(`[data-question-id="${ids[2]}"]`)
    .getByRole("button", { name: "加入题集", exact: true })
    .press("Enter");
  await page.getByRole("button", { name: "自主排版题集", exact: true }).click();
  assert.ok((await members()).includes(ids[2]));
  await undo();
  assert.deepEqual(await members(), ids.slice(0, 2));
  await nav("题集").click();
  await page
    .locator(".collection-card")
    .filter({ hasText: "自主排版题集" })
    .click();
  await page.getByRole("button", { name: "从题库添加", exact: true }).click();
  const pick = page.locator(
    `.collection-picker-results [data-question-id="${ids[2]}"]`,
  );
  await pick.getByRole("button", { name: "加入题集", exact: true }).click();
  await undo();
  await pick.getByRole("button", { name: "加入题集", exact: true }).waitFor();
  await pick.locator(".math-content").click();
  await undo();
  assert.deepEqual(await members(), ids.slice(0, 2));
  await page.getByRole("button", { name: "关闭题库选择", exact: true }).click();
  const space = page.getByRole("spinbutton", {
    name: "第 1 题解答空间",
    exact: true,
  });
  await space.fill("75");
  await space.press("Tab");
  await page
    .locator(`.collection-question-list [data-question-id="${ids[1]}"]`)
    .getByLabel("另起一页", { exact: true })
    .check();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.waitForTimeout(250);
  const state = await page.evaluate(() => window.matheca.state());
  const collection = state.collections.find((c) => c.id === "layout-paper");
  assert.equal(collection.questionLayout[ids[0]].answerSpaceMm, 75);
  assert.equal(collection.questionLayout[ids[1]].pageBreakBefore, true);
  await page.screenshot({ path: "test-output/question-layout-controls.png" });
  const rendered = await app.evaluate(
    async ({ BrowserWindow }, { collection, questions }) => {
      const main = BrowserWindow.getAllWindows().find((w) => w.isVisible());
      const host = new BrowserWindow({
        show: false,
        width: 1000,
        height: 1600,
      });
      try {
        await host.loadURL(
          main.webContents.getURL().replace(/index\.html$/, "render.html"),
        );
        return await host.webContents.executeJavaScript(
          `(async()=>{await window.renderEngine.prepare(${JSON.stringify(questions)},${JSON.stringify(collection)});return {height:document.querySelector('.answer-space').getBoundingClientRect().height,breakBefore:document.querySelectorAll('.question')[1].style.breakBefore};})()`,
        );
      } finally {
        host.destroy();
      }
    },
    {
      collection,
      questions: ids
        .slice(0, 2)
        .map((id) => state.questions.find((q) => q.id === id)),
    },
  );
  assert.ok(Math.abs(rendered.height - (75 * 96) / 25.4) < 1);
  assert.equal(rendered.breakBefore, "page");
  await app.evaluate(({ dialog }, root) => {
    dialog.showMessageBox = async () => ({ response: 0 });
    dialog.showSaveDialog = async (_w, opts) => ({
      canceled: false,
      filePath: root + "/" + opts.defaultPath,
    });
  }, root);
  const exported = await page.evaluate(async () => ({
    pdf: await window.matheca.exportCollection("layout-paper", "pdf"),
    docx: await window.matheca.exportCollection("layout-paper", "docx"),
  }));
  assert.ok(fs.statSync(exported.pdf.path).size > 1000);
  const xml = await new Promise((resolve, reject) =>
    yauzl.open(exported.docx.path, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
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
      zip.on("error", reject);
      zip.readEntry();
    }),
  );
  assert.ok(
    xml.includes(
      `w:line="${Math.round((75 * 1440) / 25.4)}" w:lineRule="exact"`,
    ),
  );
  assert.ok(xml.includes("w:pageBreakBefore"));
  await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
  await page.locator(".document-preview canvas").waitFor();
  await page.waitForTimeout(500);
  assert.ok(
    (await page.locator(".document-preview").innerText()).includes("/ 2 页"),
  );
  await page.screenshot({ path: "test-output/question-layout-preview.png" });
  await page.getByRole("button", { name: "返回编辑", exact: true }).click();
  await space.fill("");
  await space.press("Tab");
  await page.waitForTimeout(250);
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).collections.find(
      (c) => c.id === "layout-paper",
    ).questionLayout[ids[0]].answerSpaceMm,
    undefined,
  );
  await nav("题库").click();
  await page
    .locator(`[data-question-id="${ids[2]}"]`)
    .getByRole("button", { name: "加入题集", exact: true })
    .press("Enter");
  await page.getByLabel("新题集名称", { exact: true }).fill("创建后撤销加入");
  await page.getByRole("button", { name: "创建并加入", exact: true }).click();
  await undo();
  const createdState = await page.evaluate(() => window.matheca.state());
  const created = createdState.collections.find(
    (c) => c.title === "创建后撤销加入",
  );
  assert.ok(created);
  assert.ok(!createdState.items.some((i) => i.collectionId === created.id));
  console.log(
    "PASS: library dialog and picker button/card join Undo, original members retained, 75mm custom space saved, page break saved, PDF/Word/preview custom layout, two-page preview, reset to automatic; isolated packaged EXE.",
  );
} finally {
  await app.close();
}
