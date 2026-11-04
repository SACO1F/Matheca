import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const option = (key, fallback) => {
  const i = process.argv.indexOf(key);
  return i < 0 ? fallback : process.argv[i + 1];
};
const latest = fs.existsSync("releases/latest-tauri.txt")
  ? fs
      .readFileSync("releases/latest-tauri.txt", "utf8")
      .match(/^EXE: (.+)$/m)?.[1]
      .trim()
  : undefined;
const exe = path.resolve(option("--exe", latest || ""));
assert.ok(
  fs.existsSync(exe) && exe.endsWith(".exe"),
  "Build a Tauri portable EXE first",
);
const seed = path.resolve(
  option(
    "--seed",
    "test-output/tauri-phase1-20261027-011039/appdata/library.sqlite",
  ),
);
assert.ok(
  seed.startsWith(path.resolve("test-output/tauri-phase1-")) &&
    fs.existsSync(seed),
  "Use a phase1 synthetic fixture, never a real library",
);
const output = path.resolve(`test-output/tauri-phase2-${Date.now()}`);
const data = path.join(output, "appdata");
fs.mkdirSync(data, { recursive: true });
const image = path.join(path.dirname(path.dirname(seed)), "source-figure.png");
fs.copyFileSync(image, path.join(data, "source-figure.png"));
execFileSync(process.env.MATHECA_QA_PYTHON || "python", [
  "-c",
  `
import sqlite3,json,sys
source=sqlite3.connect('file:'+sys.argv[1].replace('\\\\','/')+'?mode=ro',uri=True)
target=sqlite3.connect(sys.argv[2]);source.backup(target);source.close()
q=json.loads(target.execute('SELECT data FROM questions WHERE id=?',('phase1-q-8',)).fetchone()[0]);q['sourcePath']=sys.argv[3]
target.execute('UPDATE questions SET data=? WHERE id=?',(json.dumps(q,ensure_ascii=False),q['id']));target.commit();target.close()
`,
  seed,
  path.join(data, "library.sqlite"),
  path.join(data, "source-figure.png"),
]);
const hash = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const before = hash(path.join(data, "library.sqlite"));
const results = [],
  errors = [];
