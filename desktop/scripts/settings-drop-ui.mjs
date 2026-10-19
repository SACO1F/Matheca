import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import https from "node:https";
import { execFileSync } from "node:child_process";
const root = path.resolve("test-output", "settings-drop-" + Date.now());
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
const server = https.createServer(
  { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
  (req, res) => {
    let body = "";
    req.on("data", (b) => (body += b));
    req.on("end", () => {
      const input = JSON.parse(body),
        prompt = input.messages[0].content[0].text;
      const page = Number(prompt.match(/目标起始页：(\d+)/)?.[1] ?? 1);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  needMorePages: false,
                  questions: [
                    {
                      body: "拖入验证：已知函数 f(x)=x²，求 f(2)。",
                      kind: "计算题",
                      grade: "高一",
                      difficultyScore: 1,
                      knowledgePoints: ["函数单调性"],
                      startPage: page,
                      endPage: page,
                      complete: true,
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
  const nav = (name) =>
    page.locator(".sidebar").getByRole("button", { name, exact: true });
  await page.evaluate(async (port) => {
    await window.matheca.examples();
    await window.matheca.saveSettings({
      theme: "LIGHT",
      address: `https://localhost:${port}/v1`,
      model: "isolated-mock",
      apiKey: "isolated-test-key",
      autoSolveImports: false,
    });
  }, server.address().port);
  const state = () => page.evaluate(() => window.matheca.state());
  const wait = async (predicate) => {
    for (let i = 0; i < 200; i++) {
      const s = await state();
      if (predicate(s)) return s;
      if (s.jobs.some((j) => j.status === "failed"))
        throw Error(s.jobs.find((j) => j.status === "failed").message);
      await page.waitForTimeout(100);
    }
    throw Error("timed out waiting for imported state");
  };
  const zip = path.join(root, "Windows题库.zip");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, zip);
  await page.evaluate(() => window.matheca.exportBackup());
  await nav("设置与备份").click();
  assert.equal(
    await page.getByRole("heading", { name: "桌面录入", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "选择文件", exact: true }).count(),
    0,
  );
  assert.ok(
    await page
      .getByRole("button", { name: "导入 Windows 题库", exact: true })
      .isVisible(),
  );
  assert.ok(
    (await page.locator(".settings-page").innerText()).includes(
      "Android 题库导入暂未开放",
    ),
  );
  await page.screenshot({ path: "test-output/settings-windows-import.png" });
  await page
    .getByRole("button", { name: "导入 Windows 题库", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "题库导入预览", exact: true })
    .waitFor();
  await page
    .locator(".modal")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  const cdp = await page.context().newCDPSession(page);
  const drag = async (files, drop = true) => {
    const data = { items: [], files, dragOperationsMask: 1 };
    for (const type of ["dragEnter", "dragOver", ...(drop ? ["drop"] : [])])
      await cdp.send("Input.dispatchDragEvent", { type, x: 800, y: 350, data });
  };
  const png = path.join(root, "图像题.png");
  fs.copyFileSync(path.resolve("assets/vision-test.png"), png);
  await drag([png], false);
  await page.getByText("松开即可导入文件", { exact: true }).waitFor();
  await page.screenshot({ path: "test-output/file-drop-overlay.png" });
  await cdp.send("Input.dispatchDragEvent", {
    type: "drop",
    x: 800,
    y: 350,
    data: { items: [], files: [png], dragOperationsMask: 1 },
  });
  await wait((s) => s.questions.length === 4);
  assert.equal(await page.locator("h1").innerText(), "任务");
  assert.equal(await page.locator(".import-drop-overlay").count(), 0);
  // A File with no disk path follows the byte-based image import branch.
  await nav("设置与备份").click();
  await page.evaluate(
    (bytes) => {
      const file = new File([new Uint8Array(bytes)], "浏览器拖入图片.png", {
        type: "image/png",
      });
      const dt = new DataTransfer();
      dt.items.add(file);
      const target = document.querySelector(".settings-page input");
      target.dispatchEvent(
        new DragEvent("dragenter", { bubbles: true, dataTransfer: dt }),
      );
      target.dispatchEvent(
        new DragEvent("dragenter", { bubbles: true, dataTransfer: dt }),
      );
      target.dispatchEvent(
        new DragEvent("dragleave", { bubbles: true, dataTransfer: dt }),
      );
      window.dropFixture = dt;
    },
    Array.from(fs.readFileSync(png)),
  );
  await page.locator(".import-drop-overlay").waitFor();
  assert.ok(
    await page.locator(".import-drop-overlay").isVisible(),
    "child dragleave keeps the overlay until the full drag leaves",
  );
  await page.evaluate(() =>
    document.querySelector(".settings-page input").dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: window.dropFixture,
      }),
    ),
  );
  await wait((s) => s.questions.length === 5);
  assert.ok(
    (await state()).jobs.some((j) =>
      j.sourceFiles?.some((f) => f.name === "浏览器拖入图片.png"),
    ),
  );
  const pdf = path.join(root, "拖入题目.pdf");
  const pdfBytes = await app.evaluate(async ({ BrowserWindow }) => {
    const host = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true },
    });
    try {
      await host.loadURL(
        "data:text/html," +
          encodeURIComponent(
            "<h1>PDF import fixture</h1><p>f(x) = x squared</p>",
          ),
      );
      return Array.from(await host.webContents.printToPDF({}));
    } finally {
      host.destroy();
    }
  });
  fs.writeFileSync(pdf, Buffer.from(pdfBytes));
  await drag([pdf]);
  await wait((s) => s.questions.length === 6);
  const jobs = (await state()).jobs.length;
  const text = path.join(root, "unsupported.txt");
  fs.writeFileSync(text, "fixture");
  await drag([text]);
  await page
    .getByRole("alert")
    .getByText("请选择图片、PDF 或 Windows 题库 ZIP", { exact: true })
    .waitFor();
  assert.equal((await state()).jobs.length, jobs);
  await drag(Array(21).fill(png));
  await page
    .getByRole("alert")
    .getByText("一次最多导入 20 个文件", { exact: true })
    .waitFor();
  assert.equal((await state()).jobs.length, jobs);
  await nav("设置与备份").click();
  await drag([zip]);
  await page
    .getByRole("heading", { name: "题库导入预览", exact: true })
    .waitFor();
  assert.equal((await state()).questions.length, 6, "ZIP awaits confirmation");
  await drag([png]);
  await page
    .locator(".swipe-toast")
    .getByText("请先完成或关闭当前操作，再拖入文件", { exact: true })
    .waitFor();
  assert.equal((await state()).jobs.length, jobs);
  await page
    .locator(".modal")
    .getByRole("button", { name: "确认合并导入", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "题库导入预览", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal((await state()).questions.length, 6);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1024, 700),
  );
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-output/settings-windows-minimum.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Windows-only settings copy, removed desktop entry block, native disk image/PDF drops, in-memory image drops over text fields, stable nested drag highlight, invalid/too-many files, ZIP preview/confirmation and modal blocking, minimum window; isolated mock AI/data.",
  );
} finally {
  await app?.close();
  await new Promise((resolve) => server.close(resolve));
}
