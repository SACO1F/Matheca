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
const output = path.resolve(`test-output/tauri-phase8-${Date.now()}`);
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
    MATHECA_MOBILE_BIND: "127.0.0.1",
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
  try {
    await requestClose();
  } catch (e) {
    if (!/Target page, context or browser has been closed/.test(String(e)))
      throw e;
  }
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

const http = await import("node:http");
let mobile, base, token, device, credential, phoneBrowser, phone;
const original = path.resolve(
  "test-output/tauri-phase1-20261027-011039/electron-paper.zip",
);
const changedZip = path.join(output, "phone-changed.zip");
execFileSync(process.env.MATHECA_QA_PYTHON || "python", [
  "-c",
  `import zipfile,json,sys
with zipfile.ZipFile(sys.argv[1]) as z: entries={n:z.read(n) for n in z.namelist()}
d=json.loads(entries['manifest.json']);d['questions'][0]['body']='手机更新的题干';d['collections'][0]['title']='手机更新的题集';entries['manifest.json']=json.dumps(d,ensure_ascii=False).encode()
with zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED) as z:
 for n,b in entries.items():z.writestr(n,b)
`,
  original,
  changedZip,
]);
async function ms() {
  return page.evaluate(() => window.matheca.mobileStatus());
}
async function open() {
  mobile = await page.evaluate(() => window.matheca.mobileStart());
  const u = new URL(mobile.urls[0]);
  base = u.origin;
  token = new URLSearchParams(u.hash.slice(1)).get("pair");
  return mobile;
}
async function call(route, method = "GET", bytes = undefined, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      base + route,
      {
        method,
        headers: {
          Authorization: "Bearer " + token,
          "X-Device-Id": device || "a".repeat(32),
          ...(bytes ? { "Content-Length": bytes.length } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (b) => chunks.push(b));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          let json;
          try {
            json = JSON.parse(body);
          } catch {}
          resolve({ status: res.statusCode, body, json, headers: res.headers });
        });
      },
    );
    req.on("error", (e) => reject(Error(method + " " + route + " " + e.code)));
    if (bytes) req.write(bytes);
    req.end();
  });
}
async function upload(bytes, id, library = false) {
  return call(library ? "/api/library" : "/api/upload", "POST", bytes, {
    "Content-Type": library ? "application/zip" : "application/octet-stream",
    "X-Upload-Id": id,
    "X-File-Name": encodeURIComponent("手机测试.png"),
  });
}
const uuid = () => globalThis.crypto.randomUUID();
async function library(policy) {
  const id = uuid();
  const r = await upload(fs.readFileSync(changedZip), id, true);
  assert.equal(r.status, 201, r.json?.error);
  const p = await page.evaluate(
    (id) => window.matheca.mobileInspectLibrary(id),
    id,
  );
  assert.ok(p.conflicts >= 1);
  await page.evaluate(
    ({ id, policy }) => window.matheca.mobileApplyLibrary(id, policy),
    { id, policy },
  );
  return id;
}
try {
  await start(data);
  await page.waitForSelector(".question-card");
  assert.ok(await page.evaluate(() => window.mathecaRuntime.phase >= 8));
  await configure();
  await open();
  await check(
    "User-started HTTP service, QR and hardened phone page",
    async () => {
      assert.equal(mobile.status, "receiving");
      assert.match(token, /^[a-f0-9]{64}$/);
      assert.ok(mobile.qrCodes[0].startsWith("data:image/png;base64,"));
      const root = await call("/");
      assert.equal(root.status, 200);
      const script = root.body
        .toString()
        .match(/<script>([\s\S]*?)<\/script>/)[1]
        .replace(/\r\n?/g, "\n");
      assert.ok(
        root.headers["content-security-policy"].includes(
          createHash("sha256").update(script).digest("base64"),
        ),
      );
      assert.equal(
        (
          await call("/api/state", "GET", undefined, {
            Authorization: "Bearer " + "0".repeat(64),
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await call("/api/state", "GET", undefined, {
            Origin: "http://evil.invalid",
          })
        ).status,
        403,
      );
      assert.equal(
        (await call("/api/state", "GET", undefined, { Host: "evil.invalid" }))
          .status,
        403,
      );
    },
  );
  await check(
    "Actual phone browser waits for desktop approval and uploads a photo",
    async () => {
      phoneBrowser = await chromium.launch({
        channel: "msedge",
        headless: true,
      });
      phone = await phoneBrowser.newPage({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
      });
      await phone.goto(mobile.urls[0]);
      const pairing = await until(async () => {
        const s = await ms();
        return s.pairing || false;
      }, "No pairing request");
      device = pairing.id;
      assert.equal(pairing.approved, false);
      assert.equal(
        (await upload(fs.readFileSync(image), "1".repeat(32))).status,
        403,
      );
      await page.evaluate((id) => window.matheca.mobileApprove(id), device);
      await phone.locator("#send").waitFor();
      await until(
        async () =>
          await phone
            .locator("#connection")
            .innerText()
            .then((t) => t.includes("已连接") || t.includes("可以")),
        "Phone not approved",
      );
      await phone.locator("#album-file").setInputFiles(image);
      await phone.locator("#send").click();
      await until(
        async () => (await ms()).files.length === 1,
        "Phone upload not committed",
      );
      await phone.screenshot({ path: path.join(output, "phone-upload.png") });
      await page.getByRole("button", { name: "新建题目", exact: true }).click();
      await page
        .getByRole("menuitem", { name: "手机联动", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "手机联动", exact: true })
        .waitFor();
      await page.screenshot({ path: path.join(output, "desktop-mobile.png") });
      await page.getByRole("button", { name: "收起手机联动面板" }).click();
    },
  );
  await check(
    "Invalid images/oversize reject; retry receipt does not duplicate",
    async () => {
      const current = await call("/api/state");
      const id = current.json.files[0].uploadId;
      const duplicate = await upload(fs.readFileSync(image), id);
      assert.equal(duplicate.status, 200);
      assert.equal((await ms()).files.length, 1);
      assert.equal(
        (await upload(Buffer.from("not an image"), "2".repeat(32))).status,
        400,
      );
      const cap = await call("/api/upload", "POST", undefined, {
        "Content-Type": "application/octet-stream",
        "X-Upload-Id": "3".repeat(32),
        "Content-Length": 50 * 1024 * 1024 + 1,
      });
      assert.equal(cap.status, 413);
      const img = (await ms()).files[0];
      assert.ok(
        await page.evaluate(async (url) => {
          const image = new Image();
          image.src = url;
          await image.decode();
          return image.naturalWidth > 0;
        }, img.preview),
      );
    },
  );
  await check(
    "Desktop confirmation enters existing Rust AI queue exactly once",
    async () => {
      assert.equal(
        await page.evaluate(() => window.matheca.mobileConfirm()),
        1,
      );
      await until(async () => {
        const s = await ms();
        return s.tasks[0]?.status === "complete" && s.tasks[0];
      }, "Mobile job failed");
      assert.equal((await ms()).files.length, 0);
      assert.equal((await state()).questions.length, 10);
    },
  );
  await check(
    "Remembered device stores hash; pause rotates token and revocation blocks access",
    async () => {
      const trusted = await call("/api/trust", "POST", undefined, {
        "X-Device-Name": encodeURIComponent("隔离测试手机"),
      });
      assert.equal(trusted.status, 200);
      credential = trusted.json.credential;
      assert.match(credential, /^[a-f0-9]{64}$/);
      const old = token;
      await page.evaluate(() => window.matheca.mobilePause());
      await assert.rejects(() => call("/api/state"));
      await open();
      assert.notEqual(token, old);
      const r = await call("/api/state", "GET", undefined, {
        Authorization: "Bearer " + credential,
      });
      assert.equal(r.status, 200);
      assert.equal(r.json.approved, true);
    },
  );
  await check(
    "Pending photos and receipts survive clean restart without opening a listener",
    async () => {
      assert.equal(
        (await upload(fs.readFileSync(image), "4".repeat(32))).status,
        201,
      );
      await finish();
      await start(data);
      let s = await ms();
      assert.equal(s.status, "closed");
      assert.equal(s.files.length, 1);
      await open();
      const r = await call("/api/state", "GET", undefined, {
        Authorization: "Bearer " + credential,
      });
      assert.equal(r.json.approved, true);
      assert.equal(
        (await upload(fs.readFileSync(image), "4".repeat(32))).status,
        200,
      );
      s = await ms();
      await page.evaluate(
        (id) => window.matheca.mobileRemove(id),
        s.files[0].id,
      );
      assert.equal((await ms()).files.length, 0);
    },
  );
  await check(
    "Concurrency, interrupted transfer cleanup and 20-photo inbox limit",
    async () => {
      const held = [];
      for (let n = 0; n < 2; n++) {
        const socket = net.connect(Number(new URL(base).port), "127.0.0.1");
        socket.on("error", () => {});
        await new Promise((r) => socket.once("connect", r));
        socket.write(
          `POST /api/upload HTTP/1.1\r\nHost: ${new URL(base).host}\r\nAuthorization: Bearer ${token}\r\nX-Device-Id: ${device}\r\nContent-Type: application/octet-stream\r\nX-Upload-Id: ${String(7 + n).repeat(32)}\r\nContent-Length: 100000\r\n\r\npartial`,
        );
        held.push(socket);
      }
      const folder = path.join(data, "mobile-inbox");
      await until(
        () =>
          fs.readdirSync(folder).filter((n) => n.endsWith(".part")).length ===
          2,
        "Transfers not reserved",
      );
      assert.equal(
        (await upload(fs.readFileSync(image), "9".repeat(32))).status,
        409,
      );
      await page.evaluate(() => window.matheca.mobilePause());
      held.forEach((s) => s.destroy());
      assert.equal(
        fs.readdirSync(folder).filter((n) => n.endsWith(".part")).length,
        0,
      );
      await open();
      assert.equal(
        (
          await call("/api/state", "GET", undefined, {
            Authorization: "Bearer " + credential,
          })
        ).json.approved,
        true,
      );
      for (let n = 0; n < 20; n++) {
        const r = await upload(
          fs.readFileSync(image),
          n.toString(16).padStart(32, "0"),
        );
        assert.equal(r.status, 201, r.json?.error);
      }
      assert.equal((await ms()).files.length, 20);
      assert.equal(
        (await upload(fs.readFileSync(image), "f".repeat(32))).status,
        413,
      );
      for (const photo of (await ms()).files)
        await page.evaluate((id) => window.matheca.mobileRemove(id), photo.id);
    },
  );
  await check(
    "Library keep/copy/replace policies, stale preview and receipt",
    async () => {
      const id = uuid();
      assert.equal(
        (await upload(fs.readFileSync(changedZip), id, true)).status,
        201,
      );
      let p = await page.evaluate(
        (id) => window.matheca.mobileInspectLibrary(id),
        id,
      );
      assert.ok(p.conflicts >= 2);
      const q = (await state()).questions[0];
      await page.evaluate(
        (q) =>
          window.matheca.saveQuestion({ ...q, favorite: !q.favorite }, false),
        q,
      );
      await assert.rejects(
        () =>
          page.evaluate(
            (id) => window.matheca.mobileApplyLibrary(id, "replace"),
            id,
          ),
        /变化/,
      );
      await page.evaluate((id) => window.matheca.mobileDiscardLibrary(id), id);
      await library("keep");
      assert.equal((await state()).questions.length, 10);
      await library("copy");
      assert.equal((await state()).questions.length, 11);
      const replaced = await library("replace");
      const s = await state();
      assert.ok(s.questions.some((q) => q.body === "手机更新的题干"));
      assert.ok(s.collections.some((c) => c.title === "手机更新的题集"));
      assert.equal(
        (await upload(fs.readFileSync(changedZip), replaced, true)).status,
        200,
      );
      const bad = await upload(Buffer.from("not a zip"), uuid(), true);
      assert.equal(bad.status, 400);
    },
  );
  await check(
    "Compatible inventory and selected/delta ZIP downloads",
    async () => {
      const inv = await call("/api/inventory");
      assert.equal(inv.status, 200, inv.json?.error);
      assert.equal(inv.json.version, 1);
      assert.ok(Object.keys(inv.json.questions).length === 11);
      assert.equal(
        (
          await call(
            "/api/inventory",
            "POST",
            Buffer.from(JSON.stringify(inv.json)),
            { "Content-Type": "application/json" },
          )
        ).status,
        200,
      );
      const q = (await state()).questions[0];
      await assert.rejects(
        () =>
          page.evaluate(
            (qid) =>
              window.matheca.mobileSendLibrary({
                questionIds: [qid],
                collectionIds: [],
                changedOnly: true,
              }),
            q.id,
          ),
        /一致/,
      );
      await page.evaluate(
        (q) =>
          window.matheca.saveQuestion({ ...q, favorite: !q.favorite }, false),
        q,
      );
      const s = await page.evaluate(
        (qid) =>
          window.matheca.mobileSendLibrary({
            questionIds: [qid],
            collectionIds: [],
            changedOnly: true,
          }),
        q.id,
      );
      const transfer = s.transfers.at(-1);
      assert.ok(transfer.name.endsWith(".zip"));
      const r = await call("/api/download/" + transfer.id);
      assert.equal(r.status, 200);
      fs.writeFileSync(path.join(output, "selected-download.zip"), r.body);
      assert.equal((await ms()).transfers.at(-1).status, "transferred");
      assert.ok(!JSON.stringify(await ms()).includes("mobile-inbox"));
    },
  );
  if (process.argv.includes("--native")) {
    const target = path.join(output, "phone-document.pdf");
    console.log("SAVE PDF READY: " + target);
    await page.evaluate(() => {
      window.__documentResult = null;
      window.matheca.exportCollection("phase1-paper", "pdf").then(
        (data) => (window.__documentResult = { ok: true, data }),
        (e) => (window.__documentResult = { ok: false, error: e.message }),
      );
    });
    const r = await until(
      () => page.evaluate(() => window.__documentResult),
      "PDF save timed out",
      240000,
    );
    assert.equal(r.ok, true, r.error);
    await check(
      "Only unchanged generated documents can be shared and downloaded",
      async () => {
        const s = await page.evaluate(
          (p) => window.matheca.mobileShare(p),
          target,
        );
        const t = s.transfers.at(-1);
        const r = await call("/api/download/" + t.id);
        assert.equal(r.status, 200);
        assert.deepEqual(r.body, fs.readFileSync(target));
        await assert.rejects(() =>
          page.evaluate(() =>
            window.matheca.mobileShare("C:\\Windows\\notepad.exe"),
          ),
        );
        fs.appendFileSync(target, "tampered");
        await assert.rejects(
          () => page.evaluate((p) => window.matheca.mobileShare(p), target),
          /变化/,
        );
      },
    );
  }
  await check(
    "Revoking device and ending connection invalidate old credentials/downloads",
    async () => {
      await page.evaluate(
        (id) => window.matheca.mobileForgetDevice(id),
        device,
      );
      assert.equal(
        (
          await call("/api/state", "GET", undefined, {
            Authorization: "Bearer " + credential,
          })
        ).status,
        401,
      );
      await page.evaluate(() => window.matheca.mobilePause());
      await assert.rejects(() => call("/api/state"));
      assert.equal((await ms()).status, "closed");
    },
  );
  await phoneBrowser.close();
  phoneBrowser = undefined;
  await finish();
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, "REPORT.md"),
    `# Phase 8 packaged mobile verification\n\nEXE: ${exe}\nSHA256: ${hash(exe)}\n\n${results.map((n) => "- PASS: " + n).join("\n")}\n\nRenderer exceptions: 0. Phone browser used isolated headless Edge; HTTP and synthetic HTTPS services bound to loopback. Normal library, clipboard and system trust unchanged.\n`,
  );
  console.log("Evidence: " + output);
} catch (e) {
  if (page)
    await page
      .screenshot({ path: path.join(output, "failure.png") })
      .catch(() => {});
  fs.writeFileSync(path.join(output, "FAILURE.txt"), String(e.stack || e));
  throw e;
} finally {
  pending.splice(0).forEach((r) => r());
  if (child && child.exitCode === null) child.kill();
  if (browser) await browser.close().catch(() => {});
  if (phoneBrowser) await phoneBrowser.close();
  for (const s of sockets) s.destroy();
  await new Promise((r) => server.close(r));
}
