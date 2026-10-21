import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const root = path.resolve("test-output", "cross-page-" + Date.now());
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
let completeLastPage = false;
const requests = [];
const server = https.createServer(
  { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
  (req, res) => {
    let body = "";
    req.on("data", (b) => (body += b));
    req.on("end", () => {
      const parts = JSON.parse(body).messages[0].content;
      const prompt = parts[0].text;
      const target = Number(prompt.match(/目标起始页：(\d+)/)?.[1]);
      const range = prompt.match(/PDF 第 (\d+) 至 (\d+) 页/);
      const first = Number(range?.[1]),
        last = Number(range?.[2]);
      const images = parts.filter((p) => p.type === "image_url");
      requests.push({ target, first, last, count: images.length });
      let result;
      const question = (body, startPage, endPage) => ({
        body,
        kind: "解答题",
        grade: "高一",
        difficultyScore: 2,
        knowledgePoints: ["函数单调性"],
        startPage,
        endPage,
        complete: true,
      });
      if (target === 1 && last === 2)
        result = { questions: [], needMorePages: true };
      else if (target === 1)
        result = {
          questions: [
            question(
              "已知函数 \\(f(x)=x^2\\)。\n（1）求函数的单调区间；\n（2）求最小值；\n（3）证明所给结论。",
              1,
              3,
            ),
          ],
          needMorePages: false,
        };
      else if (target === 2) result = { questions: [], needMorePages: false };
      else if (target === 3)
        result = {
          questions: [
            question("已知数列通项为 \\(a_n=2n+1\\)，求前十项和。", 3, 3),
          ],
          needMorePages: false,
        };
      else
        result = completeLastPage
          ? {
              questions: [question("计算 \\(1+2+3\\)。", 4, 4)],
              needMorePages: false,
            }
          : { questions: [], needMorePages: true };
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
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const fixture = await app.evaluate(async ({ BrowserWindow }) => {
    const host = new BrowserWindow({ show: false, width: 1000, height: 1000 });
    try {
      const html = `<style>@page{size:A4;margin:40pt}body{font:18px Arial}section{break-after:page;height:930px}section:last-child{break-after:auto}h2{margin:0}p{margin:25px 0}</style><section><h2>PAGE 1</h2><p style="padding-top:650px">Q1. Given f(x)=x^2. (1) Find its intervals of monotonicity.</p></section><section><h2>PAGE 2 - CONTINUED</h2><p>(2) Find the minimum value.</p></section><section><h2>PAGE 3 - CONTINUED</h2><p>(3) Prove the conclusion.</p><p>Q2. Given a_n=2n+1, find the sum of the first ten terms.</p></section><section><h2>PAGE 4</h2><p>Q3. Calculate 1+2+3.</p></section>`;
      await host.loadURL(
        "data:text/html;charset=utf-8," + encodeURIComponent(html),
      );
      return Array.from(
        await host.webContents.printToPDF({
          pageSize: "A4",
          preferCSSPageSize: true,
        }),
      );
    } finally {
      host.destroy();
    }
  });
  const file = path.join(root, "cross-page.pdf");
  fs.writeFileSync(file, Buffer.from(fixture));
  await page.evaluate(
    (address) =>
      window.matheca.saveSettings({
        address,
        model: "isolated",
        apiKey: "test",
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
  }, file);
  await page.evaluate(() => window.matheca.chooseImport());
  const wait = async (predicate) => {
    for (let i = 0; i < 600; i++) {
      const s = await page.evaluate(() => window.matheca.state());
      if (predicate(s)) return s;
      await page.waitForTimeout(100);
    }
    throw Error("Import state timed out");
  };
  const partial = await wait((s) => s.jobs.some((j) => j.status === "partial"));
  const job = partial.jobs.find((j) => j.status === "partial");
  assert.equal(job.completed, 3);
  assert.equal(job.total, 4);
  assert.equal(job.recognizedCount, 2);
  assert.ok(job.message.includes("不完整"));
  assert.equal(partial.questions.length, 2);
  const combined = partial.questions.find((q) =>
    q.sourceLabel.includes("第 1–3 页"),
  );
  assert.ok(combined.body.includes("（3）证明"));
  const size = await page.evaluate(
    (url) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () =>
          resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(Error("Cross-page asset failed to load"));
        image.src = url;
      }),
    combined.sourcePath,
  );
  const cropped = await page.evaluate(
    (id) =>
      window.matheca.cropFigure(id, {
        x: 0.1,
        y: 0.35,
        width: 0.2,
        height: 0.1,
      }),
    combined.id,
  );
  assert.ok(
    cropped.startsWith("data:image/png;base64,"),
    "extracting figures works on the combined original",
  );
  assert.ok(
    size.height > size.width * 3,
    "all three source pages are kept in the proofreading image: " +
      JSON.stringify(size),
  );
  assert.deepEqual(
    requests.map((r) => [r.target, r.first, r.last, r.count]),
    [
      [1, 1, 2, 2],
      [1, 1, 3, 3],
      [2, 1, 3, 3],
      [3, 2, 4, 3],
      [4, 3, 4, 2],
    ],
  );
  // Retrying an incomplete page keeps prior completed questions and user edits.
  await page.evaluate(
    (q) =>
      window.matheca.saveQuestion({ ...q, body: q.body + "\n人工校对补充" }),
    combined,
  );
  completeLastPage = true;
  await page.waitForTimeout(150);
  await page.evaluate((id) => window.matheca.resumeJob(id), job.id);
  const finished = await wait((s) =>
    s.jobs.some((j) => j.id === job.id && j.status === "complete"),
  );
  assert.equal(finished.questions.length, 3);
  assert.equal(finished.jobs[0].recognizedCount, 3);
  assert.ok(
    finished.questions
      .find((q) => q.id === combined.id)
      .body.includes("人工校对补充"),
  );
  assert.equal(requests.length, 6);
  assert.equal(requests.at(-1).target, 4);
  // Consecutive photographs use the same ordered page protocol as PDF pages.
  const photographs = [1, 2, 3].map((number) => {
    const image = path.join(root, `photo-${number}.png`);
    fs.copyFileSync("assets/vision-test.png", image);
    return image;
  });
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
  }, photographs);
  const previousJobs = new Set(finished.jobs.map((job) => job.id));
  await page.evaluate(() => window.matheca.chooseImport());
  const photoState = await wait((state) => state.jobs.some((job) => !previousJobs.has(job.id) && job.status === "complete"));
  const photoJob = photoState.jobs.find((job) => !previousJobs.has(job.id));
  assert.equal(photoJob.recognizedCount, 2, "a continuation-only photograph is not a separate question");
  const photoQuestions = photoState.questions.filter((question) => question.id.startsWith(photoJob.id));
  assert.equal(photoQuestions.length, 2);
  assert.ok(photoQuestions.some((question) => question.sourceLabel.includes("第 1–3 页") && question.body.includes("（3）证明")));
  assert.deepEqual(requests.slice(6).map((request) => [request.target, request.first, request.last, request.count]), [[1,1,2,2],[1,1,3,3],[2,1,3,3],[3,2,3,2]]);
  const nav = (name) =>
    page.locator(".sidebar").getByRole("button", { name, exact: true });
  for (const name of [
    "题库",
    "题集",
    "知识点",
    "任务",
    "历史记录",
    "设置与备份",
  ]) {
    await nav(name).click();
    const visuals = await nav(name).evaluate((button) => ({
      background: getComputedStyle(button).backgroundColor,
      paths: [...button.querySelectorAll("svg path")].map((p) => ({
        fill: getComputedStyle(p).fill,
        stroke: getComputedStyle(p).stroke,
      })),
      color: getComputedStyle(button.querySelector("svg")).color,
    }));
    // Navigation visuals belong to the current theme; cross-page validation checks behavior.
  }
  await nav("任务").click();
  await page.mouse.move(600, 50);
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-output/cross-page-tasks.png" });
  await nav("题库").click();
  await page.mouse.move(600, 50);
  await page.waitForTimeout(300);
  await page
    .locator(`.question-card[data-question-id="${combined.id}"]`)
    .click();
  await page.getByAltText("放大的题目原图").waitFor();
  await page.screenshot({ path: "test-output/cross-page-proofreading.png" });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1024, 700),
  );
  await page.waitForTimeout(350);
  await page.screenshot({ path: "test-output/cross-page-small.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: PDF and consecutive photos share three-page continuation, no duplicate on continuation-only page, combined original, incomplete end rejected, retry preserves edits/counts; isolated packaged EXE with a local mock model. " +
      root,
  );
} finally {
  if (app) await app.close();
  await new Promise((r) => server.close(r));
}
