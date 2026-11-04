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
const output = path.resolve(`test-output/tauri-phase5-${Date.now()}`);
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

const state = () => page.evaluate(() => window.matheca.state());
async function until(fn, message, ms = 90000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw Error(message);
    await wait(100);
  }
}
async function nativeExport(id, format, name) {
  const target = path.join(output, name);
  console.log(`SAVE ${format.toUpperCase()} READY: ${target}`);
  await page.evaluate(
    ({ id, format }) => {
      window.__exportResult = null;
      window.matheca.exportCollection(id, format).then(
        (r) => (window.__exportResult = { ok: true, data: r }),
        (e) => (window.__exportResult = { ok: false, error: e.message }),
      );
    },
    { id, format },
  );
  const result = await until(
    () => page.evaluate(() => window.__exportResult),
    "Native export did not finish",
    240000,
  );
  assert.equal(result.ok, true, result.error);
  assert.ok(result.data, "Export unexpectedly cancelled");
  assert.equal(path.resolve(result.data.path), target);
  assert.ok(fs.statSync(target).size > 100);
  return target;
}
try {
  await start(data);
  await page.waitForSelector(".question-card");
  assert.equal(await page.evaluate(() => window.mathecaRuntime.phase), 5);
  await check(
    "Native tagged PDF preview from same baseline snapshot",
    async () => {
      const bytes = await page.evaluate(() =>
        window.matheca.previewCollection("phase1-paper"),
      );
      const buf = Buffer.from(bytes);
      assert.ok(buf.subarray(0, 5).equals(Buffer.from("%PDF-")));
      assert.ok(buf.includes(Buffer.from("/StructTreeRoot")));
      fs.writeFileSync(path.join(output, "baseline-preview.pdf"), buf);
    },
  );
  await check(
    "Empty, malformed formula and arbitrary open requests reject without publishing",
    async () => {
      const failures = await page.evaluate(async () => {
        const api = window.matheca;
        const s = await api.state();
        const c = s.collections[0];
        await api.saveCollection({ ...c, id: "phase5-empty", title: "空题集" });
        const q = {
          ...s.questions[0],
          id: "phase5-invalid",
          body: String.raw`测试 \(\notARealCommand{\)`,
          figures: [],
          figureWidths: [],
          figurePlacements: [],
          autoSolve: false,
        };
        await api.saveQuestion(q, false);
        await api.saveCollection({
          ...c,
          id: "phase5-invalid-paper",
          title: "坏公式测试",
        });
        await api.addQuestions("phase5-invalid-paper", [q.id]);
        const messages = [];
        for (const fn of [
          () => api.previewCollection("phase5-empty"),
          () => api.previewCollection("phase5-invalid-paper"),
          () => api.exportCollection("phase1-paper", "exe"),
          () => api.openExport("C:\\Windows\\notepad.exe"),
        ]) {
          try {
            await fn();
            messages.push("unexpected success");
          } catch (e) {
            messages.push(e.message);
          }
        }
        return messages;
      });
      assert.match(failures[0], /至少一道题/);
      assert.match(failures[1], /公式/);
      assert.match(failures[2], /格式/);
      assert.match(failures[3], /本次生成/);
    },
  );
  if (process.argv.includes("--native")) {
    await check("Native save dialog publishes tagged PDF", async () => {
      await nativeExport("phase1-paper", "pdf", "baseline-export.pdf");
    });
    await check(
      "Rust Word packaging with native formula captures",
      async () => {
        await nativeExport("phase1-paper", "docx", "baseline-export.docx");
      },
    );
  }
  await check(
    "Option image placement, custom sizes, long content, forced pages and answer space",
    async () => {
      await page.evaluate(async () => {
        const api = window.matheca,
          s = await api.state(),
          base = s.questions.find((q) => q.id === "phase1-q-8"),
          c = s.collections.find((c) => c.id === "phase1-paper");
        const figure = base.figures[0];
        const choice = {
          ...base,
          id: "phase5-choice",
          title: "选项配图",
          body: String.raw`观察图形，选择正确结论。\nA. \(x=1\)\nB. \(x=2\)\nC. \(x=3\)\nD. \(x=4\)`.replaceAll(
            "\\n",
            "\n",
          ),
          kind: "选择题",
          figures: [figure, figure, figure],
          figureWidths: [36, 25, 28],
          figurePlacements: ["stem", "A", "D"],
          autoSolve: false,
        };
        const long = {
          ...base,
          id: "phase5-long",
          title: "长题分页",
          body:
            "长题分页验证。\n" +
            Array.from(
              { length: 55 },
              (_, i) =>
                `第 ${i + 1} 行给出条件和推导空间，已知函数 f(x)，请结合条件计算并证明结论。`,
            ).join("\n"),
          kind: "解答题",
          figures: [],
          figureWidths: [],
          figurePlacements: [],
          autoSolve: false,
        };
        const wide = {
          ...base,
          id: "phase5-wide",
          title: "宽公式校验",
          body: String.raw`宽公式不能被裁切。\[\underbrace{x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x}_{宽公式}\]`,
          figures: [],
          figureWidths: [],
          figurePlacements: [],
          autoSolve: false,
        };
        await api.saveQuestion(choice, true);
        await api.saveQuestion(long, true);
        await api.saveQuestion(wide, true);
        await api.saveCollection({
          ...c,
          id: "phase5-edge-paper",
          title: "配图长题分页",
          paperTitle: "配图与长题分页验证",
          questionLayout: {
            "phase5-choice": { answerSpaceMm: 0 },
            "phase5-long": { pageBreakBefore: true, answerSpaceMm: 80 },
          },
        });
        await api.addQuestions("phase5-edge-paper", [choice.id, long.id]);
        await api.saveCollection({
          ...c,
          id: "phase5-wide-paper",
          title: "超宽公式",
          questionLayout: {},
        });
        await api.addQuestions("phase5-wide-paper", [wide.id]);
      });
      const bytes = await page.evaluate(() =>
        window.matheca.previewCollection("phase5-edge-paper"),
      );
      fs.writeFileSync(
        path.join(output, "edge-preview.pdf"),
        Buffer.from(bytes),
      );
      await assert.rejects(
        () =>
          page.evaluate(() =>
            window.matheca.previewCollection("phase5-wide-paper"),
          ),
        /公式超出页面宽度/,
      );
    },
  );
  if (
    process.argv.includes("--native") ||
    process.argv.includes("--edge-native")
  )
    await check(
      "Word keeps option figures, custom widths and long text",
      async () => {
        await nativeExport("phase5-edge-paper", "docx", "edge-export.docx");
      },
    );
  await check(
    "React PDF preview renders all baseline pages and returns to editing",
    async () => {
      await page
        .getByRole("button", { name: "题集", exact: true })
        .first()
        .click();
      await page
        .getByText("阶段一迁移验证试卷", { exact: true })
        .first()
        .click();
      await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
      await page.getByRole("dialog", { name: "导出预览" }).waitFor();
      await page.locator(".document-preview canvas.ready").waitFor();
      await page.screenshot({ path: path.join(output, "preview-ui.png") });
      await page.getByRole("button", { name: "下一页", exact: true }).click();
      await page.locator(".document-preview canvas.ready").waitFor();
      await page.getByRole("button", { name: "返回编辑", exact: true }).click();
      assert.equal(
        await page.getByRole("dialog", { name: "导出预览" }).count(),
        0,
      );
    },
  );

  if (process.argv.includes("--controls")) {
    await check(
      "Unreviewed warning and save cancellation preserve existing files",
      async () => {
        await page.evaluate(async () => {
          const api = window.matheca;
          const q = (await api.state()).questions.find(
            (q) => q.id === "phase5-choice",
          );
          await api.saveQuestion(
            { ...q, body: q.body + "\n未校对修改" },
            false,
          );
          window.__cancelResult = null;
          api.exportCollection("phase5-edge-paper", "pdf").then(
            (v) => (window.__cancelResult = { done: true, data: v }),
            (e) => (window.__cancelResult = { done: true, error: e.message }),
          );
        });
        console.log("WARNING CANCEL READY");
        let result = await until(
          () => page.evaluate(() => window.__cancelResult),
          "Warning was not dismissed",
          180000,
        );
        assert.equal(result.data, null);
        await page.evaluate(() => {
          window.__cancelResult = null;
          window.matheca.exportCollection("phase1-paper", "pdf").then(
            (v) => (window.__cancelResult = { done: true, data: v }),
            (e) => (window.__cancelResult = { done: true, error: e.message }),
          );
        });
        console.log("SAVE CANCEL READY");
        result = await until(
          () => page.evaluate(() => window.__cancelResult),
          "Save was not cancelled",
          180000,
        );
        assert.equal(result.data, null);
      },
    );
    await check(
      "Closing during Word generation cancels output before publication",
      async () => {
        const target = path.join(output, "cancelled-on-exit.docx");
        await page.evaluate(() => window.matheca.setCloseAction("quit"));
        await page.evaluate(() => {
          window.matheca
            .exportCollection("phase1-paper", "docx")
            .catch(() => {});
        });
        console.log("EXIT SAVE READY: " + target);
        await until(
          async () =>
            browser
              .contexts()
              .flatMap((c) => c.pages())
              .some((p) => p.url().includes("tauri-worker.html")),
          "Word worker did not start",
          180000,
        );
        const exited = new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error("Export close timed out")),
            10000,
          );
          child.once("exit", (code) => {
            clearTimeout(timer);
            code === 0 ? resolve() : reject(Error("Exit " + code));
          });
        });
        await requestClose();
        await exited;
        await browser.close().catch(() => {});
        child = undefined;
        browser = undefined;
        assert.ok(!fs.existsSync(target));
        await start(data);
        await page.waitForSelector(".question-card");
      },
    );
  }
  assert.deepEqual(errors, []);
  await finish();
  fs.writeFileSync(
    path.join(output, "REPORT.md"),
    `# Phase 5 portable export validation\n\nEXE: ${exe}\n\nSHA256: ${hash(exe)}\n\n${results.map((n) => "- PASS: " + n).join("\n")}\n\nRenderer exceptions: 0\nAll fixtures synthetic; original library unchanged.\n`,
  );
  console.log("Evidence: " + output);
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
