import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import https from "node:https";
import { execFileSync } from "node:child_process";
const root = path.resolve("test-output", "screenshot-import-" + Date.now());
fs.mkdirSync(root, { recursive: true });
const key = path.join(root, "key.pem"),
  cert = path.join(root, "cert.pem");
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
let submittedImage;
const server = https.createServer(
  { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
  (req, res) => {
    let body = "";
    req.on("data", (b) => (body += b));
    req.on("end", () => {
      const input = JSON.parse(body);
      submittedImage = input.messages[0].content.find(
        (p) => p.type === "image_url",
      )?.image_url.url;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  questions: [
                    {
                      body: "已知函数 f(x)=x²，求 f(2) 的值。",
                      kind: "计算题",
                      grade: "高一",
                      difficultyScore: 1,
                      knowledgePoints: ["函数的概念与性质"],
                    },
                  ],
                }),
              },
            },
          ],
        }),
      );
    });
  },
);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const env = {
  ...process.env,
  MATHECA_TEST_DATA: root,
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
  await page.evaluate(
    async (port) =>
      window.matheca.saveSettings({
        theme: "LIGHT",
        address: `https://localhost:${port}/v1`,
        model: "isolated-mock",
        apiKey: "isolated-test-key",
        autoSolveImports: false,
      }),
    server.address().port,
  );
  // Cover every display with isolated fixture content before exercising real
  // desktopCapturer. User windows remain open and their content is not recorded.
  await app.evaluate(async ({ BrowserWindow, screen }) => {
    for (const display of screen.getAllDisplays()) {
      const fixture = new BrowserWindow({
        ...display.bounds,
        fullscreen: true,
        frame: false,
        show: false,
        title: "Isolated capture fixture",
        alwaysOnTop: true,
        webPreferences: { sandbox: true },
      });
      await fixture.loadURL(
        "data:text/html;charset=utf-8," +
          encodeURIComponent(
            '<body style="margin:0;background:white;color:#26334b;font:26px sans-serif"><main style="padding:120px"><h1>截图识别验证</h1><p>已知函数 f(x) = x²，求 f(2) 的值。</p><p>A. 2　B. 4　C. 6　D. 8</p></main></body>',
          ),
      );
      fixture.show();
    }
  });
  const start = async () => {
    const waiting = app.waitForEvent("window", {
      predicate: (w) => w.url().includes("capture.html"),
    });
    await page.getByRole("button", { name: "新建题目", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "截图导入题目", exact: true })
      .click();
    const capture = await waiting;
    await capture.locator("#screen").waitFor();
    await capture.waitForFunction(
      () => document.querySelector("#screen").naturalWidth > 0,
    );
    return capture;
  };
  let capture = await start();
  await capture.keyboard.press("Escape").catch((error) => {
    if (!capture.isClosed()) throw error;
  });
  await page.waitForTimeout(250);
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).jobs.length,
    0,
    "cancel creates no recognition task",
  );
  assert.ok(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "Matheca")
        .isVisible(),
    ),
  );
  capture = await start();
  await capture.mouse.move(100, 100);
  await capture.mouse.down();
  await capture.mouse.move(600, 340, { steps: 8 });
  await capture.mouse.up();
  await capture.getByRole("button", { name: "重新框选", exact: true }).click();
  assert.ok(await capture.locator("#selection").isHidden());
  await capture.mouse.move(620, 380);
  await capture.mouse.down();
  await capture.mouse.move(80, 90, { steps: 8 });
  await capture.mouse.up();
  const expected = await capture.evaluate(() => {
    const img = document.querySelector("#screen"),
      r = document.querySelector("#selection").getBoundingClientRect();
    return {
      width: Math.round((r.width * img.naturalWidth) / innerWidth),
      height: Math.round((r.height * img.naturalHeight) / innerHeight),
    };
  });
  await capture.screenshot({ path: "test-output/screenshot-selection.png" });
  await capture
    .getByRole("button", { name: "识别此截图", exact: true })
    .press("Enter")
    .catch((error) => {
      if (!capture.isClosed()) throw error;
    });
  for (let i = 0; i < 150; i++) {
    const state = await page.evaluate(() => window.matheca.state());
    if (state.jobs[0]?.status === "complete") break;
    if (state.jobs[0]?.status === "failed") throw Error(state.jobs[0].message);
    await page.waitForTimeout(100);
  }
  const state = await page.evaluate(() => window.matheca.state());
  assert.equal(state.jobs[0].status, "complete");
  assert.equal(state.questions.length, 1);
  assert.ok(state.jobs[0].sourceFiles[0].name.startsWith("截图-"));
  assert.equal(await page.locator("h1").innerText(), "任务");
  assert.ok(submittedImage?.startsWith("data:image/"));
  const size = await app.evaluate(
    ({ nativeImage }, url) => nativeImage.createFromDataURL(url).getSize(),
    submittedImage,
  );
  assert.ok(
    Math.abs(size.width - expected.width) <= 1 &&
      Math.abs(size.height - expected.height) <= 1,
    "capture preserves display DPI and selected region",
  );
  assert.equal(
    await app.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().filter((w) =>
          w.getTitle().includes("截图导入"),
        ).length,
    ),
    0,
  );
  await page.screenshot({ path: "test-output/screenshot-import-task.png" });
  assert.ok(
    (await page.evaluate(() => window.matheca.historyList())).records.some(
      (r) => r.title === "截图导入题目" && r.status === "done",
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real display capture behind hidden app, Escape cancellation, reverse drag, reset, Enter confirmation, DPI-correct crop, actual recognition pipeline with isolated mock AI, task/history details and overlay cleanup. Isolated data: " +
      root,
  );
} finally {
  if (app) {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((w) => w.getTitle() === "Isolated capture fixture")
        .forEach((w) => w.destroy()),
    );
    await app.close();
  }
  await new Promise((resolve) => server.close(resolve));
}
