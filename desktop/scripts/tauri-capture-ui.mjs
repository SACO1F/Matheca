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
    MATHECA_CAPTURE_FIXTURE: path.join(folder, "capture-fixture.json"),
    MATHECA_TEST_NATIVE_ACTIONS: "1",
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

const fixture = path.join(data, "capture-fixture.json");
execFileSync(process.env.MATHECA_QA_PYTHON || "python", [
  "-c",
  `from PIL import Image,ImageDraw
from pathlib import Path
import sys
root=Path(sys.argv[1])
for name,bias in [('capture-a.png',0),('capture-b.png',80)]:
 im=Image.new('RGB',(1024,640));p=im.load()
 for y in range(640):
  for x in range(1024):p[x,y]=(x%256,y%256,(x+y+bias)%256)
 ImageDraw.Draw(im).text((30,30),'Matheca isolated capture fixture',(255,255,255));im.save(root/name)
`,
  data,
]);
const setScreens = (count = 1) =>
  fs.writeFileSync(
    fixture,
    JSON.stringify(
      Array.from({ length: count }, (_, i) => ({
        file: i ? "capture-b.png" : "capture-a.png",
        x: i ? -1024 : 0,
        y: 0,
      })),
    ),
  );
setScreens();
const overlays = () =>
  browser
    .contexts()
    .flatMap((c) => c.pages())
    .filter((p) => p.url().includes("tauri-capture.html"));
