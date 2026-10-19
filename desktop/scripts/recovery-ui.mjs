import { _electron as electron } from "playwright";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";

const root = path.resolve("test-output", "recovery-" + Date.now());
fs.mkdirSync(root, { recursive: true });
const data = path.join(root, "appdata"),
  database = path.join(data, "library.sqlite");
const env = { ...process.env, MATHECA_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
let app, writer;
const launch = async () => {
  app = await electron.launch({
    executablePath: process.env.MATHECA_EXE,
    env,
  });
  const page = await app.firstWindow();
  await page.locator("h1").waitFor();
  return page;
};
try {
  let page = await launch();
  await page.evaluate(() => window.matheca.examples());
  const initial = await page.evaluate(() => window.matheca.state());
  const question = {
    ...initial.questions[0],
    body: "崩溃前已确认内容",
    autoSolve: false,
  };
  await page.evaluate((q) => window.matheca.saveQuestion(q, true), question);
  const zip = path.join(root, "baseline.zip");
  await app.evaluate(({ dialog }, zip) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: zip });
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  }, zip);
  await page.evaluate(() => window.matheca.exportBackup());
  const historyFault = new Database(database);
  historyFault.exec(
    "CREATE TRIGGER audit_failure BEFORE INSERT ON history BEGIN SELECT RAISE(FAIL, 'injected audit failure'); END;",
  );
  // A committed export must still return success when audit storage fails.
  await page.evaluate(() => window.matheca.exportBackup());
  assert.equal(
    await page.evaluate(() => window.matheca.inspectBackup()),
    null,
  );
  await app.evaluate(({ dialog }, zip) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [zip] });
  }, zip);
  const preview = await page.evaluate(() => window.matheca.inspectBackup());
  await page.evaluate(
    (token) => window.matheca.dismissBackup(token),
    preview.token,
  );
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).questions.length,
    3,
  );
  assert.equal(fs.readdirSync(path.join(data, "staging")).length, 0);
  const confirmed = await page.evaluate(() => window.matheca.inspectBackup());
  const merged = await page.evaluate(
    (token) => window.matheca.restoreBackup(token),
    confirmed.token,
  );
  assert.equal(merged.questions, 0);
  assert.equal(merged.skippedQuestions, 3);
  const invalid = path.join(root, "corrupt.zip");
  fs.writeFileSync(invalid, fs.readFileSync(zip).subarray(0, 80));
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, invalid);
  await assert.rejects(
    page.evaluate(() => window.matheca.inspectBackup()),
    /ZIP/,
  );
  historyFault.exec("DROP TRIGGER audit_failure");
  historyFault.close();
  assert.equal(fs.readdirSync(path.join(data, "staging")).length, 0);
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).questions.find(
      (q) => q.id === question.id,
    ).body,
    question.body,
  );

  // Terminate only this isolated application's own process, simulating a crash.
  const crashed = once(app.process(), "exit");
  app.process().kill();
  await crashed;
  await app.close().catch(() => {});
  app = undefined;
  // A separate writer dies with an open SQLite transaction. Its uncommitted
  // edit must not replace the last saved question on the next app launch.
  writer = spawn(
    process.execPath,
    [
      "-e",
      `
    const D = require('better-sqlite3'), d = new D(process.argv[1]);
    d.exec('BEGIN IMMEDIATE');
    const row = d.prepare('SELECT data FROM questions WHERE id=?').get(process.argv[2]);
    const q = JSON.parse(row.data); q.body = '未提交的损坏内容';
    d.prepare('UPDATE questions SET data=? WHERE id=?').run(JSON.stringify(q), q.id);
    process.stdout.write('transaction-open'); setInterval(() => {}, 1000);
  `,
      database,
      question.id,
    ],
    {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("crash fixture timeout")),
      15000,
    );
    writer.stdout.once("data", () => {
      clearTimeout(timer);
      resolve();
    });
    writer.once("error", reject);
    writer.once("exit", (code) => {
      if (code) {
        clearTimeout(timer);
        reject(Error("crash fixture failed: " + code));
      }
    });
  });
  const exited = once(writer, "exit");
  writer.kill();
  await exited;
  writer = undefined;
  const orphan = path.join(data, "restored", "uncommitted-batch");
  fs.mkdirSync(orphan);
  fs.writeFileSync(path.join(orphan, "original.png"), "orphan source");
  const stage = path.join(data, "staging", "interrupted-preview");
  fs.mkdirSync(stage);
  fs.writeFileSync(path.join(stage, "fragment"), "partial");
  page = await launch();
  const restored = await page.evaluate(() => window.matheca.state());
  assert.equal(restored.questions.length, 3);
  assert.equal(
    restored.questions.find((q) => q.id === question.id).body,
    question.body,
  );
  assert.equal(fs.existsSync(orphan), false);
  assert.equal(fs.existsSync(stage), false);
  const db = new Database(database, { readonly: true });
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  db.close();
  await page.screenshot({ path: path.join(root, "after-crash.png") });
  console.log(
    "PASS: canceled/dismissed/corrupt/conflicting backup, staging cleanup, isolated app crash, killed uncommitted SQLite writer, committed data and integrity preserved after restart. Data: " +
      root,
  );
} finally {
  writer?.kill();
  if (app) await app.close();
}
