import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve("test-output"),
  data = path.join(root, "appdata-" + Date.now());
fs.mkdirSync(root, { recursive: true });
const abandoned = path.join(data, "restored", "abandoned");
fs.mkdirSync(abandoned, { recursive: true });
fs.writeFileSync(path.join(abandoned, "uncommitted.png"), "incomplete copy");
const temporary = path.join(data, "staging", "abandoned");
fs.mkdirSync(temporary, { recursive: true });
fs.writeFileSync(path.join(temporary, "archive.zip"), "incomplete archive");
const executablePath =
  process.env.MATHECA_EXE ??
  path.resolve("node_modules/electron/dist/electron.exe");
const args = process.env.MATHECA_EXE
  ? []
  : [path.resolve(".vite/build/main.cjs")];
const env = { ...process.env, MATHECA_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
let application;
try {
  application = await electron.launch({
    executablePath,
    args,
    env,
    timeout: 60000,
  });
  const page = await application.firstWindow();
  assert.equal(fs.existsSync(abandoned), false);
  assert.equal(fs.existsSync(temporary), false);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.log("Renderer:", m.text());
  });
  await page.waitForFunction(
    () => !!window.matheca && document.querySelector("h1"),
    { timeout: 30000 },
  );
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  assert.equal(await page.evaluate(() => typeof window.process), "undefined");
  await application.evaluate(({ BrowserWindow }) => {
    const prefs =
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    if (prefs.nodeIntegration || !prefs.contextIsolation || !prefs.sandbox)
      throw Error("Renderer permissions are unsafe");
  });
  await page.evaluate(() => window.matheca.examples());
  await page.locator(".question-card").nth(2).waitFor();
  const state = await page.evaluate(() => window.matheca.state());
  assert.equal(state.questions.filter((q) => q.example).length, 3);
  const q = state.questions[0];
  await page.evaluate(async (q) => {
    await window.matheca.saveQuestion({ ...q, latex: "x^2=3" }, false);
  }, q);
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).questions.find(
      (x) => x.id === q.id,
    ).reviewed,
    true,
  );
  await page.evaluate(
    async (q) =>
      window.matheca.saveQuestion(
        { ...q, body: "已知 \\(f(x)=x^2\\)。求 \\(f(2)\\)。" },
        false,
      ),
    q,
  );
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).questions.find(
      (x) => x.id === q.id,
    ).reviewed,
    false,
  );
  await page.evaluate(async (id) => {
    const s = await window.matheca.state();
    await window.matheca.saveQuestion(
      s.questions.find((q) => q.id === id),
      true,
    );
  }, q.id);
  const collection = {
    id: "e2e-paper",
    title: "高中数学练习",
    createdAt: Date.now().toString(),
    paperTitle: "高中数学练习",
    examInstructions: "请写出完整解题过程。",
    examMinutes: 45,
    totalScore: 100,
  };
  await page.evaluate(async (c) => {
    await window.matheca.saveCollection(c);
    const s = await window.matheca.state();
    await window.matheca.addQuestions(
      c.id,
      s.questions.map((q) => q.id),
    );
  }, collection);
  await page.evaluate(async () => {
    await window.matheca.addKnowledge({
      group: "函数",
      name: "桌面测试知识点",
    });
  });
  await page.getByRole("button", { name: "题集", exact: true }).click();
  await page.getByRole("button", { name: /高中数学练习/ }).click();
  await page.getByRole("button", { name: "导出 PDF", exact: true }).waitFor();
  await page.screenshot({ path: path.join(root, "workbench.png") });
  await application.evaluate(({ dialog }, root) => {
    dialog.showMessageBox = async () => ({
      response: 0,
      checkboxChecked: false,
    });
    dialog.showSaveDialog = async (_window, options) => ({
      canceled: false,
      filePath:
        root +
        "/" +
        (options.defaultPath.startsWith("压力") ? "stress" : "sample") +
        (options.defaultPath.endsWith(".pdf")
          ? ".pdf"
          : options.defaultPath.endsWith(".docx")
            ? ".docx"
            : ".zip"),
    });
  }, root);
  await page.evaluate(() =>
    window.matheca.exportCollection("e2e-paper", "pdf"),
  );
  assert.ok(fs.statSync(path.join(root, "sample.pdf")).size > 1000);
  await page.evaluate(() =>
    window.matheca.exportCollection("e2e-paper", "docx"),
  );
  assert.ok(fs.statSync(path.join(root, "sample.docx")).size > 1000);
  await page.evaluate(() => window.matheca.exportBackup());
  assert.ok(fs.statSync(path.join(root, "sample.zip")).size > 100);
  await application.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [root + "/sample.zip"],
    });
  }, root);
  const preview = await page.evaluate(() => window.matheca.inspectBackup());
  assert.equal(preview.questions, 3);
  await page.evaluate(
    (token) => window.matheca.dismissBackup(token),
    preview.token,
  );
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).questions.length,
    3,
  );
  const confirmed = await page.evaluate(() => window.matheca.inspectBackup());
  const result = await page.evaluate(
    (token) => window.matheca.restoreBackup(token),
    confirmed.token,
  );
  assert.equal(result.questions, 0);
  assert.equal(result.skippedQuestions, 3);
  await page.getByRole("button", { name: /设置与备份/ }).click();
  assert.equal(await page.getByLabel("主题", { exact: true }).count(), 0);
  assert.equal(
    await page.getByRole("heading", { name: "外观", exact: true }).count(),
    1,
  );
  await page.emulateMedia({ colorScheme: "dark" });
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "light",
  );
  await page.screenshot({ path: path.join(root, "settings-light.png") });
  assert.deepEqual(errors, []);
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .close(),
  );
  await application.waitForEvent("close", { timeout: 30000 });
  application = undefined;
  application = await electron.launch({
    executablePath,
    args,
    env,
    timeout: 60000,
  });
  const reopened = await application.firstWindow();
  await reopened.waitForFunction(
    () => !!window.matheca && document.querySelector("h1"),
  );
  const restored = await reopened.evaluate(() => window.matheca.state());
  assert.equal(restored.questions.length, 3);
  assert.equal(restored.collections.length, 1);
  assert.equal(restored.settings.theme, "LIGHT");
  await application.evaluate(({ dialog }, root) => {
    dialog.showSaveDialog = async (_w, o) => ({
      canceled: false,
      filePath:
        root + "/stress." + (o.defaultPath.endsWith(".pdf") ? "pdf" : "docx"),
    });
    dialog.showMessageBox = async () => ({ response: 0 });
  }, root);
  const stressQuestions = await reopened.evaluate(async () => {
    const base = (await window.matheca.state()).questions[0];
    const bodies = [
      String.raw`复杂公式：\[\int_0^1 \frac{x^2}{1+x^2}\,dx=1-\frac{\pi}{4}\]，矩阵 \(\begin{pmatrix}1&2\\3&4\end{pmatrix}\)，分段函数 \[f(x)=\begin{cases}x^2&x\ge0\\-x&x<0\end{cases}\]。`,
      "选择正确的完整表述。\nA. 当函数在给定区间内连续且满足相应导数条件时取得最大值\nB. 当函数在给定区间内连续且满足相应导数条件时取得最小值\nC. 当函数在给定区间内连续且满足相应导数条件时恒为常数\nD. 当函数在给定区间内连续且满足相应导数条件时没有极值",
      "超长题目：\n" +
        Array.from(
          { length: 100 },
          (_, i) =>
            `（${i + 1}）中文条件与推导第 ${i + 1} 步，已知 \\(x_${i + 1}=${i + 1}\\)。请写出理由。`,
        ).join("\n") +
        "\n完整内容终点",
    ];
    const qs = [];
    for (let i = 0; i < bodies.length; i++)
      qs.push(
        await window.matheca.saveQuestion(
          {
            ...base,
            id: "stress-" + i,
            body: bodies[i],
            title: "压力测试",
            sourcePath: "",
            autoSolve: false,
            kind: i === 1 ? "选择题" : "解答题",
          },
          true,
        ),
      );
    const c = {
      id: "stress-paper",
      title: "压力测试",
      createdAt: Date.now().toString(),
      paperTitle: "复杂公式与多页内容验证",
      examInstructions: "长选项应排为两行两列。",
      examMinutes: 90,
      totalScore: 150,
    };
    await window.matheca.saveCollection(c);
    await window.matheca.addQuestions(
      c.id,
      qs.map((q) => q.id),
    );
    return qs;
  });
  await reopened.evaluate(() =>
    window.matheca.exportCollection("stress-paper", "pdf"),
  );
  await reopened.evaluate(() =>
    window.matheca.exportCollection("stress-paper", "docx"),
  );
  await reopened.evaluate(async (q) => {
    await window.matheca.saveQuestion({ ...q, body: "" });
  }, stressQuestions[0]);
  await assert.rejects(
    reopened.evaluate(() =>
      window.matheca.exportCollection("stress-paper", "pdf"),
    ),
    /第 1 题/,
  );
  await reopened.evaluate(async (q) => {
    await window.matheca.saveQuestion({
      ...q,
      body: String.raw`题干 \(\unknowncommand{x}\)`,
    });
  }, stressQuestions[0]);
  await assert.rejects(
    reopened.evaluate(() =>
      window.matheca.exportCollection("stress-paper", "docx"),
    ),
    /公式/,
  );

  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .close(),
  );
  await application.waitForEvent("close", { timeout: 30000 });
  application = undefined;
  application = await electron.launch({
    executablePath,
    args,
    env,
    timeout: 60000,
  });
  const editing = await application.firstWindow();
  await editing.waitForFunction(
    () => !!window.matheca && document.querySelector("h1"),
  );
  await editing.locator(".question-card").first().click();
  await editing
    .getByLabel("题干与小题", { exact: true })
    .fill("关窗前未手动保存的中文草稿");
  let closed = application.waitForEvent("close");
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .close(),
  );
  await closed;
  application = undefined;
  application = await electron.launch({
    executablePath,
    args,
    env,
    timeout: 60000,
  });
  const draftCheck = await application.firstWindow();
  await draftCheck.waitForFunction(
    () => !!window.matheca && document.querySelector("h1"),
  );
  assert.ok(
    (await draftCheck.evaluate(() => window.matheca.state())).questions.some(
      (q) => q.body === "关窗前未手动保存的中文草稿",
    ),
  );
  closed = application.waitForEvent("close");
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .close(),
  );
  await closed;
  application = undefined;
  console.log(
    "PASS: sandboxed UI, SQLite persistence, review rules, collection, custom knowledge, offline PDF/DOCX, ZIP preview/local-wins restore, theme, safe close and reopen",
  );
} finally {
  if (application) await application.close();
}