async function begin(count = 1) {
  setScreens(count);
  await page.evaluate(() => {
    window.__captureResult = null;
    window.matheca.captureImport().then(
      (data) => (window.__captureResult = { ok: true, data }),
      (e) => (window.__captureResult = { ok: false, error: e.message }),
    );
  });
  await until(() => overlays().length === count, "Overlay count mismatch");
  const pages = overlays();
  for (const p of pages)
    await p.waitForFunction(
      () =>
        document.querySelector("#screen")?.complete &&
        document.querySelector("#screen")?.naturalWidth === 1024,
    );
  return pages;
}
async function settled() {
  const r = await until(
    () => page.evaluate(() => window.__captureResult),
    "Capture did not settle",
    240000,
  );
  await until(() => overlays().length === 0, "Overlay leaked");
  assert.equal(
    await page.evaluate(() =>
      window.__TAURI__.window.getCurrentWindow().isVisible(),
    ),
    true,
  );
  return r;
}
async function select(p) {
  const viewport = await p.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  const r = {
    x: 100,
    y: 90,
    width: 220,
    height: 130,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  };
  await p.mouse.move(r.x, r.y);
  await p.mouse.down();
  await p.mouse.move(r.x + r.width, r.y + r.height, { steps: 8 });
  await p.mouse.up();
  await p.locator("#capture-actions").waitFor({ state: "visible" });
  return r;
}
async function checkCrop(job, rect, file) {
  const original = path.join(data, file);
  const target = job.paths[0];
  fs.writeFileSync(path.join(output, "last-rect.json"), JSON.stringify(rect));
  execFileSync(process.env.MATHECA_QA_PYTHON || "python", [
    "-c",
    `from PIL import Image,ImageChops
import json,sys,math
r=json.loads(sys.argv[3]);im=Image.open(sys.argv[1]).convert('RGB');actual=Image.open(sys.argv[2]).convert('RGB');w,h=im.size
x=min(w-1,math.floor(r['x']/r['viewportWidth']*w));y=min(h-1,math.floor(r['y']/r['viewportHeight']*h));cw=min(w-x,max(1,math.floor(r['width']/r['viewportWidth']*w+0.5)));ch=min(h-y,max(1,math.floor(r['height']/r['viewportHeight']*h+0.5)))
expected=im.crop((x,y,x+cw,y+ch));assert actual.size==expected.size,(actual.size,expected.size);assert not ImageChops.difference(actual,expected).getbbox()
`,
    original,
    target,
    JSON.stringify(rect),
  ]);
}
try {
  await start(data);
  await page.waitForSelector(".question-card");
  await configure();
  await check(
    "All 53 request channels implemented and fixed guide actions reject arbitrary values",
    async () => {
      const runtime = await page.evaluate(() => window.mathecaRuntime);
      assert.ok(runtime.phase >= 8);
      assert.equal(runtime.implemented.length, 53);
      assert.deepEqual(runtime.deferred, []);
      const guide = JSON.parse(
        fs.readFileSync("src/shared/guide-data.json", "utf8"),
      );
      for (const key of Object.keys(guide.links))
        await page.evaluate((k) => window.matheca.openGuideLink(k), key);
      for (const key of Object.keys(guide.values))
        await page.evaluate((k) => window.matheca.copyGuideValue(k), key);
      const actions = fs
        .readFileSync(path.join(data, "native-actions.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse);
      assert.equal(actions.length, 10);
      assert.equal(actions.filter((a) => a.kind === "copy").length, 2);
      for (const key of ["https://evil.invalid", "__proto__", "../../file"])
        await assert.rejects(() =>
          page.evaluate((k) => window.matheca.openGuideLink(k), key),
        );
      await assert.rejects(() =>
        page.evaluate(() => window.__TAURI__.core.invoke("capture_ready")),
      );
    },
  );
  await check(
    "Escape cancels without jobs; capture window has no workbench/worker permission",
    async () => {
      const old = (await state()).jobs.length;
      const [p] = await begin();
      assert.equal(
        await page.evaluate(() =>
          window.__TAURI__.window.getCurrentWindow().isVisible(),
        ),
        false,
      );
      for (const command of ["desktop_call", "bootstrap", "worker_reply"]) {
        const denied = await p.evaluate(async (command) => {
          try {
            await window.__TAURI__.core.invoke(command, {
              channel: "library:state",
              args: [],
              id: "x",
              result: null,
              error: null,
            });
            return false;
          } catch {
            return true;
          }
        }, command);
        assert.equal(denied, true);
      }
      await p.keyboard.press("Escape");
      const r = await settled();
      assert.equal(r.data, null);
      assert.equal((await state()).jobs.length, old);
    },
  );
  await check(
    "Minimum region/reset and native viewport guards reject invalid selections",
    async () => {
      const [p] = await begin();
      await p.mouse.move(20, 20);
      await p.mouse.down();
      await p.mouse.move(24, 24);
      await p.mouse.up();
      assert.equal(await p.locator("#capture-actions").isVisible(), false);
      const r = await select(p);
      await p.locator("#reset").click();
      assert.equal(await p.locator("#selection").isVisible(), false);
      const message = await p.evaluate(async (rect) => {
        try {
          await window.__TAURI__.core.invoke("capture_confirm", {
            rect: { ...rect, viewportWidth: 1 },
          });
          return "";
        } catch (e) {
          return String(e);
        }
      }, r);
      assert.match(message, /框选|缩放/);
      await p.keyboard.press("Escape");
      assert.equal((await settled()).data, null);
    },
  );
  await check(
    "Actual selection and Enter produce exact cropped pixels and one AI job",
    async () => {
      const previous = new Set((await state()).jobs.map((j) => j.id));
      const [p] = await begin();
      const r = await select(p);
      await p.screenshot({ path: path.join(output, "selection.png") });
      await p.keyboard.press("Enter");
      const result = await settled();
      assert.equal(result.ok, true, result.error);
      assert.equal(result.data, true);
      const job = await until(async () => {
        const j = (await state()).jobs.find((j) => !previous.has(j.id));
        return j?.status === "complete" ? j : false;
      }, "Capture job failed");
      await checkCrop(job, r, "capture-a.png");
      assert.ok(job.labels[0].startsWith("截图-"));
    },
  );
  await check(
    "Multiple display windows cancel together and busy capture cannot reenter",
    async () => {
      const ps = await begin(2);
      const result = await page.evaluate(async () => {
        try {
          await window.matheca.captureImport();
          return "";
        } catch (e) {
          return e.message;
        }
      });
      assert.match(result, /正在进行/);
      await ps[1].keyboard.press("Escape");
      assert.equal((await settled()).data, null);
    },
  );
  await check("A secondary display uses its own frozen pixels", async () => {
    const old = new Set((await state()).jobs.map((j) => j.id));
    const ps = await begin(2);
    const p = await until(async () => {
      for (const p of ps) {
        const x = await p.evaluate(async () => {
          const im = document.querySelector("#screen");
          const c = document.createElement("canvas");
          c.width = im.naturalWidth;
          c.height = im.naturalHeight;
          c.getContext("2d").drawImage(im, 0, 0);
          return c.getContext("2d").getImageData(0, 0, 1, 1).data[2];
        });
        if (x === 80) return p;
      }
      return false;
    }, "Secondary frozen frame missing");
    const r = await select(p);
    await p.locator("#confirm").click();
    assert.equal((await settled()).data, true);
    const job = await until(async () => {
      const j = (await state()).jobs.find((j) => !old.has(j.id));
      return j?.status === "complete" ? j : false;
    }, "Secondary capture job failed");
    await checkCrop(job, r, "capture-b.png");
  });
  await check(
    "Bad capture input restores workbench without publishing a task",
    async () => {
      const old = (await state()).jobs.length;
      fs.writeFileSync(
        fixture,
        JSON.stringify([{ file: "../outside.png", x: 0, y: 0 }]),
      );
      const r = await page.evaluate(async () => {
        try {
          await window.matheca.captureImport();
          return "";
        } catch (e) {
          return e.message;
        }
      });
      assert.ok(r);
      assert.equal(overlays().length, 0);
      assert.equal((await state()).jobs.length, old);
      assert.equal(
        await page.evaluate(() =>
          window.__TAURI__.window.getCurrentWindow().isVisible(),
        ),
        true,
      );
      setScreens();
    },
  );
  if (process.argv.includes("--native")) {
    await begin();
    console.log("NATIVE SELECTION AND ESCAPE READY");
    const r = await settled();
    assert.equal(r.data, null);
    results.push("Native pointer selection and Escape return to workbench");
    await begin();
    console.log("NATIVE ALT-F4 READY");
    const closed = await settled();
    assert.equal(closed.data, null);
    results.push("Native Alt-F4 cancels the overlay without exiting workbench");
  }
  await check(
    "Background close during capture keeps workbench hidden",
    async () => {
      await page.evaluate(() => window.matheca.setCloseAction("background"));
      await begin();
      await requestClose();
      await until(
        () => page.evaluate(() => window.__captureResult),
        "Capture did not cancel",
      );
      await until(() => overlays().length === 0, "Overlay leaked");
      await wait(250);
      assert.equal(
        await page.evaluate(() =>
          window.__TAURI__.window.getCurrentWindow().isVisible(),
        ),
        false,
      );
      await page.evaluate(() =>
        window.__TAURI__.core.invoke("desktop_call", {
          channel: "window:show",
          args: [],
        }),
      );
      await page.evaluate(() => window.matheca.setCloseAction("quit"));
    },
  );
  await check(
    "Closing with an active capture cancels overlays and exits cleanly",
    async () => {
      await begin();
      await finish();
      await start(data);
      assert.equal(overlays().length, 0);
      assert.equal((await state()).jobs.length, 2);
      await finish();
    },
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, "REPORT.md"),
    `# Phase 8 packaged capture verification\n\nEXE: ${exe}\nSHA256: ${hash(exe)}\n\n${results.map((n) => "- PASS: " + n).join("\n")}\n\nAll screens are synthetic isolated fixtures. No user desktop image, normal library, system clipboard or external browser was accessed. Fixed guide actions were recorded into the isolated native-action sink. Renderer exceptions: 0.\n`,
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
  for (const s of sockets) s.destroy();
  await new Promise((r) => server.close(r));
}
