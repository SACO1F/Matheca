import { _electron as electron, chromium } from "playwright";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const output = path.resolve("test-output", `mobile-import-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
const cert = path.join(output, "localhost.crt"),
  key = path.join(output, "localhost.key");
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
let requests = 0;
const mock = https.createServer(
  { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
  (req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests++;
      assert.equal(req.headers.authorization, "Bearer mobile-local-test");
      assert.ok(
        JSON.parse(body).messages[0].content.some(
          (part) => part.type === "image_url",
        ),
      );
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  questions: [
                    {
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
        }),
      );
    });
  },
);
await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
const exe =
  process.env.MATHECA_EXE ||
  fs
    .readFileSync("releases/latest.txt", "utf8")
    .match(/^EXE: (.+)$/m)[1]
    .trim();
const env = {
  ...process.env,
  MATHECA_TEST_DATA: path.join(output, "data"),
  NODE_EXTRA_CA_CERTS: cert,
};
delete env.ELECTRON_RUN_AS_NODE;
let app, desktop, browser;
const errors = [];
const launch = async () => {
  app = await electron.launch({ executablePath: exe, env });
  desktop = await app.firstWindow();
  desktop.on("pageerror", (e) => errors.push(e.message));
  await desktop.locator("h1").waitFor();
};
const status = () => desktop.evaluate(() => window.matheca.mobileStatus());
const open = async () => {
  await desktop.getByRole("button", { name: "新建题目", exact: true }).click();
  await desktop
    .getByRole("menuitem", { name: "手机拍照导入", exact: true })
    .click();
  await desktop.getByText("等待手机扫码", { exact: true }).waitFor();
  return desktop.getByRole("dialog", { name: "手机拍照导入", exact: true });
};
const phoneUrl = (state) => {
  const url = new URL(state.urls[0]);
  url.hostname = "127.0.0.1";
  return url.href;
};
try {
  await launch();
  const modal = await open();
  browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const phone = await context.newPage();
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(phoneUrl(await status()));
  await phone.getByText("已连接电脑 · 可以连续拍摄", { exact: true }).waitFor();
  assert.equal(
    await phone.locator("#camera-file").getAttribute("capture"),
    "environment",
  );
  const png = fs.readFileSync("assets/vision-test.png");
  await phone.locator("#album-file").setInputFiles([
    { name: "第一题.png", mimeType: "image/png", buffer: png },
    { name: "第二题.png", mimeType: "image/png", buffer: png },
  ]);
  await phone
    .locator(".photo")
    .nth(1)
    .getByRole("button", { name: "上移", exact: true })
    .click();
  assert.match(
    await phone.locator(".photo .name").first().textContent(),
    /第二题/,
  );
  // Lose the acknowledgement after the server commits. Retrying must not duplicate.
  await phone.route("**/api/upload", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await phone.getByRole("button", { name: "发送到电脑", exact: true }).click();
  await phone.getByRole("button", { name: "重试", exact: true }).waitFor();
  assert.equal((await status()).files.length, 1);
  await phone.unroute("**/api/upload");
  await phone.getByRole("button", { name: "重试", exact: true }).click();
  await phone.getByText("1 张待发送", { exact: true }).waitFor();
  await phone.getByRole("button", { name: "发送到电脑", exact: true }).click();
  await phone.getByText("0 张待发送", { exact: true }).waitFor();
  const received = await status();
  assert.equal(received.files.length, 2);
  assert.match(received.files[0].name, /第二题/);
  assert.equal(requests, 0, "upload must not trigger recognition");
  await modal.locator(".mobile-photo").nth(1).waitFor();
  await phone.screenshot({
    path: path.join(output, "phone-390.png"),
    fullPage: true,
  });
  await phone.setViewportSize({ width: 844, height: 390 });
  await phone.screenshot({
    path: path.join(output, "phone-landscape.png"),
    fullPage: true,
  });
  assert.ok(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await phone.setViewportSize({ width: 390, height: 844 });
  await desktop.screenshot({ path: path.join(output, "desktop.png") });
  await modal.locator(".mobile-photo button").first().click();
  await desktop.waitForFunction(
    async () => (await window.matheca.mobileStatus()).files.length === 1,
  );
  await modal.getByRole("button", { name: /开始识别/ }).click();
  await modal.getByRole("alert").waitFor();
  assert.equal(
    (await status()).files.length,
    1,
    "configuration failure keeps received photo",
  );
  await desktop.evaluate(
    async (address) =>
      window.matheca.saveSettings({
        theme: "LIGHT",
        address,
        model: "mobile-test",
        apiKey: "mobile-local-test",
        autoSolveImports: false,
      }),
    `https://localhost:${mock.address().port}/v1`,
  );
  await modal.getByRole("button", { name: /开始识别/ }).click();
  await modal.getByText(/已将 1 张照片加入识别任务/).waitFor();
  let state;
  const deadline = Date.now() + 60000;
  do {
    state = await desktop.evaluate(() => window.matheca.state());
    if (
      state.questions.length === 1 &&
      state.jobs.some((job) => job.status === "complete")
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.equal(
    state.questions.length,
    1,
    "mock recognition creates one question",
  );
  assert.equal(state.questions[0].reviewed, false);
  assert.ok(requests > 0);
  assert.equal((await status()).files.length, 0);
  // Receive another batch, pause, and restart the actual portable EXE.
  const session = await status(),
    url = new URL(phoneUrl(session));
  const token = new URLSearchParams(url.hash.slice(1)).get("pair");
  const response = await fetch(url.origin + "/api/upload", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/octet-stream",
      "X-Upload-Id": "1234567890abcdef1234567890abcdef",
      "X-File-Name": encodeURIComponent("留待下次.png"),
    },
    body: png,
  });
  assert.ok(response.ok);
  await modal.getByRole("button", { name: "结束接收", exact: true }).click();
  await modal.waitFor({ state: "detached" });
  assert.equal((await status()).status, "closed");
  await app.close();
  app = undefined;
  await launch();
  assert.equal(
    (await status()).files.length,
    1,
    "pending inbox survives restart",
  );
  await open();
  await desktop.locator(".mobile-photo").waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1024, 700),
  );
  await desktop.evaluate(() =>
    window.matheca.saveSettings({
      theme: "LIGHT",
      address: "https://localhost/v1",
      model: "mobile-test",
      clearApiKey: true,
      autoSolveImports: false,
    }),
  );
  await desktop
    .locator(".mobile-import-dialog")
    .getByRole("button", { name: /开始识别/ })
    .click();
  await desktop.locator(".mobile-import-dialog").getByRole("alert").waitFor();
  assert.ok(
    await desktop
      .locator(".mobile-import-dialog")
      .getByRole("button", { name: /开始识别/ })
      .evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight;
      }),
    "recognition action remains inside compact viewport with a photo and error",
  );
  await desktop.screenshot({ path: path.join(output, "desktop-compact.png") });
  assert.ok(
    await desktop
      .locator(".mobile-pairing")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
    "compact pairing column has no horizontal overflow",
  );
  assert.ok(
    await desktop
      .locator(".mobile-import-dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  );
  assert.ok(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: paired mobile web UI, reorder, lost-ack retry without duplicates, preview/remove, deferred mock recognition to pending question, pause/restart recovery, phone390 and desktop1024. " +
      output,
  );
} finally {
  await browser?.close();
  await app?.close();
  await new Promise((resolve) => mock.close(resolve));
}
