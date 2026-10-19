import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const root = path.resolve("test-output/integration-" + Date.now());
fs.mkdirSync(root, { recursive: true });
const cert = path.join(root, "localhost.crt"),
  key = path.join(root, "localhost.key");
execFileSync(
  process.env.MATHECA_OPENSSL || "C:/Program Files/Git/usr/bin/openssl.exe",
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
execFileSync(process.env.MATHECA_QA_PYTHON || "python", [
  "-c",
  `from reportlab.pdfgen import canvas
from pathlib import Path
for pages in (20,21):
 c=canvas.Canvas(str(Path(${JSON.stringify(root)})/('input-'+str(pages)+'.pdf')))
 for i in range(pages):
  c.drawString(40,800,'Page '+str(i+1)+' Mathematics x^2 + 1 = 2');c.showPage()
 c.save()
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
c=canvas.Canvas(str(Path(${JSON.stringify(root)})/'input-chinese.pdf'));c.setFont('STSong-Light',20);c.drawString(40,760,'高中数学练习：求函数的定义域。');c.drawString(40,700,'已知二次函数，证明以下结论。');c.save()
from PIL import Image
im=Image.new('RGB',(120,80),'white');exif=im.getexif();exif[274]=6;im.save(str(Path(${JSON.stringify(root)})/'rotated.jpg'),exif=exif)`,
]);
let mode = "success",
  calls = 0;
let imageDimensions;
const pending = new Set();
const server = https.createServer(
  { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
  (req, res) => {
    let body = "";
    req.on("data", (b) => (body += b));
    req.on("end", async () => {
      calls++;
      const request = JSON.parse(body);
      if (mode === "orientation") {
        const jpeg = (await import("jpeg-js")).default;
        const url = request.messages[0].content.find(
          (c) => c.type === "image_url",
        ).image_url.url;
        const image = jpeg.decode(Buffer.from(url.split(",")[1], "base64"));
        imageDimensions = [image.width, image.height];
      }
      assert.equal(req.headers.authorization, "Bearer local-test-secret");
      const text = request.messages[0].content[0].text,
        isSolution = text.includes("解题助手");
      const payload = {
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: isSolution
                ? JSON.stringify({
                    answer: "1",
                    steps: ["计算得到 1"],
                    latex: "x=1",
                  })
                : text.includes("请读取图片")
                  ? "7"
                  : JSON.stringify({
                      needMorePages: false,
                      questions: [
                        {
                          startPage: Number(
                            text.match(/目标起始页：(\d+)/)?.[1] ?? 1,
                          ),
                          endPage: Number(
                            text.match(/目标起始页：(\d+)/)?.[1] ?? 1,
                          ),
                          complete: true,
                          body: "已知 \\(x^2=1\\)，求正数 x。",
                          grade: "高一",
                          kind: "解答题",
                          difficulty: "基础",
                          knowledgePoints: ["函数单调性"],
                        },
                      ],
                    }),
            },
          },
        ],
      };
      if ((mode === "failFirst" && calls === 2) || mode === "rateLimit") {
        res.writeHead(429);
        res.end("local-test-secret should never appear in app errors");
        return;
      }
      if (mode === "truncated") payload.choices[0].finish_reason = "length";
      if (mode === "oversize") {
        res.end(JSON.stringify({ padding: "x".repeat(4 * 1024 * 1024 + 1) }));
        return;
      }
      const reply = () => {
        if (!res.destroyed) res.end(JSON.stringify(payload));
      };
      if (mode === "delayed") {
        const timer = setTimeout(() => {
          pending.delete(timer);
          reply();
        }, 2000);
        pending.add(timer);
      } else reply();
    });
  },
);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const executablePath =
  process.env.MATHECA_EXE ||
  path.resolve("node_modules/electron/dist/electron.exe");
const args = process.env.MATHECA_EXE
  ? []
  : [path.resolve(".vite/build/main.cjs")];
