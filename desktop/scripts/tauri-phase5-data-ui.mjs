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
const output = path.resolve(`test-output/tauri-phase5-data-${Date.now()}`);
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
const failure = async (fn) => {
  try {
    await fn();
    return "unexpected success";
  } catch (e) {
    return e.code;
  }
};
let savedId;
try {
  const seedBefore = hash(seed);
  await start(data);
  await page.waitForSelector(".question-card");
  await check("Phase 4 real library and migration entry", async () => {
    assert.equal(await page.evaluate(() => window.mathecaRuntime.phase), 5);
    assert.equal(
      await page.evaluate(() => window.mathecaRuntime.readOnly),
      false,
    );
    assert.equal(
      await page.evaluate(() => Object.keys(window.matheca).length),
      57,
    );
    assert.equal((await state()).questions.length, 9);
    assert.equal(
      await page
        .getByRole("button", { name: "复制原版题库", exact: true })
        .count(),
      1,
    );
    assert.ok(
      fs
        .readdirSync(path.join(data, "backups"))
        .some((n) => n.endsWith(".sqlite")),
    );
  });
  await check("Actual editor saves and survives reload", async () => {
    savedId = (await state()).questions[0].id;
    await page
      .getByRole("button", { name: /修改题目/ })
      .first()
      .click();
    const field = page.getByRole("textbox", {
      name: "题干与小题",
      exact: true,
    });
    await field.fill((await field.inputValue()) + "\n第3阶段界面保存检查");
    await page.getByRole("button", { name: "确认已校对", exact: true }).click();
    await page.waitForFunction(
      async (id) =>
        (await window.matheca.state()).questions
          .find((q) => q.id === id)
          ?.body.includes("第3阶段界面保存检查"),
      savedId,
    );
    await page.reload();
    await page.waitForSelector(".question-card");
    assert.ok(
      (await state()).questions
        .find((q) => q.id === savedId)
        .body.includes("第3阶段界面保存检查"),
    );
  });
  await check("Create, favorite, review and guarded undo", async () => {
    const result = await page.evaluate(async () => {
      const api = window.matheca;
      const template = (await api.state()).questions[0];
      let q = await api.saveQuestion(
        {
          ...template,
          id: "native-created",
          title: "Rust 新录入",
          body: "原题干",
          figures: [],
          figureWidths: [],
          figurePlacements: [],
          favorite: false,
          autoSolve: false,
        },
        false,
      );
      const original = q;
      const changed = await api.saveQuestion(
        { ...q, body: "校对后的题干" },
        true,
      );
      const restored = await api.undoReview(changed);
      q = await api.saveQuestion({ ...restored, body: "持久化题干" }, true);
      q = await api.saveQuestion({ ...q, favorite: true }, false);
      let stale;
      try {
        await api.undoReview(changed);
        stale = "unexpected success";
      } catch (e) {
        stale = e.code;
      }
      return { original, changed, restored, q, stale };
    });
    assert.equal(result.original.body, "原题干");
    assert.equal(result.changed.reviewed, true);
    assert.equal(result.restored.body, "原题干");
    assert.equal(result.q.favorite, true);
    assert.equal(result.q.createdAt, result.original.createdAt);
    assert.equal(result.stale, "OPERATION_FAILED");
  });
  await check("Collection transactions, ordering and undo", async () => {
    const result = await page.evaluate(async () => {
      const api = window.matheca;
      const c = {
        id: "native-paper",
        title: "Rust 题集",
        paperTitle: "测试试卷",
        examInstructions: "独立样本",
        examMinutes: 90,
        totalScore: 100,
        questionLayout: {
          "native-created": { answerSpaceMm: 75, pageBreakBefore: true },
        },
      };
      await api.saveCollection(c);
      await api.addQuestions(c.id, ["phase1-q-1"]);
      const added = await api.addQuestionsWithUndo(c.id, [
        "native-created",
        "phase1-q-2",
        "native-created",
      ]);
      await api.reorder(c.id, ["phase1-q-2", "phase1-q-1", "native-created"]);
      await api.undoAddition(added.token);
      const afterUndo = (await api.state()).items
        .filter((i) => i.collectionId === c.id)
        .map((i) => i.questionId);
      await api.addQuestions(c.id, ["native-created"]);
      const removed = await api.removeQuestion(c.id, "native-created");
      await api.undoDeletion(removed);
      const deletion = await api.deleteCollection(c.id);
      await api.undoDeletion(deletion);
      return { added, afterUndo, state: await api.state() };
    });
    assert.equal(result.added.count, 2);
    assert.deepEqual(result.afterUndo, ["phase1-q-1"]);
    assert.deepEqual(
      result.state.items
        .filter((i) => i.collectionId === "native-paper")
        .map((i) => i.questionId),
      ["phase1-q-1", "native-created"],
    );
    assert.equal(
      result.state.collections.find((c) => c.id === "native-paper")
        .questionLayout["native-created"].answerSpaceMm,
      75,
    );
  });
  await check(
    "Question deletion restores all collection placements",
    async () => {
      const restored = await page.evaluate(async () => {
        const api = window.matheca;
        const token = await api.deleteQuestion("native-created");
        const absent = !(await api.state()).questions.some(
          (q) => q.id === "native-created",
        );
        await api.undoDeletion(token);
        return { absent, state: await api.state() };
      });
      assert.equal(restored.absent, true);
      assert.ok(
        restored.state.items.some(
          (i) =>
            i.collectionId === "native-paper" &&
            i.questionId === "native-created",
        ),
      );
    },
  );
  await check("Knowledge and persistent operation history", async () => {
    await page.evaluate(() =>
      window.matheca.addKnowledge({ group: "函数", name: "第3阶段知识点" }),
    );
    const duplicate = await failure(() =>
      page.evaluate(() =>
        window.matheca.addKnowledge({ group: "函数", name: "第3阶段知识点" }),
      ),
    );
    assert.notEqual(duplicate, "unexpected success");
    const history = await page.evaluate(() =>
      window.matheca.historyList(100, 0, "题集"),
    );
    assert.ok(history.total > 0);
    assert.ok(
      (await state()).customKnowledge.some((p) => p.name === "第3阶段知识点"),
    );
  });
  await check(
    "Settings UI saves encrypted credentials without network calls",
    async () => {
      await page
        .getByRole("button", { name: "设置与备份", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "接口地址", exact: true })
        .fill("https://phase3.example/v1");
      await page
        .getByRole("textbox", { name: "模型名", exact: true })
        .fill("phase3-model");
      await page
        .getByLabel("API Key", { exact: true })
        .fill("phase3-ui-synthetic-key");
      await page
        .getByRole("button", { name: "保存接口配置", exact: true })
        .click();
      await page.waitForFunction(
        async () => (await window.matheca.state()).settings.hasApiKey,
      );
      for (const file of ["library.sqlite", "library.sqlite-wal"]) {
        const p = path.join(data, file);
        if (fs.existsSync(p))
          assert.equal(
            fs.readFileSync(p).includes(Buffer.from("phase3-ui-synthetic-key")),
            false,
          );
      }
      await page.screenshot({ path: path.join(output, "settings.png") });
    },
  );
  await check(
    "Deferred backup and mobile APIs still reject honestly",
    async () => {
      const codes = await page.evaluate(async () =>
        Promise.all(
          [
            () => window.matheca.exportBackup(),
            () => window.matheca.mobileStart(),
          ].map(async (fn) => {
            try {
              await fn();
              return "unexpected success";
            } catch (e) {
              return e.code;
            }
          }),
        ),
      );
      assert.deepEqual(codes, Array(2).fill("NOT_IMPLEMENTED"));
    },
  );
  await check("State events, theme and cancellation", async () => {
    await page.evaluate(() => {
      window.__changes = 0;
      window.__off = window.matheca.onChanged(() => window.__changes++);
    });
    await wait(150);
    await page.evaluate(() => window.matheca.setColorTheme("BLUE"));
    await page.waitForFunction(
      () =>
        window.__changes === 1 &&
        document.documentElement.dataset.colorTheme === "BLUE",
    );
    await page.evaluate(() => window.__off());
    await page.evaluate(() => window.matheca.setColorTheme("PLUM"));
    await page.waitForFunction(
      () => document.documentElement.dataset.colorTheme === "PLUM",
    );
    assert.equal(await page.evaluate(() => window.__changes), 1);
    await page.evaluate(() => window.matheca.setCloseAction("ask"));
    await requestClose();
    await page.locator(".close-choice-dialog").waitFor();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(child.exitCode, null);
  });
  await check("Native close saves a dirty editor before exiting", async () => {
    await page
      .getByRole("button", { name: "题库", exact: true })
      .first()
      .click();
    savedId = (await state()).questions[0].id;
    await page
      .getByRole("button", { name: /修改题目/ })
      .first()
      .click();
    const field = page.getByRole("textbox", {
      name: "题干与小题",
      exact: true,
    });
    await field.fill((await field.inputValue()) + "\n关闭自动保存检查");
    const exited = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Autosave exit timed out")),
        10000,
      );
      child.once("exit", (code) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(Error(`Exit ${code}`));
      });
    });
    await requestClose();
    await page.locator(".close-choice-dialog").waitFor();
    await page.getByRole("button", { name: "直接退出", exact: true }).click();
    await exited;
    await browser.close().catch(() => {});
    child = undefined;
    browser = undefined;
  });
  await start(data);
  await page.waitForSelector(".question-card");
  await check(
    "Edits, collections, keys and theme survive restart",
    async () => {
      const s = await state();
      assert.ok(
        s.questions
          .find((q) => q.id === savedId)
          .body.includes("关闭自动保存检查"),
      );
      assert.ok(s.collections.some((c) => c.id === "native-paper"));
      assert.equal(s.settings.hasApiKey, true);
      assert.equal(s.settings.model, "phase3-model");
      assert.equal(s.settings.colorTheme, "PLUM");
      await page.screenshot({ path: path.join(output, "workbench.png") });
    },
  );
  await finish();
  const empty = path.join(output, "empty-appdata");
  fs.mkdirSync(empty);
  await start(empty);
  await check(
    "New data directory creates a genuine writable database",
    async () => {
      await page.waitForSelector(".migration-preview-notice");
      assert.equal((await state()).questions.length, 0);
      assert.ok(fs.existsSync(path.join(empty, "library.sqlite")));
      await page.evaluate(() => window.matheca.examples());
      await page.waitForFunction(
        async () => (await window.matheca.state()).questions.length === 3,
      );
      await page.evaluate(() => window.matheca.examples());
      assert.equal((await state()).questions.length, 3);
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
  const futureBefore = hash(path.join(future, "library.sqlite"));
  await start(future);
  await check(
    "Future database refuses reads and writes without modifying bytes",
    async () => {
      await page.getByText(/题库版本 99 暂不受支持/).waitFor();
      assert.equal(await page.locator(".question-card").count(), 0);
      assert.notEqual(
        await failure(() => page.evaluate(() => window.matheca.examples())),
        "unexpected success",
      );
      await requestClose();
      await page.locator(".close-choice-dialog").waitFor();
      await page.getByRole("button", { name: "取消", exact: true }).click();
    },
  );
  // A refused newer database cannot accept preference writes either. Quit through
  // the normal UI instead of changing its stored close preference.
  const end = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Future DB close timeout")),
      10000,
    );
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(Error(`Exit ${code}`));
    });
  });
  await requestClose();
  await page.locator(".close-choice-dialog").waitFor();
  await page.getByRole("button", { name: "直接退出", exact: true }).click();
  await end;
  await browser.close().catch(() => {});
  child = undefined;
  browser = undefined;
  assert.equal(hash(path.join(future, "library.sqlite")), futureBefore);
  assert.equal(hash(seed), seedBefore);
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, "REPORT.md"),
    `# Tauri phase 5 packaged data regression\n\nEXE: ${exe}\n\nSHA256: ${hash(exe)}\n\n${results.map((n) => `- PASS: ${n}`).join("\n")}\n\nRenderer exceptions: 0\nOriginal synthetic source unchanged: ${seedBefore}\nFuture database unchanged: ${futureBefore}\n`,
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
