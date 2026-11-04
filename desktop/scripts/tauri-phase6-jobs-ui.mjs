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
const output = path.resolve(`test-output/tauri-phase6-jobs-${Date.now()}`);
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

const https = await import("node:https");
execFileSync(process.env.MATHECA_QA_PYTHON || "python", [
  "-c",
  `
from cryptography import x509
from cryptography.x509.oid import NameOID,ExtendedKeyUsageOID
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from datetime import datetime,timedelta,timezone
from pathlib import Path
import sys,ipaddress
out=Path(sys.argv[1]);now=datetime.now(timezone.utc)
ca=rsa.generate_private_key(public_exponent=65537,key_size=2048)
name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Matheca isolated fixture CA')])
root=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(ca.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(days=1)).not_valid_after(now+timedelta(days=2)).add_extension(x509.BasicConstraints(ca=True,path_length=0),True).add_extension(x509.KeyUsage(False,False,False,False,False,True,True,False,False),True).sign(ca,hashes.SHA256())
key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
leaf=x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'localhost')])).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(days=1)).not_valid_after(now+timedelta(days=2)).add_extension(x509.BasicConstraints(ca=False,path_length=None),True).add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'),x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),False).add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),False).sign(ca,hashes.SHA256())
(out/'ca.pem').write_bytes(root.public_bytes(serialization.Encoding.PEM));(out/'server.pem').write_bytes(leaf.public_bytes(serialization.Encoding.PEM));(out/'server.key').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
`,
  output,
]);
process.env.MATHECA_HTTPS_CA = path.join(output, "ca.pem");
let mode = "normal",
  seen = [],
  pending = [],
  failPageOnce = true,
  parallel = 0,
  maxParallel = 0;
