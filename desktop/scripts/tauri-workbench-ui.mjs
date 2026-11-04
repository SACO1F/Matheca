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
const output = path.resolve(`test-output/tauri-phase9-workbench-${Date.now()}`);
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
const nav = (name) =>
  page.locator(".sidebar").getByRole("button", { name, exact: true }).click();
const state = () => page.evaluate(() => window.matheca.state());
const ratio = (a, b) => {
  const luminance = (hex) =>
    hex
      .slice(1)
      .match(/../g)
      .map((v) => parseInt(v, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
try {
  const seedBefore = hash(seed);
  await start(data);
  await page.waitForSelector(".question-card");
  await check(
    "Complete runtime contract and local fonts/images/formulas",
    async () => {
      const runtime = await page.evaluate(() => window.mathecaRuntime);
    assert.equal(runtime.phase, 9);
      assert.equal(runtime.implemented.length, 53);
      assert.deepEqual(runtime.deferred, []);
      assert.equal(
        Object.keys(
          await page.evaluate(() =>
            Object.fromEntries(
              Object.keys(window.matheca).map((k) => [k, true]),
            ),
          ),
        ).length,
        57,
      );
      await page.evaluate(() => document.fonts.ready);
      assert.ok(await page.locator(".katex").count());
      const resources = await page.evaluate(async () => {
        const fonts = performance
          .getEntriesByType("resource")
          .filter((e) => /\.(woff2?|ttf)(?:\?|$)/.test(e.name))
          .map((e) => e.name);
        const q = (await window.matheca.state()).questions.find(
          (q) => q.sourcePath,
        );
        const image = new Image();
        image.src = q.sourcePath;
        const images = [image];
        await Promise.all(images.map((i) => i.decode()));
        return {
          fonts,
          images: images.map((i) => ({
            width: i.naturalWidth,
            height: i.naturalHeight,
          })),
        };
      });
      assert.ok(resources.fonts.length > 0);
      assert.ok(resources.images.length > 0);
      assert.ok(resources.images.every((i) => i.width > 0 && i.height > 0));
      assert.ok(
        resources.fonts.every((url) =>
          new URL(url).hostname.endsWith("localhost"),
        ),
      );
      await page.screenshot({ path: path.join(output, "library.png") });
    },
  );
  await check(
    "Four themes via real controls retain unsaved API settings and readable tokens",
    async () => {
      await nav("设置与备份");
      const before = (await state()).settings;
      await page
        .getByRole("textbox", { name: "接口地址", exact: true })
        .fill("https://unsaved.example/v1");
      for (const [id, name] of [
        ["GRAPHITE", "石墨"],
        ["BLUE", "雾蓝"],
        ["CLAY", "陶土"],
        ["PLUM", "梅紫"],
      ]) {
        await page.getByRole("radio", { name, exact: true }).click();
        await page.waitForFunction(
          (id) => document.documentElement.dataset.colorTheme === id,
          id,
        );
        await page.waitForFunction(
          () => !document.querySelector(".theme-option input:disabled"),
        );
        assert.equal(
          await page
            .getByRole("textbox", { name: "接口地址", exact: true })
            .inputValue(),
          "https://unsaved.example/v1",
        );
        assert.equal((await state()).settings.address, before.address);
        const tokens = await page.evaluate(() => {
          const s = getComputedStyle(document.documentElement);
          return Object.fromEntries(
            [
              "--blue",
              "--primary-hover",
              "--accent-ink",
              "--accent-soft",
              "--focus",
            ].map((k) => [k, s.getPropertyValue(k).trim()]),
          );
        });
        assert.ok(ratio(tokens["--blue"], "#ffffff") >= 4.5);
        assert.ok(ratio(tokens["--primary-hover"], "#ffffff") >= 4.5);
        assert.ok(
          ratio(tokens["--accent-ink"], tokens["--accent-soft"]) >= 4.5,
        );
        assert.ok(ratio(tokens["--focus"], "#ffffff") >= 3);
      }
      await page.screenshot({ path: path.join(output, "settings-plum.png") });
      await page.reload();
      await page.waitForSelector(".question-card");
      assert.equal((await state()).settings.colorTheme, "PLUM");
      assert.equal((await state()).settings.address, before.address);
    },
  );
  await check(
    "History scope, literal search and 125 distinct persistent operations",
    async () => {
      const before = await page.evaluate(() => window.matheca.historyList());
      await page.evaluate(() => window.matheca.recordHistory("进入历史记录"));
      await nav("历史记录");
      await nav("题库");
      assert.equal(
        (await page.evaluate(() => window.matheca.historyList())).total,
        before.total,
      );
      await page.evaluate(async () => {
        for (let i = 0; i < 125; i++)
          await window.matheca.saveCollection({
            id: "phase9-" + i,
            title: "第9阶段分页 " + i,
            paperTitle: "数学",
            examMinutes: 60,
            totalScore: 100,
            examInstructions: "",
          });
      });
      const r = await page.evaluate(() =>
        window.matheca.historyList(500, 0, "第9阶段分页"),
      );
      assert.equal(r.total, 125);
      assert.equal(new Set(r.records.map((r) => r.id)).size, 125);
      assert.equal(r.records[0].detail, "第9阶段分页 124");
      for (const query of ["%", "_", "不存在的历史内容"])
        assert.equal(
          (
            await page.evaluate(
              (q) => window.matheca.historyList(100, 0, q),
              query,
            )
          ).total,
          0,
        );
    },
  );
  await check(
    "History UI search, pagination, empty state and exact recent five",
    async () => {
      await nav("历史记录");
      const history = page.getByRole("region", {
        name: "操作历史",
        exact: true,
      });
      const search = history.getByRole("searchbox", {
        name: "搜索历史记录",
        exact: true,
      });
      await search.fill("第9阶段分页");
      await page.waitForFunction(() =>
        document
          .querySelector(".history-toolbar p")
          ?.textContent.includes("125"),
      );
      assert.equal(await history.locator("li").count(), 100);
      await history
        .getByRole("button", { name: "下一页", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelectorAll(".history-page li").length === 25,
      );
      assert.equal(
        await history.locator("li p").first().textContent(),
        "第9阶段分页 24",
      );
      await search.fill("不存在的历史内容");
      await history.getByText("没有匹配的历史记录", { exact: true }).waitFor();
      await search.fill("第9阶段分页");
      await page.waitForFunction(
        () => document.querySelectorAll(".history-page li").length === 100,
      );
      const trigger = page.getByRole("button", {
        name: "历史步骤",
        exact: true,
      });
      await trigger.click();
      const recent = page.getByRole("region", {
        name: "最近五次操作",
        exact: true,
      });
      await recent.locator("li").first().waitFor();
      assert.deepEqual(
        await recent.locator("li p").allTextContents(),
        [124, 123, 122, 121, 120].map((i) => "第9阶段分页 " + i),
      );
      await page.keyboard.press("Escape");
      await recent.waitFor({ state: "hidden" });
      assert.ok(await trigger.evaluate((el) => document.activeElement === el));
      await page.screenshot({ path: path.join(output, "history.png") });
    },
  );
  await check(
    "Workbench layouts at compact and wide viewports and reduced motion",
    async () => {
      for (const [width, height] of [
        [900, 640],
        [1440, 940],
      ]) {
        await page.setViewportSize({ width, height });
        for (const name of ["题库", "题集", "历史记录", "设置与备份"]) {
          await nav(name);
          await page.locator("h1").waitFor();
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            `${name} horizontal overflow at ${width}`,
          );
        }
        await page.screenshot({
          path: path.join(output, `settings-${width}.png`),
        });
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.getByRole("button", { name: "历史步骤", exact: true }).click();
      const recent = page.getByRole("region", {
        name: "最近五次操作",
        exact: true,
      });
      await recent.waitFor();
      assert.equal(
        await recent.evaluate((el) => getComputedStyle(el).animationName),
        "none",
      );
      await page.keyboard.press("Escape");
    },
  );
  await check(
    "DOM file drop rejects unsupported content and clears overlay",
    async () => {
      await nav("题库");
      const count = (await state()).questions.length;
      await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.items.add(new File(["synthetic invalid"], "unsupported.exe"));
        document.dispatchEvent(
          new DragEvent("dragenter", {
            dataTransfer: dt,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await page.locator(".import-drop-overlay").waitFor();
      await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.items.add(new File(["synthetic invalid"], "unsupported.exe"));
        document.dispatchEvent(
          new DragEvent("drop", {
            dataTransfer: dt,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await page.locator(".import-drop-overlay").waitFor({ state: "hidden" });
      await page
        .getByText("请选择图片、PDF 或 Windows 题库 ZIP", { exact: true })
        .waitFor();
      assert.equal((await state()).questions.length, count);
      assert.equal((await state()).jobs.length, 0);
    },
  );
  await check(
    "Clean close, released database and theme/history after EXE restart",
    async () => {
      const session = await browser.newBrowserCDPSession();
      const processIds = (
        await session.send("SystemInfo.getProcessInfo")
      ).processInfo.map((p) => p.id);
      await finish();
      const alive = (pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          if (error.code === "ESRCH") return false;
          throw error;
        }
      };
      const deadline = Date.now() + 10000;
      while (processIds.some(alive) && Date.now() < deadline) await wait(100);
      assert.deepEqual(
        processIds.filter(alive),
        [],
        "test WebView2 child processes must exit",
      );
      // Windows refuses rename while an SQLite file handle lacks delete sharing.
      const db = path.join(data, "library.sqlite");
      fs.renameSync(db, db + ".closed");
      fs.renameSync(db + ".closed", db);
      await start(data);
      await page.waitForSelector(".question-card");
      assert.equal((await state()).settings.colorTheme, "PLUM");
      assert.equal(
        (
          await page.evaluate(() =>
            window.matheca.historyList(500, 0, "第9阶段分页"),
          )
        ).total,
        125,
      );
      await finish();
      assert.equal(hash(seed), seedBefore);
      assert.deepEqual(errors, []);
    },
  );
  fs.writeFileSync(
    path.join(output, "REPORT.md"),
    `# Phase 9 workbench release regression\n\nEXE: ${exe}\nSHA256: ${hash(exe)}\n\n${results.map((n) => `- PASS: ${n}`).join("\n")}\n\nSynthetic isolated data only; viewport emulation is not physical mixed-DPI validation. Renderer exceptions: 0.\n`,
  );
  console.log(`Evidence: ${output}`);
} catch (error) {
  await page
    ?.screenshot({ path: path.join(output, "failure.png") })
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
