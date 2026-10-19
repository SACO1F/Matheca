import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { execFileSync } from "node:child_process";
import yauzl from "yauzl";

const root = path.resolve("test-output", "difficulty-spacing-" + Date.now());
fs.mkdirSync(root, { recursive: true });
const key = path.join(root, "localhost.key"),
  cert = path.join(root, "localhost.crt");
execFileSync(
  "C:/Program Files/Git/usr/bin/openssl.exe",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    cert,
    "-days",
    "2",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost",
  ],
  { stdio: "ignore" },
);
let delay = 0;
const requests = [];
const server = https.createServer(
  { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
  (req, res) => {
    let body = "";
    req.on("data", (b) => (body += b));
    req.on("end", () => {
      const prompt = JSON.parse(body).messages[0].content[0].text;
      requests.push(prompt);
      const result = prompt.includes("解题助手")
        ? { answer: "1", steps: ["运用已知条件求得结果"], difficultyScore: 3 }
        : {
            questions: [
              {
                body: "选择正确的结果。",
                subquestions: ["A. 1", "B. 2", "C. 3", "D. 4"],
                kind: "选择题",
                difficultyScore: 1,
              },
              {
                body: "求函数的值域：____。",
                kind: "填空题",
                difficultyScore: 2,
              },
              {
                body: "已知函数 \\(f(x)=x^2\\)。",
                subquestions: ["求函数的单调区间。", "证明所给结论。"],
                kind: "证明题",
                difficultyScore: 3,
              },
            ].map((q) => ({
              ...q,
              grade: "高一",
              knowledgePoints: ["函数单调性"],
            })),
          };
      setTimeout(() => {
        if (!res.destroyed)
          res.end(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: { content: JSON.stringify(result) },
                },
              ],
            }),
          );
      }, delay);
    });
  },
);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const env = {
  ...process.env,
  MATHECA_TEST_DATA: path.join(root, "appdata"),
  NODE_EXTRA_CA_CERTS: cert,
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({
    executablePath: process.env.MATHECA_EXE,
    env,
  });
  const page = await app.firstWindow();
  await page.locator("h1").waitFor();
  const waitState = async (predicate) => {
    for (let i = 0; i < 300; i++) {
      const state = await page.evaluate(() => window.matheca.state());
      if (predicate(state)) return state;
      await page.waitForTimeout(100);
    }
    throw Error(
      "Task wait timed out: " +
        JSON.stringify(
          (await page.evaluate(() => window.matheca.state())).jobs,
        ),
    );
  };
  await page.evaluate(
    (address) =>
      window.matheca.saveSettings({
        address,
        model: "test-model",
        apiKey: "isolated-test",
        theme: "LIGHT",
        autoSolveImports: false,
      }),
    `https://localhost:${server.address().port}/v1`,
  );
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, path.resolve("assets/vision-test.png"));
  await page.evaluate(() => window.matheca.chooseImport());
  await waitState((s) =>
    s.jobs.some((j) => j.type === "import" && j.status === "complete"),
  );
  let state = await page.evaluate(() => window.matheca.state());
  const questions = ["选择题", "填空题", "证明题"].map((kind) =>
    state.questions.find((q) => q.kind === kind),
  );
  assert.deepEqual(
    questions.map((q) => q.difficulty),
    ["基础", "进阶", "挑战"],
  );
  assert.ok(requests[0].includes("difficultyScore"));
  assert.ok(requests[0].includes("不要把选项作为"));
  assert.equal(questions[0].body, "选择正确的结果。\nA. 1\nB. 2\nC. 3\nD. 4");
  // Reproduce an older stored question with duplicate numeric option labels.
  questions[0].body =
    "选择正确的结果。\n（1）A. 1\n（2）B. 2\n（3）C. 3\n（4）D. 4";
  await page.evaluate((q) => window.matheca.saveQuestion(q), questions[0]);
  await page.evaluate(
    (id) => window.matheca.solveQuestion(id),
    questions[0].id,
  );
  await waitState(
    (s) => !!s.questions.find((q) => q.id === questions[0].id)?.solution,
  );
  state = await page.evaluate(() => window.matheca.state());
  assert.equal(
    state.questions.find((q) => q.id === questions[0].id).difficulty,
    "挑战",
  );
  delay = 800;
  await page.evaluate(
    (id) => window.matheca.solveQuestion(id),
    questions[0].id,
  );
  await page.waitForTimeout(300);
  await page.evaluate(async (id) => {
    const q = (await window.matheca.state()).questions.find(
      (q) => q.id === id,
    );
    await window.matheca.saveQuestion({ ...q, difficulty: "进阶" });
  }, questions[0].id);
  await page.waitForTimeout(900);
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).questions.find(
      (q) => q.id === questions[0].id,
    ).difficulty,
    "进阶",
  );
  assert.ok(
    requests
      .filter((p) => p.includes("解题助手"))
      .every((p) => p.includes("difficultyScore")),
  );
  await page.evaluate(
    async (ids) => {
      await window.matheca.saveCollection({
        id: "space-paper",
        title: "作答留白验证",
        createdAt: String(Date.now()),
        paperTitle: "数学练习",
        examInstructions: "请在题目下方作答",
        examMinutes: 60,
        totalScore: 100,
      });
      await window.matheca.addQuestions("space-paper", ids);
    },
    questions.map((q) => q.id),
  );
  const sizes = await app.evaluate(async ({ BrowserWindow }, questions) => {
    const main = BrowserWindow.getAllWindows().find((w) => w.isVisible());
    const host = new BrowserWindow({
      show: false,
      width: 1000,
      height: 2000,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    try {
      await host.loadURL(
        main.webContents.getURL().replace(/index\.html$/, "render.html"),
      );
      return await host.webContents.executeJavaScript(
        `(async()=>{ await window.renderEngine.prepare(${JSON.stringify(questions)}, { title:'作答留白验证',paperTitle:'数学练习',examMinutes:60,totalScore:100,examInstructions:'请在题目下方作答' }); return { heights: [...document.querySelectorAll('.answer-space')].map(el=>el.getBoundingClientRect().height), choice: document.querySelector('.question').innerText }; })()`,
      );
    } finally {
      host.destroy();
    }
  }, questions);
  for (const [i, mm] of [0, 0, 50].entries())
    assert.ok(Math.abs(sizes.heights[i] - (mm * 96) / 25.4) < 1);
  assert.ok(!/[（(][1-4][）)]/.test(sizes.choice));
  for (const letter of ["A.", "B.", "C.", "D."])
    assert.ok(sizes.choice.includes(letter));
  await app.evaluate(({ dialog }, root) => {
    dialog.showMessageBox = async () => ({ response: 0 });
    dialog.showSaveDialog = async (_w, options) => ({
      canceled: false,
      filePath: root + "/" + options.defaultPath,
    });
  }, root);
  const results = await page.evaluate(async () => ({
    pdf: await window.matheca.exportCollection("space-paper", "pdf"),
    docx: await window.matheca.exportCollection("space-paper", "docx"),
    preview: await window.matheca.previewCollection("space-paper"),
  }));
  assert.ok(fs.statSync(results.pdf.path).size > 1000);
  assert.ok(results.preview.length > 1000);
  const xml = await new Promise((resolve, reject) =>
    yauzl.open(results.docx.path, { lazyEntries: true }, (err, zip) => {
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
  for (const mm of [50])
    assert.ok(
      xml.includes(
        `w:line="${Math.round((mm * 1440) / 25.4)}" w:lineRule="exact"`,
      ),
    );
  assert.ok(!xml.includes('w:line="0" w:lineRule="exact"'));
  assert.ok(!/[（(][1-4][）)]/.test(xml.split("已知函数")[0]));
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "题集", exact: true })
    .click();
  await page
    .locator(".collection-card")
    .filter({ hasText: "作答留白验证" })
    .click();
  await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
  await page.locator(".document-preview canvas").waitFor();
  await page.waitForTimeout(800);
  const checkBounds = async () => {
    const modal = await page.locator(".document-preview").boundingBox();
    const titlebar = await page.locator(".window-titlebar").boundingBox();
    const viewport =
      page.viewportSize() ??
      (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
    assert.ok(modal.y >= titlebar.y + titlebar.height + 12);
    assert.ok(modal.y + modal.height <= viewport.height - 12);
  };
  await checkBounds();
  await page.screenshot({ path: "test-output/answer-space-preview.png" });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1024, 700),
  );
  await page.waitForTimeout(500);
  await checkBounds();
  await page.screenshot({ path: "test-output/answer-space-preview-small.png" });
  console.log(
    "PASS: real mocked recognition/solution scores map to labels, concurrent manual difficulty protected, PDF/preview writing-space dimensions and Word exact blank heights match shared rules; packaged EXE with isolated data. Artifacts: " +
      root,
  );
} finally {
  if (app) await app.close();
  await new Promise((r) => server.close(r));
}
