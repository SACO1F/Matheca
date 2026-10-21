import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import yazl from "yazl";
import yauzl from "yauzl";
import { stringify, parse } from "lossless-json";
import { pipeline } from "node:stream/promises";

const output = path.resolve("test-output", "android-exchange-" + Date.now());
fs.mkdirSync(output, { recursive: true });
const adb =
  process.env.MATHECA_ADB ||
  "C:/Users/10052/AppData/Local/Android/Sdk/platform-tools/adb.exe";
const serial = process.env.MATHECA_ANDROID_SERIAL || "emulator-5580";
const png = fs.readFileSync("assets/vision-test.png"),
  digest = createHash("sha256").update(png).digest("hex");
const base = {
  title: "桌面标准格式",
  body: "请选择正确的图形。A. 1 B. 2 C. 3 D. 4",
  latex: "",
  grade: "高一",
  kind: "选择题",
  difficulty: "基础",
  knowledge: "函数单调性",
  sourceEntry: `sources/${digest}.png`,
  sourceLabel: "桌面原始图片",
  reviewed: true,
  favorite: true,
  example: false,
  createdAt: 9007199254740993n,
  autoSolve: false,
  solution: "答案：B",
  solutionLatex: "",
  solutionCurrent: true,
  solutionError: "",
  figures: ["data:image/png;base64," + png.toString("base64")],
  figureWidths: [80],
  figurePlacements: ["B"],
};
const collection = {
  id: "desktop-c",
  title: "桌面题集",
  createdAt: 123n,
  paperTitle: "试卷标题",
  examInstructions: "写出过程",
  examMinutes: 90,
  totalScore: 100,
  questionLayout: { "desktop-q": { answerSpaceMm: 60, pageBreakBefore: true } },
};
const fixture = {
  format: "MathecaLibraryBackup",
  version: 1,
  questions: [
    { ...base, id: "desktop-q" },
    {
      ...base,
      id: "desktop-second",
      title: "第二道题",
      createdAt: 9n,
      figures: [],
      figureWidths: [],
      figurePlacements: [],
    },
  ],
  collections: [collection],
  items: [
    { collectionId: collection.id, questionId: "desktop-q", position: 0 },
    { collectionId: collection.id, questionId: "desktop-second", position: 1 },
  ],
  customKnowledge: [],
  missingSources: 0,
};
const archive = path.join(output, "desktop-fixture.zip"),
  zip = new yazl.ZipFile();
zip.addBuffer(Buffer.from(stringify(fixture)), "manifest.json");
zip.addBuffer(png, `sources/${digest}.png`);
zip.end();
await pipeline(zip.outputStream, fs.createWriteStream(archive));
const exe =
  process.env.MATHECA_EXE ||
  fs
    .readFileSync("releases/latest.txt", "utf8")
    .match(/^EXE: (.+)$/m)[1]
    .trim();
