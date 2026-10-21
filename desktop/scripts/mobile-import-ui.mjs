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
let app, desktop, browser, phone;
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
    .getByRole("menuitem", { name: "手机联动", exact: true })
    .click();
  await desktop
    .getByRole("dialog", { name: "手机联动", exact: true })
    .waitFor();
  return desktop.getByRole("dialog", { name: "手机联动", exact: true });
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
  phone = await context.newPage();
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(phoneUrl(await status()));
  await phone.getByText(/请在电脑确认连接/).waitFor();
  assert.ok(
    await phone
      .getByRole("button", { name: "拍一张", exact: true })
      .isDisabled(),
  );
  await modal.getByRole("button", { name: "允许连接", exact: true }).click();
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
  // A request that never reaches the computer stays retryable.
  await phone.route("**/api/upload", (route) => route.abort("failed"));
  await phone.getByRole("button", { name: "发送到电脑", exact: true }).click();
  await phone.getByRole("button", { name: "重试", exact: true }).waitFor();
  assert.equal((await status()).files.length, 0);
  await phone.unroute("**/api/upload");
  // Lose the acknowledgement after commit. Polling recovers the receipt without duplicates.
  await phone.route("**/api/upload", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await phone.getByRole("button", { name: "重试", exact: true }).click();
  await phone.getByText("1 张待发送", { exact: true }).waitFor();
  assert.equal((await status()).files.length, 1);
  await phone.unroute("**/api/upload");
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
  await phone.reload();
  await phone
    .locator("#on-computer")
    .getByText(/第二题/)
    .waitFor();
  await phone
    .locator("#on-computer")
    .getByText(/第一题/)
    .waitFor();
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
  await phone
    .locator("#tasks")
    .getByText(/识别完成/)
    .waitFor();
  await modal.getByRole("tab", { name: "本次识别", exact: true }).click();
  await modal.getByText(/识别完成/).waitFor();
  await modal
    .getByRole("button", { name: "收起手机联动面板", exact: true })
    .click();
  assert.equal(
    (await status()).status,
    "receiving",
    "collapsing the panel keeps the connection alive for editing/export",
  );
  const collectionId = await desktop.evaluate(async () => {
    const state = await window.matheca.state();
    for (const q of state.questions)
      await window.matheca.saveQuestion({ ...q, reviewed: true }, true);
    const id = "mobile-transfer-test";
    await window.matheca.saveCollection({
      id,
      title: "手机联动练习",
      createdAt: Date.now().toString(),
      paperTitle: "手机联动练习",
      examInstructions: "",
      examMinutes: 0,
      totalScore: 0,
    });
    await window.matheca.addQuestions(
      id,
      state.questions.map((q) => q.id),
    );
    return id;
  });
  for (const format of ["pdf", "docx"]) {
    const file = path.join(output, `手机练习.${format}`);
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, file);
    if (format === "pdf") {
      await desktop
        .locator(".sidebar")
        .getByRole("button", { name: "题集", exact: true })
        .click();
      await desktop
        .locator(".collection-card")
        .filter({ hasText: "手机联动练习" })
        .click();
    }
    await desktop
      .getByRole("button", {
        name: format === "pdf" ? "导出 PDF" : "导出 Word",
        exact: true,
      })
      .click();
    await desktop
      .getByRole("button", {
        name: format === "pdf" ? "确认导出 PDF" : "确认导出 Word",
        exact: true,
      })
      .click();
    await desktop
      .getByRole("button", { name: "发送到手机", exact: true })
      .click();
    const shareModal = desktop.getByRole("dialog", {
      name: "手机联动",
      exact: true,
    });
    await shareModal
      .getByRole("button", { name: "发送最近导出的文档", exact: true })
      .click();
    await shareModal
      .getByText("文件已准备好，请在已确认连接的手机页面下载。", {
        exact: true,
      })
      .waitFor();
    await shareModal
      .getByRole("button", { name: "收起手机联动面板", exact: true })
      .click();
    await phone
      .locator("#downloads .download")
      .filter({ hasText: `手机练习.${format}` })
      .waitFor();
    const row = phone
      .locator("#downloads .download")
      .filter({ hasText: `手机练习.${format}` });
    if (format === "pdf") {
      await phone.route("**/api/download/**", (route) => route.abort("failed"));
      await row.getByRole("button", { name: "下载文件", exact: true }).click();
      await row
        .getByRole("button", { name: "重试下载", exact: true })
        .waitFor();
      await phone.unroute("**/api/download/**");
    }
    const downloadPromise = phone.waitForEvent("download");
    await row.getByRole("button", { name: /下载/ }).click();
    const download = await downloadPromise;
    const target = path.join(output, `downloaded.${format}`);
    await download.saveAs(target);
    assert.deepEqual(fs.readFileSync(target), fs.readFileSync(file));
    await row.getByText(/已传到浏览器/).waitFor();
  }
  assert.equal((await status()).transfers.length, 2);
  await assert.rejects(
    () =>
      desktop.evaluate(
        (file) => window.matheca.mobileShare(file),
        path.join(output, "data", "library.sqlite"),
      ),
    /仅可发送/,
  );
  const activeModal = await open();
  await activeModal.getByRole("tab", { name: "发往手机", exact: true }).click();
  await activeModal.getByText("手机练习.pdf", { exact: true }).waitFor();
  await desktop.screenshot({ path: path.join(output, "desktop-files.png") });
  await phone.screenshot({
    path: path.join(output, "phone-results.png"),
    fullPage: true,
  });
  await activeModal.getByRole("tab", { name: /收到的照片/ }).click();
  // Receive another batch, pause, and restart the actual portable EXE.
  const session = await status(),
    url = new URL(phoneUrl(session));
  const token = new URLSearchParams(url.hash.slice(1)).get("pair");
  const device = await phone.evaluate(
    (token) => sessionStorage.getItem("matheca-device-" + token),
    token,
  );
  const response = await fetch(url.origin + "/api/upload", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "X-Device-Id": device,
      "Content-Type": "application/octet-stream",
      "X-Upload-Id": "1234567890abcdef1234567890abcdef",
      "X-File-Name": encodeURIComponent("留待下次.png"),
    },
    body: png,
  });
  assert.ok(response.ok);
  await modal.getByRole("button", { name: "结束连接", exact: true }).click();
  await modal.waitFor({ state: "detached" });
  assert.equal((await status()).status, "closed");
  await assert.rejects(() =>
    fetch(url.origin + "/api/download/" + session.transfers[0].id, {
      headers: { Authorization: "Bearer " + token, "X-Device-Id": device },
    }),
  );
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
} catch (error) {
  await desktop
    ?.screenshot({ path: path.join(output, "failure-desktop.png") })
    .catch(() => {});
  await phone
    ?.screenshot({
      path: path.join(output, "failure-phone.png"),
      fullPage: true,
    })
    .catch(() => {});
  if (phone)
    console.log(
      "Phone downloads:",
      await phone
        .locator("#downloads")
        .innerText()
        .catch(() => "unavailable"),
    );
  throw error;
} finally {
  await browser?.close();
  await app?.close();
  await new Promise((resolve) => mock.close(resolve));
}
