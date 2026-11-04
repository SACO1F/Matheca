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
const output = path.resolve(`test-output/tauri-phase3-${Date.now()}`);
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

const fakeAppData = path.join(output, "fake-roaming");
fs.mkdirSync(fakeAppData, { recursive: true });
const source = path.join(fakeAppData, "Matheca");
fs.renameSync(data, source);
execFileSync(process.env.MATHECA_QA_PYTHON || "python", [
  "-c",
  `
import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1]);q=json.loads(c.execute('select data from questions where id=?',('phase1-q-8',)).fetchone()[0]);q['sourcePath']=sys.argv[2];c.execute('update questions set data=? where id=?',(json.dumps(q,ensure_ascii=False),q['id']));c.commit();c.close()
`,
  path.join(source, "library.sqlite"),
  path.join(source, "source-figure.png"),
]);
const originalHash = hash(path.join(source, "library.sqlite"));
process.env.APPDATA = fakeAppData;
const target = path.join(output, "destination");
try {
  await start(target);
  await page.getByRole("button", { name: "复制原版题库", exact: true }).click();
  console.log("NATIVE PICKER READY: " + source);
  const deadline = Date.now() + 180000;
  while (
    (await page.evaluate(() => window.matheca.state())).questions.length !== 9
  ) {
    if (Date.now() > deadline) throw Error("Migration did not complete");
    await wait(500);
  }
  await page.waitForSelector(".question-card");
  const migrated = await page.evaluate(() => window.matheca.state());
  assert.equal(migrated.questions.length, 9);
  assert.equal(hash(path.join(source, "library.sqlite")), originalHash);
  assert.ok(fs.readdirSync(path.join(target, "migrated")).length > 0);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, "migration-completed.png") });
  await finish();
  await start(target);
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).questions.length,
    9,
  );
  await finish();
  fs.writeFileSync(
    path.join(output, "MIGRATION-REPORT.md"),
    `# Native migration picker verification\n\nEXE: ${exe}\n\n9 questions copied; source database SHA256 unchanged: ${originalHash}\nOwned image resources copied; restart persistence passed; renderer exceptions: 0.\n`,
  );
  console.log(
    "PASS native picker migration, source unchanged and restart persistence: " +
      output,
  );
} finally {
  if (child && child.exitCode === null) child.kill();
  if (browser) await browser.close().catch(() => {});
}