const sockets = new Set();
const server = https.createServer(
  {
    key: fs.readFileSync(path.join(output, "server.key")),
    cert: fs.readFileSync(path.join(output, "server.pem")),
  },
  async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      res.writeHead(400).end();
      return;
    }
    assert.equal(req.headers.authorization, "Bearer matheca-phase4-synthetic");
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(payload.stream, false);
    const prompt = payload.messages[0].content[0].text;
    const target = Number(prompt.match(/目标起始页：(\d+)/)?.[1] || 0);
    const last = Number(prompt.match(/第 (\d+) 至 (\d+) 页/)?.[2] || 0);
    const images = payload.messages[0].content.filter(
      (p) => p.type === "image_url",
    );
    seen.push({
      mode,
      target,
      last,
      images: images.length,
      solve: prompt.includes("解题助手"),
    });
    parallel++;
    maxParallel = Math.max(maxParallel, parallel);
    let done = false;
    const end = () => {
      if (!done) {
        done = true;
        parallel--;
      }
    };
    res.once("close", end);
    res.once("finish", end);
    if (mode === "hold") await new Promise((r) => pending.push(r));
    if (res.destroyed) return;
    if (mode === "http401") {
      res.writeHead(401).end("SENSITIVE_PROVIDER_BODY");
      return;
    }
    if (mode === "redirect") {
      res.writeHead(302, { Location: "https://example.invalid/steal" }).end();
      return;
    }
    if (mode === "oversized") {
      res.writeHead(200, { "Content-Length": 5 * 1024 * 1024 }).end("x");
      return;
    }
    if (mode === "partial" && target === 2 && failPageOnce) {
      failPageOnce = false;
      res.writeHead(503).end();
      return;
    }
    let text;
    if (prompt.includes("描述图片的颜色")) text = "黑色";
    else if (prompt.includes("解题助手"))
      text = JSON.stringify({
        answer: "42",
        steps: ["由题设列式，得到结果。"],
        latex: "x=42",
        difficultyScore: 2,
      });
    else if (mode === "invalid") text = "not valid JSON";
    else {
      const q = {
        body: `本地模拟识别题 ${target || 1}：计算 6×7。`,
        subquestions: [],
        latex: "",
        grade: "高一",
        kind: "计算题",
        difficultyScore: 1,
        knowledgePoints: [],
      };
      if (target) {
        if (mode === "cross" && target === 1 && last < 3)
          text = JSON.stringify({ questions: [], needMorePages: true });
        else if (mode === "cross" && target > 1)
          text = JSON.stringify({ questions: [], needMorePages: false });
        else
          text = JSON.stringify({
            questions: [
              {
                ...q,
                startPage: target,
                endPage: mode === "cross" ? 3 : target,
                complete: true,
              },
            ],
            needMorePages: false,
          });
      } else text = JSON.stringify({ questions: [q] });
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: text } }],
      }),
    );
  },
);
server.on("connection", (s) => {
  sockets.add(s);
  s.once("close", () => sockets.delete(s));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const endpoint = `https://127.0.0.1:${server.address().port}/v1`;
const state = () => page.evaluate(() => window.matheca.state());
async function until(fn, message, ms = 60000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw Error(message);
    await wait(100);
  }
}
async function configure() {
  await page.evaluate(async (address) => {
    const s = (await window.matheca.state()).settings;
    await window.matheca.saveSettings({
      ...s,
      address,
      model: "local-fixture",
      apiKey: "matheca-phase4-synthetic",
      autoSolveImports: false,
    });
  }, endpoint);
}
async function importFile(file) {
  const bytes = Array.from(fs.readFileSync(file));
  return page.evaluate(
    async ({ name, bytes }) =>
      window.matheca.importDropped([new File([new Uint8Array(bytes)], name)]),
    { name: path.basename(file), bytes },
  );
}
async function imported(file) {
  const old = new Set((await state()).jobs.map((j) => j.id));
  await importFile(file);
  return until(async () => {
    const j = (await state()).jobs.find((j) => !old.has(j.id));
    return j && !["queued", "processing"].includes(j.status) ? j : false;
  }, "Import did not finish");
}
async function solve(qid) {
  await page.evaluate((id) => window.matheca.solveQuestion(id), qid);
  return until(async () => {
    const j = (await state()).jobs.find((j) => j.questionId === qid);
    return j && !["queued", "processing"].includes(j.status) ? j : false;
  }, "Solution did not finish");
}
async function createQuestion(id) {
  return page.evaluate(async (id) => {
    const q = (await window.matheca.state()).questions[0];
    return window.matheca.saveQuestion(
      {
        ...q,
        id,
        title: id,
        body: "计算 6×7。",
        sourcePath: "",
        figures: [],
        figureWidths: [],
        figurePlacements: [],
        autoSolve: false,
      },
      false,
    );
  }, id);
}
try {
  await start(data);
  await page.waitForSelector(".question-card");
  assert.equal(await page.evaluate(() => window.mathecaRuntime.phase), 6);
  await configure();
  await check(
    "Actual HTTPS vision request, encrypted settings and no secret in public state",
    async () => {
      assert.match(
        await page.evaluate(() => window.matheca.testVision()),
        /测试成功.*黑色/,
      );
      assert.ok(
        !JSON.stringify(await state()).includes("matheca-phase4-synthetic"),
      );
    },
  );
  let importedId;
  await check(
    "Browser File chunks → Rust → HTTPS recognition → atomic SQLite page and source image",
    async () => {
      const j = await imported(image);
      assert.equal(j.status, "complete");
      assert.equal(j.completed, 1);
      assert.equal(j.recognizedCount, 1);
      importedId = j.questionIds[0];
      const q = (await state()).questions.find((q) => q.id === importedId);
      assert.ok(q.body.includes("本地模拟"));
      assert.equal(q.reviewed, false);
      const size = await page.evaluate(async (id) => {
        const q = (await window.matheca.state()).questions.find(
          (q) => q.id === id,
        );
        const img = new Image();
        img.src = q.sourcePath;
        await img.decode();
        return [img.naturalWidth, img.naturalHeight];
      }, importedId);
      assert.ok(size[0] > 0 && size[1] > 0);
      const cropped = await page.evaluate(
        (id) =>
          window.matheca.cropFigure(id, {
            x: 0,
            y: 0,
            width: 0.5,
            height: 0.5,
          }),
        importedId,
      );
      assert.ok(cropped.startsWith("data:image/png;base64,"));
    },
  );
  await check(
    "Actual solution, no duplicate solve and stale response cannot overwrite edits",
    async () => {
      const q = await createQuestion("phase4-solve");
      const j = await solve(q.id);
      assert.equal(j.status, "complete");
      assert.match(
        (await state()).questions.find((x) => x.id === q.id).solution,
        /42/,
      );
      mode = "hold";
      const q2 = await createQuestion("phase4-stale");
      await page.evaluate(async (id) => {
        await window.matheca.solveQuestion(id);
        await window.matheca.solveQuestion(id);
      }, q2.id);
      await until(() => pending.length > 0, "No held request");
      assert.equal(
        (await state()).jobs.filter((j) => j.questionId === q2.id).length,
        1,
      );
      await page.evaluate(async (id) => {
        const q = (await window.matheca.state()).questions.find(
          (x) => x.id === id,
        );
        await window.matheca.saveQuestion(
          { ...q, body: "已修改的新条件" },
          true,
        );
      }, q2.id);
      mode = "normal";
      pending.splice(0).forEach((r) => r());
      await wait(400);
      assert.equal(
        (await state()).questions.find((q) => q.id === q2.id).solution,
        "",
      );
    },
  );
  await check(
    "PDF pages via hidden WebView, partial retry skips committed pages",
    async () => {
      mode = "partial";
      const begin = seen.length;
      const j = await imported(
        path.join(path.dirname(path.dirname(seed)), "electron-paper.pdf"),
      );
      assert.equal(j.status, "partial");
      assert.equal(j.completed, 2);
      assert.equal(j.total, 3);
      await page.evaluate((id) => window.matheca.resumeJob(id), j.id);
      const done = await until(async () => {
        const x = (await state()).jobs.find((x) => x.id === j.id);
        return x.status === "complete" ? x : false;
      }, "PDF retry failed");
      assert.equal(done.completed, 3);
      const targets = seen
        .slice(begin)
        .filter((r) => r.mode === "partial")
        .map((r) => r.target);
      assert.equal(targets.filter((t) => t === 1).length, 1);
      assert.equal(targets.filter((t) => t === 3).length, 1);
      assert.equal(targets.filter((t) => t === 2).length, 2);
      mode = "normal";
    },
  );
  await check(
    "Cross-page completion requests extra page and stores one complete question",
    async () => {
      mode = "cross";
      const begin = seen.length;
      const j = await imported(
        path.join(path.dirname(path.dirname(seed)), "electron-paper.pdf"),
      );
      assert.equal(j.status, "complete");
      assert.equal(j.recognizedCount, 1);
      assert.deepEqual(
        seen
          .slice(begin)
          .filter((x) => x.target === 1)
          .map((x) => x.last),
        [2, 3],
      );
      mode = "normal";
    },
  );
  await check(
    "Native HEIC DLL conversion, malformed HEIC rejected without a task",
    async () => {
      const j = await imported(
        path.join(path.dirname(path.dirname(seed)), "example.heic"),
      );
      assert.equal(j.status, "complete");
      const old = (await state()).jobs.length;
      await assert.rejects(
        () =>
          importFile(
            path.join(path.dirname(path.dirname(seed)), "invalid.heic"),
          ),
        /HEIC/,
      );
      assert.equal((await state()).jobs.length, old);
    },
  );
  await check(
    "HTTP auth/redirection/response caps and malformed model output fail honestly",
    async () => {
      for (const [m, pattern] of [
        ["http401", /认证失败/],
        ["redirect", /重定向/],
        ["oversized", /4 MB/],
        ["invalid", /有效的结构/],
      ]) {
        mode = m;
        const j = await imported(image);
        assert.equal(j.status, "failed");
        assert.match(j.message, pattern);
        assert.ok(!j.message.includes("SENSITIVE_PROVIDER_BODY"));
      }
      mode = "normal";
    },
  );
  await check(
    "Concurrency limit, cancellation and clean exit preserve resumable jobs",
    async () => {
      mode = "hold";
      for (const id of ["phase4-a", "phase4-b", "phase4-c"]) {
        await createQuestion(id);
        await page.evaluate((id) => window.matheca.solveQuestion(id), id);
      }
      await until(
        () => pending.length >= 2,
        "Two concurrent requests not started",
      );
      assert.equal(
        (await state()).jobs.filter((j) => j.status === "processing").length,
        2,
      );
      assert.ok((await state()).jobs.some((j) => j.status === "queued"));
      const j = (await state()).jobs.find((j) => j.questionId === "phase4-a");
      await page.evaluate((id) => window.matheca.cancelJob(id), j.id);
      await until(
        async () =>
          (await state()).jobs.find((x) => x.id === j.id).status === "paused",
        "Cancel not persisted",
      );
      await finish();
      mode = "normal";
      pending.splice(0).forEach((r) => r());
      await start(data);
      await page.waitForSelector(".question-card");
      const s = await state();
      assert.ok(
        !s.jobs.some((j) => ["processing", "queued"].includes(j.status)),
      );
      assert.ok(s.jobs.filter((j) => j.status === "paused").length >= 3);
      const resume = s.jobs.find((j) => j.questionId === "phase4-b");
      await page.evaluate((id) => window.matheca.resumeJob(id), resume.id);
      await until(
        async () =>
          (await state()).jobs.find((j) => j.id === resume.id).status ===
          "complete",
        "Restart resume failed",
      );
    },
  );

  await check(
    "Immediate pause/resume and process interruption preserve tasks without auto requests",
    async () => {
      mode = "hold";
      const q = await createQuestion("phase4-rapid");
      await page.evaluate((id) => window.matheca.solveQuestion(id), q.id);
      await until(() => pending.length > 0, "No held rapid request");
      const j = (await state()).jobs.find((j) => j.questionId === q.id);
      await page.evaluate(async (id) => {
        await window.matheca.cancelJob(id);
        await window.matheca.resumeJob(id);
      }, j.id);
      mode = "normal";
      pending.splice(0).forEach((r) => r());
      await until(
        async () =>
          (await state()).jobs.find((x) => x.id === j.id).status === "complete",
        "Rapid resume intent was lost",
      );
      mode = "hold";
      const crash = await createQuestion("phase4-crash");
      await page.evaluate((id) => window.matheca.solveQuestion(id), crash.id);
      await until(() => pending.length > 0, "No held crash request");
      const interrupted = (await state()).jobs.find(
        (j) => j.questionId === crash.id,
      );
      const exit = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exit;
      await browser.close().catch(() => {});
      child = undefined;
      browser = undefined;
      mode = "normal";
      pending.splice(0).forEach((r) => r());
      const count = seen.length;
      await start(data);
      await page.waitForSelector(".question-card");
      await wait(250);
      assert.equal(seen.length, count);
      assert.equal(
        (await state()).jobs.find((j) => j.id === interrupted.id).status,
        "paused",
      );
      await page.evaluate((id) => window.matheca.resumeJob(id), interrupted.id);
      await until(
        async () =>
          (await state()).jobs.find((j) => j.id === interrupted.id).status ===
          "complete",
        "Interrupted task could not resume",
      );
    },
  );
  if (process.argv.includes("--native")) {
    await check(
      "Native Windows file picker selects synthetic image and completes recognition",
      async () => {
        const before = new Set((await state()).jobs.map((j) => j.id));
        await page.evaluate(() => {
          window.__nativeChoice = window.matheca.chooseImport();
        });
        console.log("NATIVE IMPORT PICKER READY: " + image);
        await until(
          async () => {
            const j = (await state()).jobs.find((j) => !before.has(j.id));
            return j?.status === "complete";
          },
          "Native picker import did not finish",
          180000,
        );
        await page.evaluate(() => window.__nativeChoice);
      },
    );
  }
  await check(
    "Workbench renders migrated tasks and import results",
    async () => {
      await page
        .getByRole("button", { name: "任务", exact: true })
        .first()
        .click();
      await page.waitForSelector(".task-list");
      await page.screenshot({ path: path.join(output, "tasks.png") });
      await page
        .getByRole("button", { name: "题库", exact: true })
        .first()
        .click();
      await page.waitForSelector(".question-card");
      await page.screenshot({ path: path.join(output, "workbench.png") });
    },
  );
  await finish();
  await check(
    "Untrusted TLS certificate is rejected without changing Windows trust",
    async () => {
      const ca = process.env.MATHECA_HTTPS_CA;
      delete process.env.MATHECA_HTTPS_CA;
      try {
        await start(data);
        await page.waitForSelector(".question-card");
        await assert.rejects(
          () => page.evaluate(() => window.matheca.testVision()),
          /证书/,
        );
        await finish();
      } finally {
        process.env.MATHECA_HTTPS_CA = ca;
      }
    },
  );
  assert.deepEqual(errors, []);
  assert.ok(maxParallel <= 2, `HTTPS concurrency ${maxParallel}`);
  fs.writeFileSync(
    path.join(output, "REPORT.md"),
    `# Phase 6 packaged HTTPS/task regression\n\nEXE: ${exe}\n\nSHA256: ${hash(exe)}\n\n${results.map((n) => "- PASS: " + n).join("\n")}\n\nRenderer errors: 0\nHTTPS requests: ${seen.length}; maximum in flight: ${maxParallel}\nAll input and credentials synthetic; HTTPS bound to loopback; system certificate store unchanged.\n`,
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
  pending.splice(0).forEach((r) => r());
  if (child && child.exitCode === null) child.kill();
  if (browser) await browser.close().catch(() => {});
  for (const s of sockets) s.destroy();
  await new Promise((r) => server.close(r));
}
