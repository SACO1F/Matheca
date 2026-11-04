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
const output = path.resolve(`test-output/tauri-phase6-${Date.now()}`);
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
  try { await requestClose(); } catch(error) { if(!/Target page, context or browser has been closed/.test(String(error))) throw error; }
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
const native = process.argv.includes("--native");
const original = path.resolve(option("--archive", "test-output/tauri-phase1-20261027-011039/electron-paper.zip"));
const empty = path.join(output,"restored-appdata");fs.mkdirSync(empty);
const fixture = path.join(output,"fixtures");fs.mkdirSync(fixture);
execFileSync(process.env.MATHECA_QA_PYTHON || "python", ["-c", `
import zipfile,json,sys,pathlib,hashlib
source,out=map(pathlib.Path,sys.argv[1:])
with zipfile.ZipFile(source) as z: entries={n:z.read(n) for n in z.namelist()}
def write(name,entries):
 with zipfile.ZipFile(out/name,'w',zipfile.ZIP_DEFLATED) as z:
  for n,b in entries.items():z.writestr(n,b)
write('traversal.zip',{**entries,'../escape.txt':b'bad'})
write('extra.zip',{**entries,'extra.txt':b'bad'})
manifest=json.loads(entries['manifest.json'])
for name,edit in [('future',lambda d:d.update(version=99)),('duplicate',lambda d:d['questions'].append(d['questions'][0])),('orphan',lambda d:d['items'][0].update(questionId='not-present')),('long',lambda d:d['questions'][0].update(createdAt=9223372036854775808))]:
 d=json.loads(entries['manifest.json']);edit(d);write(name+'.zip',{**entries,'manifest.json':json.dumps(d,ensure_ascii=False).encode()})
image=next(n for n in entries if n.startswith('sources/'));write('hash.zip',{**entries,image:b'tampered'})
write('missing.zip',{n:b for n,b in entries.items() if n!=image})
d=json.loads(entries['manifest.json']);d['format']='MathectorLibraryBackup';d['questions'][0]['createdAt']=-9223372036854775808;write('legacy-long.zip',{**entries,'manifest.json':json.dumps(d,ensure_ascii=False).encode()})
`, original,fixture]);
async function drop(file, browserFile=false) {
 if(browserFile)return page.evaluate(async ({bytes,name})=>window.matheca.importDropped([new File([Uint8Array.from(bytes)],name)]),{bytes:Array.from(fs.readFileSync(file)),name:path.basename(file)});
 const r=await page.evaluate(async file=>window.__TAURI__.core.invoke("desktop_call",{channel:"intake:drop",args:[[file]]}),file);
 if(!r.ok)throw Error(r.error);return r.data;
}
async function pendingResult(message) {const end=Date.now()+240000;while(Date.now()<end){const r=await page.evaluate(()=>window.__nativeResult);if(r)return r;await wait(100);}throw Error(message);}
try {
 await start(data);assert.equal(await page.evaluate(()=>window.mathecaRuntime.phase),6);
 if(native){
  const target=path.join(output,"tauri-backup.zip");console.log("SAVE BACKUP READY: "+target);
  await page.evaluate(()=>{window.__nativeResult=null;window.matheca.exportBackup().then(data=>window.__nativeResult={ok:true,data},e=>window.__nativeResult={ok:false,error:e.message});});
  await check("Native ZIP export preserves images and excludes settings/keys/jobs",async()=>{const r=await pendingResult("save timed out");assert.equal(r.ok,true,r.error);assert.equal(path.resolve(r.data.path),target);assert.equal(r.data.missingImages,0);});
 }
 await finish();await start(empty);
 let preview;
 await check("Electron ZIP native path preview and dismiss leave library empty",async()=>{
  preview=await drop(original);assert.equal(preview.questions,9);assert.equal(preview.collections,1);assert.equal(preview.images,1);assert.equal((await state()).questions.length,0);
  await page.evaluate(t=>window.matheca.dismissBackup(t),preview.token);await assert.rejects(()=>page.evaluate(t=>window.matheca.restoreBackup(t),preview.token),/过期/);assert.equal((await state()).questions.length,0);
 });
 await check("Malformed, traversal, missing/hash, future and exact integer overflow rejected without writes",async()=>{
  for(const name of ["traversal","extra","future","duplicate","orphan","hash","missing","long"]){await assert.rejects(()=>drop(path.join(fixture,name+".zip")),undefined,name);assert.equal((await state()).questions.length,0);}
 });
 await check("Confirmation revalidates staged copy and rolls back on tampering",async()=>{
  const p=await drop(original);const staged=path.join(empty,"backup-staging");const dirs=fs.readdirSync(staged);assert.equal(dirs.length,1);fs.writeFileSync(path.join(staged,dirs[0],"archive.zip"),"corrupted after preview");
  await assert.rejects(()=>page.evaluate(t=>window.matheca.restoreBackup(t),p.token));assert.equal((await state()).questions.length,0);assert.equal(fs.readdirSync(staged).length,0);
 });
 await check("Browser File chunks return preview; legacy brand and i64 minimum survive",async()=>{
  preview=await drop(path.join(fixture,"legacy-long.zip"),true);assert.equal(preview.questions,9);
  const r=await page.evaluate(t=>window.matheca.restoreBackup(t),preview.token);assert.equal(r.questions,9);assert.equal(r.collections,1);
  const s=await state();assert.equal(s.questions.length,9);assert.ok(s.questions.some(q=>q.createdAt==="-9223372036854775808"));assert.equal(s.jobs.length,0);assert.equal(s.settings.hasApiKey,false);
  const photo=s.questions.find(q=>q.sourcePath);assert.ok(photo);assert.ok(await page.evaluate(async url=>{const image=new Image();image.src=url;await image.decode();return image.naturalWidth>0;},photo.sourcePath));
 });
 await check("Second restore preserves local edits and collection order",async()=>{
  const q=(await state()).questions[0];await page.evaluate(q=>window.matheca.saveQuestion({...q,body:"本地保留题干"},false),q);
  const order=(await state()).items;
  preview=await drop(original);const r=await page.evaluate(t=>window.matheca.restoreBackup(t),preview.token);assert.equal(r.questions,0);assert.equal(r.skippedQuestions,9);assert.equal(r.skippedCollections,1);
  const s=await state();assert.equal(s.questions.find(v=>v.id===q.id).body,"本地保留题干");assert.deepEqual(s.items,order);
 });
 if(native){
  await check("Tauri exported archive can be restored by Tauri",async()=>{preview=await drop(path.join(output,"tauri-backup.zip"));assert.equal(preview.questions,9);await page.evaluate(t=>window.matheca.dismissBackup(t),preview.token);});
  console.log("PICK BACKUP READY: "+original);
  await page.evaluate(()=>{window.__nativeResult=null;window.matheca.inspectBackup().then(data=>window.__nativeResult={ok:true,data},e=>window.__nativeResult={ok:false,error:e.message});});
  await check("Native file picker preview uses same verified copy",async()=>{const r=await pendingResult("picker timed out");assert.equal(r.ok,true,r.error);assert.equal(r.data.questions,9);await page.evaluate(t=>window.matheca.dismissBackup(t),r.data.token);});
 }
 await check("React drag-drop preview and cancel",async()=>{
  const bytes=Array.from(fs.readFileSync(original));await page.locator(".app").evaluate((element,bytes)=>{const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(bytes)],"sample.zip",{type:"application/zip"}));element.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:transfer}));},bytes);
  await page.getByRole("heading",{name:"题库导入预览",exact:true}).waitFor();await page.screenshot({path:path.join(output,"backup-preview.png")});await page.locator(".modal").filter({has:page.getByRole("heading",{name:"题库导入预览"})}).getByRole("button",{name:"取消",exact:true}).click();await page.getByRole("heading",{name:"题库导入预览",exact:true}).waitFor({state:"hidden"});
 });
 await finish();await start(empty);await check("Restored images and data survive clean restart",async()=>{assert.equal((await state()).questions.length,9);assert.equal((await state()).items.length,9);});await finish();
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(output,"REPORT.md"),`# Phase 6 packaged backup verification\n\nEXE: ${exe}\nSHA256: ${hash(exe)}\n\n${results.map(n=>"- PASS: "+n).join("\n")}\n\nRenderer errors: 0. All data synthetic; normal library unchanged.\n`);console.log("Evidence: "+output);
} catch(error){if(page)await page.screenshot({path:path.join(output,"failure.png")}).catch(()=>{});fs.writeFileSync(path.join(output,"FAILURE.txt"),String(error.stack||error));throw error;}finally{if(child&&child.exitCode===null)child.kill();if(browser)await browser.close().catch(()=>{});}