let child, browser, page;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function start(folder) {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  const env = {
    ...process.env,
    MATHECA_TEST_DATA: folder,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
  };
  child = spawn(exe, [], {
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (b) => (log += b));
  child.stderr.on("data", (b) => (log += b));
  const deadline = Date.now() + 30000;
  for (;;) {
    if (child.exitCode !== null)
      throw Error(`Native app exited ${child.exitCode}: ${log}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) break;
    } catch {}
    if (Date.now() > deadline)
      throw Error(`WebView2 debugging did not become ready: ${log}`);
    await wait(150);
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page =
    browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes("tauri.html")) ||
    browser.contexts()[0].pages()[0] ||
    (await browser.contexts()[0].waitForEvent("page"));
  console.log(`Attached WebView2: ${page.url()}`);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForFunction(() => !!window.matheca, { timeout: 30000 });
}
async function requestClose() {
  await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().close());
}
async function finish() {
  await page.evaluate(() => window.matheca.setCloseAction("quit"));
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Clean exit timed out")),
      10000,
    );
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(Error(`Exit ${code}`));
    });
  });
  await requestClose();
  await exited;
  await browser.close().catch(() => {});
  browser = undefined;
  child = undefined;
}
async function check(name, test) {
  await test();
  results.push(name);
  console.log(`PASS ${name}`);
}
try {
  await start(data);
  await page.waitForSelector(".question-card");
  await check("Real React workbench and full API", async () => {
    assert.equal(
      await page.evaluate(() => Object.keys(window.matheca).length),
      57,
    );
    assert.equal(await page.evaluate(() => typeof window.require), "undefined");
    assert.equal(await page.evaluate(() => typeof window.process), "undefined");
    assert.equal(await page.locator(".migration-preview-notice").count(), 1);
    const state = await page.evaluate(() => window.matheca.state());
    assert.equal(state.questions.length, 9);
    assert.equal(state.collections.length, 1);
    assert.equal(state.items.length, 9);
  });
  await page.screenshot({ path: path.join(output, "workbench.png") });
  await check("Read-only business operations fail explicitly", async () => {
    const failures = await page.evaluate(async () => {
      const api = window.matheca;
      const calls = [
        () => api.chooseImport(),
        () => api.exportBackup(),
        () => api.previewCollection("phase1-paper"),
        () => api.mobileStart(),
        () => api.saveQuestion({ id: "x" }),
      ];
      return Promise.all(
        calls.map(async (fn) => {
          try {
            await fn();
            return "unexpected success";
          } catch (e) {
            return e.code;
          }
        }),
      );
    });
    assert.deepEqual(failures, Array(5).fill("NOT_IMPLEMENTED"));
    const unknown = await page.evaluate(() =>
      window.__TAURI__.core.invoke("desktop_call", {
        channel: "system:exec",
        args: [],
      }),
    );
    assert.equal(unknown.code, "UNKNOWN_COMMAND");
  });
  await check("Theme events, unsubscription and persistence", async () => {
    await page.evaluate(() => {
      window.__changes = 0;
      window.__stop = window.matheca.onChanged(() => window.__changes++);
    });
    await wait(200);
    await page.evaluate(() => window.matheca.setColorTheme("BLUE"));
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.colorTheme === "BLUE" &&
        window.__changes === 1,
    );
    await page.evaluate(() => window.__stop());
    await wait(100);
    await page.evaluate(() => window.matheca.setColorTheme("PLUM"));
    await page.waitForFunction(
      () => document.documentElement.dataset.colorTheme === "PLUM",
    );
    assert.equal(await page.evaluate(() => window.__changes), 1);
    await page.evaluate(() => window.matheca.setColorTheme("BLUE"));
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(data, "preview-settings.json")))
        .colorTheme,
      "BLUE",
    );
  });
  await check("Workbench page navigation and history", async () => {
    for (const name of [
      "题集",
      "知识点",
      "任务",
      "历史记录",
      "设置与备份",
      "题库",
    ]) {
      await page.getByRole("button", { name, exact: true }).first().click();
      await wait(100);
    }
    const history = await page.evaluate(() => window.matheca.historyList());
    assert.ok(history.total > 0);
  });
  await check("Controlled original-image protocol", async () => {
    const size = await page.evaluate(async () => {
      const q = (await window.matheca.state()).questions.find(
        (q) => q.id === "phase1-q-8",
      );
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
        image.onerror = () => reject(Error("Asset failed"));
        image.src = q.sourcePath;
      });
    });
    assert.deepEqual(size, [480, 240]);
  });
  await check("Native close cancellation", async () => {
    await requestClose();
    await page.locator(".close-choice-dialog").waitFor();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.locator(".close-choice-dialog").waitFor({ state: "detached" });
    assert.equal(child.exitCode, null);
  });
  await check("Native background and restore", async () => {
    await page.evaluate(() => {
      window.__closeChanges = 0;
      window.__stopClose = window.matheca.onChanged(
        () => window.__closeChanges++,
      );
    });
    await requestClose();
    await page.locator(".close-choice-dialog").waitFor();
    await page.getByRole("checkbox", { name: "保持以上选择" }).check();
    await page.getByRole("button", { name: "后台运行", exact: true }).click();
    await page.waitForFunction(
      async () =>
        !(await window.__TAURI__.window.getCurrentWindow().isVisible()),
    );
    await page.evaluate(() =>
      window.__TAURI__.core.invoke("desktop_call", {
        channel: "window:show",
        args: [],
      }),
    );
    await page.waitForFunction(() =>
      window.__TAURI__.window.getCurrentWindow().isVisible(),
    );
    await page.waitForFunction(() => window.__closeChanges > 0);
    assert.equal(
      (await page.evaluate(() => window.matheca.state())).settings.closeAction,
      "background",
    );
    await page.evaluate(() => window.__stopClose());
    await page.evaluate(() => window.matheca.setCloseAction("ask"));
  });
  await check(
    "Unsaved edits prevent exit when saving is unavailable",
    async () => {
      await page
        .getByRole("button", { name: /修改题目/ })
        .first()
        .click();
      const field = page.getByRole("textbox", {
        name: "题干与小题",
        exact: true,
      });
      await field.fill((await field.inputValue()) + "\n独立关闭保护测试");
      await requestClose();
      await page.locator(".close-choice-dialog").waitFor();
      await page.getByRole("button", { name: "直接退出", exact: true }).click();
      await page
        .getByText(
          "当前迁移预览版仅支持浏览题库及调整主题、关闭设置；此操作尚未开放。",
          { exact: true },
        )
        .waitFor();
      assert.equal(child.exitCode, null);
      // Discard the test edit by reloading the read-only workbench. This does not
      // write to SQLite; no production close handler is bypassed to test exit.
      await page.reload();
      await page.waitForSelector(".question-card");
    },
  );
  await finish();
  const future = path.join(output, "future-appdata");
  fs.mkdirSync(future);
  fs.copyFileSync(
    path.join(data, "library.sqlite"),
    path.join(future, "library.sqlite"),
  );
  execFileSync(process.env.MATHECA_QA_PYTHON || "python", [
    "-c",
    "import sqlite3,sys;d=sqlite3.connect(sys.argv[1]);d.execute('PRAGMA user_version=99');d.close()",
    path.join(future, "library.sqlite"),
  ]);
  await start(future);
  await check(
    "Unsupported database remains an explicit error and can close",
    async () => {
      await page.getByText(/题库版本 99 暂不受支持/).waitFor();
      assert.equal(await page.locator(".question-card").count(), 0);
      await requestClose();
      await page.locator(".close-choice-dialog").waitFor();
      await page.getByRole("button", { name: "取消", exact: true }).click();
    },
  );
  await finish();
  await check("Library bytes unchanged", async () =>
    assert.equal(hash(path.join(data, "library.sqlite")), before),
  );
  await start(data);
  await check("Settings survive restart", async () => {
    await page.waitForFunction(
      () => document.documentElement.dataset.colorTheme === "BLUE",
    );
    assert.equal(
      (await page.evaluate(() => window.matheca.state())).settings.closeAction,
      "quit",
    );
  });
  await finish();
  const empty = path.join(output, "empty-appdata");
  fs.mkdirSync(empty);
  await start(empty);
  await check("Empty preview does not invent a library", async () => {
    await page.waitForSelector(".migration-preview-notice");
    assert.equal(
      (await page.evaluate(() => window.matheca.state())).questions.length,
      0,
    );
    assert.equal(fs.existsSync(path.join(empty, "library.sqlite")), false);
    await page.screenshot({ path: path.join(output, "empty-workbench.png") });
  });
  await finish();
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, "REPORT.md"),
    `# Tauri phase 2 packaged UI verification\n\nEXE: ${exe}\n\nSHA256: ${hash(exe)}\n\n${results.map((name) => `- PASS: ${name}`).join("\n")}\n\nRenderer exceptions: 0\nSynthetic SQLite unchanged: ${before}\n`,
  );
  console.log(`Evidence: ${output}`);
} catch (error) {
  if (page)
    await page
      .screenshot({ path: path.join(output, "failure.png") })
      .catch(() => {});
  fs.writeFileSync(
    path.join(output, "FAILURE.txt"),
    String(error.stack || error),
  );
  throw error;
} finally {
  if (child && child.exitCode === null) child.kill();
  if (browser) await browser.close().catch(() => {});
}