const env = {
  ...process.env,
  NODE_EXTRA_CA_CERTS: cert,
  MATHECA_TEST_DATA: path.join(root, "appdata"),
};
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const launch = async () => {
  app = await electron.launch({ executablePath, args, env });
  page = await app.firstWindow();
  await page.waitForFunction(
    () => !!window.matheca && document.querySelector("h1"),
  );
};
const state = () => page.evaluate(() => window.matheca.state());
const wait = async (test, timeout = 60000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const s = await state();
    if (test(s)) return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Integration timeout");
};
const choose = async (files) => {
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
  }, files);
  await page.evaluate(() => window.matheca.chooseImport());
};
const close = async () => {
  const closed = app.waitForEvent("close");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .close(),
  );
  await closed;
  app = undefined;
};
try {
  await launch();
  await page.evaluate(
    async (address) =>
      window.matheca.saveSettings({
        address,
        model: "fixture-model",
        apiKey: "local-test-secret",
        theme: "LIGHT",
        autoSolveImports: false,
      }),
    `https://localhost:${server.address().port}/v1`,
  );
  assert.equal((await state()).settings.hasApiKey, true);
  assert.ok(!JSON.stringify(await state()).includes("local-test-secret"));
  assert.match(await page.evaluate(() => window.matheca.testVision()), /7/);
  const png = path.resolve("assets/vision-test.png");
  mode = "failFirst";
  await choose([png, png]);
  let s = await wait((s) => s.jobs.some((j) => j.status === "partial"));
  assert.equal(s.questions.length, 1);
  const human = { ...s.questions[0], body: "人工校对保留" };
  await page.evaluate((q) => window.matheca.saveQuestion(q, true), human);
  const job = s.jobs.find((j) => j.status === "partial");
  mode = "success";
  await page.evaluate((id) => window.matheca.resumeJob(id), job.id);
  s = await wait(
    (s) => s.jobs.find((j) => j.id === job.id)?.status === "complete",
  );
  assert.equal(s.questions.length, 2);
  assert.equal(s.questions.find((q) => q.id === human.id).body, human.body);
  assert.equal(calls, 4);
  await page.getByText("人工校对保留", { exact: true }).click();
  await page.getByAltText("放大的题目原图").waitFor();
  assert.ok(
    await page
      .getByAltText("放大的题目原图")
      .evaluate((image) => image.complete && image.naturalWidth > 0),
  );
  await page.screenshot({ path: path.join(root, "proofreading.png") });
  await page.evaluate((id) => window.matheca.solveQuestion(id), human.id);
  s = await wait((s) => s.questions.find((q) => q.id === human.id)?.solution);
  assert.match(s.questions.find((q) => q.id === human.id).solution, /答案：1/);
  mode = "delayed";
  await page.evaluate((id) => window.matheca.solveQuestion(id), human.id);
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(
    (q) => window.matheca.saveQuestion({ ...q, body: "编辑后新条件" }),
    s.questions.find((q) => q.id === human.id),
  );
  await new Promise((r) => setTimeout(r, 2200));
  assert.equal(
    (await state()).questions.find((q) => q.id === human.id).solution,
    "",
  );
  for (const testMode of ["rateLimit", "truncated", "oversize"]) {
    mode = testMode;
    await page.evaluate((id) => window.matheca.solveQuestion(id), human.id);
    s = await wait((s) =>
      s.jobs.some(
        (j) =>
          j.questionId === human.id &&
          j.status === "failed" &&
          (testMode === "rateLimit"
            ? j.message.includes("429")
            : testMode === "truncated"
              ? j.message.includes("截断")
              : j.message.includes("4 MB")),
      ),
    );
    assert.ok(!JSON.stringify(s).includes("local-test-secret"));
  }
  mode = "success";
  await assert.rejects(choose(Array(21).fill(png)), /20/);
  const large = path.join(root, "large.png");
  fs.writeFileSync(large, "x");
  fs.truncateSync(large, 50 * 1024 * 1024 + 1);
  await assert.rejects(choose([large]), /50 MB/);
  await choose([path.join(root, "input-21.pdf")]);
  await wait((s) => s.jobs.some((j) => j.message.includes("20 页")));
  if (process.env.MATHECA_HEIC_TEST) {
    const n = (await state()).questions.length;
    await choose([path.resolve(process.env.MATHECA_HEIC_TEST)]);
    await wait((s) => s.questions.length === n + 1);
  }
  mode = "orientation";
  const beforeOrientation = (await state()).questions.length;
  await choose([path.join(root, "rotated.jpg")]);
  await wait((s) => s.questions.length === beforeOrientation + 1);
  assert.deepEqual(imageDimensions, [80, 120]);
  mode = "success";
  const nChinese = (await state()).questions.length;
  await choose([path.join(root, "input-chinese.pdf")]);
  s = await wait((s) => s.questions.length === nChinese + 1);
  const chinese = s.questions.find((q) =>
    q.sourceLabel.startsWith("input-chinese.pdf"),
  );
  const rendered = await app.evaluate(
    async ({ net }, url) =>
      Array.from(new Uint8Array(await (await net.fetch(url)).arrayBuffer())),
    chinese.sourcePath,
  );
  fs.writeFileSync(
    path.join(root, "chinese-pdf-page.jpg"),
    Buffer.from(rendered),
  );
  const before = (await state()).questions.length;
  await choose([path.join(root, "input-20.pdf")]);
  s = await wait(
    (s) =>
      s.jobs.some(
        (j) => j.type === "import" && j.status === "complete" && j.total === 20,
      ),
    120000,
  );
  assert.equal(s.questions.length, before + 20);
  const savedClipboard = await app.evaluate(async ({ clipboard }) => {
    const items = await clipboard.read();
    return Promise.all(
      items.map(async (item) =>
        Promise.all(
          item.types.map(async (type) => [
            type,
            Array.from(
              new Uint8Array(await (await item.getType(type)).arrayBuffer()),
            ),
          ]),
        ),
      ),
    );
  });
  try {
    await app.evaluate(
      async ({ clipboard, ClipboardItem }, bytes) => {
        await clipboard.write([
          new ClipboardItem({
            "image/png": new Blob([new Uint8Array(bytes)], {
              type: "image/png",
            }),
          }),
        ]);
      },
      Array.from(fs.readFileSync(png)),
    );
    await page.locator("h1").click();
    await page.keyboard.press("Control+V");
    await wait((s) => s.questions.length === before + 21);
  } finally {
    await app.evaluate(async ({ clipboard, ClipboardItem }, items) => {
      await clipboard.write(
        items.map(
          (entries) =>
            new ClipboardItem(
              Object.fromEntries(
                entries.map(([type, bytes]) => [
                  type,
                  new Blob([new Uint8Array(bytes)], { type }),
                ]),
              ),
            ),
        ),
      );
    }, savedClipboard);
  }
  const cdp = await page.context().newCDPSession(page),
    drag = { items: [], files: [png], dragOperationsMask: 1 };
  for (const type of ["dragEnter", "dragOver", "drop"])
    await cdp.send("Input.dispatchDragEvent", {
      type,
      x: 800,
      y: 300,
      data: drag,
    });
  await wait((s) => s.questions.length === before + 22);
  await cdp.detach();
  mode = "delayed";
  for (let i = 0; i < 3; i++) await choose([png]);
  s = await wait(
    (s) =>
      s.jobs.filter((j) => j.type === "import" && j.status === "processing")
        .length === 2 &&
      s.jobs.some((j) => j.type === "import" && j.status === "queued"),
  );
  await close();
  mode = "success";
  await launch();
  s = await state();
  const paused = s.jobs.filter(
    (j) => j.type === "import" && j.status === "paused",
  );
  assert.equal(paused.length, 3);
  const count = s.questions.length;
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await state()).questions.length, count);
  await page.evaluate(
    async (ids) => {
      for (const id of ids) await window.matheca.resumeJob(id);
    },
    paused.map((j) => j.id),
  );
  await wait((s) =>
    paused.every(
      (j) => s.jobs.find((k) => k.id === j.id)?.status === "complete",
    ),
  );
  assert.equal((await state()).questions.length, count + 3);
  const formulaQuestion = await page.evaluate(async () => {
    const base = (await window.matheca.state()).questions[0];
    return window.matheca.saveQuestion({
      ...base,
      id: "latex-only",
      body: "",
      latex: "x^2=1",
      autoSolve: false,
    });
  });
  await page.evaluate(
    (id) => window.matheca.solveQuestion(id),
    formulaQuestion.id,
  );
  await wait((s) => !!s.questions.find((q) => q.id === "latex-only")?.solution);
  mode = "delayed";
  s = await state();
  const autoBase = s.questions.find((q) => q.id === human.id);
  await page.evaluate(
    (q) =>
      window.matheca.saveQuestion({
        ...q,
        body: "自动解题初始条件",
        autoSolve: true,
      }),
    autoBase,
  );
  await wait((s) =>
    s.jobs.some((j) => j.questionId === human.id && j.status === "processing"),
  );
  mode = "success";
  await page.evaluate(
    (q) =>
      window.matheca.saveQuestion({
        ...q,
        body: "自动解题新条件",
        autoSolve: true,
      }),
    autoBase,
  );
  s = await wait(
    (s) =>
      s.questions.find((q) => q.id === human.id)?.body === "自动解题新条件" &&
      !!s.questions.find((q) => q.id === human.id)?.solution,
  );
  await page.evaluate(
    (q) => window.matheca.saveQuestion({ ...q, autoSolve: false }),
    s.questions.find((q) => q.id === human.id),
  );
  await close();
  console.log(
    "PASS: real HTTPS Chat Completions, safeStorage, partial retry/cache identity, human edit protection, image assets, solving, late-result cancellation and automatic reschedule, 429/truncation/4MB response, input limits, 20/21 page PDF, EXIF orientation, Windows clipboard/drop, queue limits, close/reopen/explicit resume",
  );
} finally {
  if (app) await app.close();
  for (const timer of pending) clearTimeout(timer);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