const env = { ...process.env, MATHECA_TEST_DATA: path.join(output, "data") };
delete env.ELECTRON_RUN_AS_NODE;
let app, page, processHandle;
const errors = [];
try {
  app = await electron.launch({ executablePath: exe, env });
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("h1").waitFor();
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, archive);
  await page.evaluate(async () => {
    const p = await window.matheca.inspectBackup();
    await window.matheca.restoreBackup(p.token);
  });
  await page.getByRole("button", { name: "新建题目", exact: true }).click();
  await page.getByRole("menuitem", { name: "手机联动", exact: true }).click();
  const earlyDialog = page.getByRole("dialog", {
    name: "手机联动",
    exact: true,
  });
  await earlyDialog.getByRole("tab", { name: "题库交换", exact: true }).click();
  await earlyDialog
    .locator("details")
    .filter({ hasText: "选择题集" })
    .locator("summary")
    .click();
  await earlyDialog.getByLabel("桌面题集", { exact: true }).check();
  await earlyDialog
    .getByRole("button", { name: "发送所选资料到手机", exact: true })
    .click();
  await page.waitForFunction(
    async () => (await window.matheca.mobileStatus()).transfers.length === 1,
  );
  await page.screenshot({
    path: path.join(output, "desktop-exchange-send.png"),
  });
  const state = await page.evaluate(() => window.matheca.mobileStatus());
  const url = new URL(state.urls[0]);
  // Emulator-only TCP forwarding preserves the server's production Host validation.
  execFileSync(
    adb,
    ["-s", serial, "reverse", `tcp:${url.port}`, `tcp:${url.port}`],
    { stdio: "pipe", windowsHide: true },
  );
  url.hostname = "127.0.0.1";
  processHandle = spawn(
    adb,
    [
      "-s",
      serial,
      "shell",
      "am",
      "instrument",
      "-w",
      "-e",
      "class",
      process.argv.includes("--native-ui")
        ? "com.mathector.app.DesktopConnectedUiTest"
        : "com.mathector.app.DesktopExchangeTest",
      "-e",
      "desktopUrl",
      url.href,
      "com.mathector.app.test/androidx.test.runner.AndroidJUnitRunner",
    ],
    { windowsHide: true },
  );
  let logs = "",
    ended = false,
    code;
  processHandle.stdout.on("data", (b) => (logs += b));
  processHandle.stderr.on("data", (b) => (logs += b));
  processHandle.on("exit", (c) => {
    code = c;
    ended = true;
  });
  const deadline = Date.now() + 240000;
  while (!ended && Date.now() < deadline) {
    const current = await page.evaluate(() => window.matheca.mobileStatus());
    if (current.pairing && !current.pairing.approved)
      await page.evaluate(
        (id) => window.matheca.mobileApprove(id),
        current.pairing.id,
      );
    await new Promise((r) => setTimeout(r, 200));
  }
  fs.writeFileSync(path.join(output, "android-instrumentation.log"), logs);
  assert.ok(ended, "Android test timed out");
  assert.equal(code, 0);
  assert.match(logs, /OK \(1 test\)/);
  if (!process.argv.includes("--native-ui")) {
    const unchanged = await page.evaluate(async () => {
      try {
        await window.matheca.mobileSendLibrary({
          questionIds: ["desktop-q"],
          collectionIds: ["desktop-c"],
          changedOnly: true,
        });
        return "unexpected transfer";
      } catch (error) {
        return error.message;
      }
    });
    assert.match(unchanged, /一致，无需发送/);
    const beforeCount = (
      await page.evaluate(() => window.matheca.mobileStatus())
    ).transfers.length;
    await page.evaluate(async () => {
      const q = (await window.matheca.state()).questions.find(
        (q) => q.id === "desktop-second",
      );
      await window.matheca.saveQuestion({ ...q, body: "第三阶段增量修改" });
      await window.matheca.mobileSendLibrary({
        questionIds: [],
        collectionIds: ["desktop-c"],
        changedOnly: true,
      });
    });
    assert.equal(
      (await page.evaluate(() => window.matheca.mobileStatus())).transfers
        .length,
      beforeCount + 1,
    );
  }
  const received = await page.evaluate(() => window.matheca.mobileStatus());
  assert.equal(received.files.length, 1);
  assert.equal(
    received.libraries.filter((i) => i.status === "received").length,
    1,
  );
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).jobs.length,
    0,
    "transport must not start AI jobs",
  );
  const dialog = page.getByRole("dialog", { name: "手机联动", exact: true });
  if ((await page.evaluate(()=>window.matheca.mobileStatus())).pairedDevices.length) {
    await dialog.locator("summary").filter({hasText:"已配对手机"}).click();
    const range=dialog.locator("label.field").filter({hasText:"发送范围"}).locator("select");
    await range.selectOption("changed");
    await range.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,"desktop-phase3-incremental.png")});
  }
  await dialog.getByRole("tab", { name: "题库交换", exact: true }).click();
  await dialog.getByRole("button", { name: "预览并接收", exact: true }).click();
  await dialog
    .getByRole("button", { name: "确认接收资料", exact: true })
    .waitFor();
  await dialog.locator(".exchange-preview select").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(output, "desktop-exchange-preview.png"),
  });
  await dialog
    .getByRole("button", { name: "确认接收资料", exact: true })
    .click();
  await page.waitForFunction(async () =>
    (await window.matheca.state()).questions.some(
      (q) => q.id === "native-only",
    ),
  );
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).jobs.length,
    0,
  );
  execFileSync(
    adb,
    [
      "-s",
      serial,
      "pull",
      "/sdcard/Android/data/com.mathector.app/files/phase2-roundtrip.zip",
      path.join(output, "android-roundtrip.zip"),
    ],
    { stdio: "pipe", windowsHide: true },
  );
  execFileSync(
    adb,
    [
      "-s",
      serial,
      "pull",
      "/sdcard/Android/data/com.mathector.app/files/phase2-result.txt",
      path.join(output, "android-result.txt"),
    ],
    { stdio: "pipe", windowsHide: true },
  );
  const roundtrip = await new Promise((resolve, reject) =>
    yauzl.open(
      path.join(output, "android-roundtrip.zip"),
      { lazyEntries: true },
      (error, zip) => {
        if (error) return reject(error);
        zip.on("error", reject);
        zip.on("entry", (entry) => {
          if (entry.fileName !== "manifest.json") return zip.readEntry();
          zip.openReadStream(entry, async (error, stream) => {
            if (error) return reject(error);
            let chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            zip.close();
            resolve(parse(Buffer.concat(chunks).toString("utf8")));
          });
        });
        zip.readEntry();
      },
    ),
  );
  const q = roundtrip.questions.find((q) => q.id === "desktop-q");
  assert.equal(q.createdAt.toString(), "9007199254740993");
  assert.deepEqual(q.figures, base.figures);
  assert.deepEqual(q.figurePlacements, ["B"]);
  assert.equal(Number(q.figureWidths[0]), 80);
  assert.equal(q.sourceEntry, base.sourceEntry);
  assert.equal(q.solution, base.solution);
  assert.equal(q.solutionCurrent, true);
  assert.equal(
    Number(roundtrip.collections[0].questionLayout["desktop-q"].answerSpaceMm),
    60,
  );
  assert.equal(
    roundtrip.collections[0].questionLayout["desktop-q"].pageBreakBefore,
    true,
  );
  assert.deepEqual(
    roundtrip.items.map((i) => i.questionId),
    ["desktop-q", "desktop-second"],
  );
  await app.evaluate(
    ({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    },
    path.join(output, "android-roundtrip.zip"),
  );
  const preview = await page.evaluate(() => window.matheca.inspectBackup());
  assert.equal(preview.questions, 2);
  await page.evaluate(
    (token) => window.matheca.dismissBackup(token),
    preview.token,
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1024, 700),
  );
  await page.screenshot({
    path: path.join(output, "desktop-exchange-compact.png"),
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: actual Android <-> Windows transport, durable offline photo/library queue, explicit desktop intake, canonical desktop fields and images/layout/solutions, 64-bit timestamp, conflict keep/copy/replace, idempotent clones, zero AI jobs. " +
      output,
  );
  fs.writeFileSync(path.join(output, "RESULT.md"),
    "# Phase 3 cross-device validation\n\nPASS: actual Android emulator and packaged Windows EXE, isolated data. " +
    (process.argv.includes("--native-ui") ? "Native UI remembers the computer, reconnects from saved records, selects changed-only sending and confirms intake. Light/dark captures use font scale 1.3. " : "Saved credentials survive Android client recreation. Content hashes match between Android and Windows (question, images, paper layout and int64 dates). Identical selections are skipped; editing one member selects only that member with no unchanged collection. Desktop changed-only transfer also skips unchanged selections and prepares a transfer after a member edit. ") +
    "Desktop-standard ZIP round trip preserves images, positions/widths, paper layout, order and solutions. Offline photo/library queue and explicit intake work; no AI jobs start. ADB TCP forwarding, physical Wi-Fi and camera not tested.\n");
} catch (error) {
  if (page)
    await page
      .screenshot({ path: path.join(output, "failure.png") })
      .catch(() => {});
  throw error;
} finally {
  if (processHandle && processHandle.exitCode === null) processHandle.kill();
  await app?.close();
}
