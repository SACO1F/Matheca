import { appTest } from "./tauri-ui-session.mjs";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("test-output", `save-race-${Date.now()}`);
const env = { ...process.env, MATHECA_TEST_DATA: root };
let app, lock;
async function acquire() {
  // Use a real SQLite writer to reproduce slow storage. No business API is mocked.
  lock = spawn(
    process.env.MATHECA_QA_PYTHON || "python",
    [
      "-u",
      "-c",
      "import sqlite3,sys; d=sqlite3.connect(sys.argv[1]); d.execute('BEGIN IMMEDIATE'); print('LOCKED',flush=True); sys.stdin.readline(); d.rollback(); d.close()",
      path.join(root, "library.sqlite"),
    ],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("SQLite lock not acquired")),
      5000,
    );
    lock.once("error", reject);
    lock.stdout.once("data", (bytes) => {
      clearTimeout(timer);
      assert.match(String(bytes), /LOCKED/);
      resolve();
    });
  });
}
async function release() {
  const finished = new Promise((resolve) => lock.once("exit", resolve));
  lock.stdin.end("release\n");
  await finished;
  lock = undefined;
}

try {
  app = await appTest.launch({ executablePath: process.env.MATHECA_EXE, env });
  const page = await app.firstWindow();
  await page.evaluate(() => window.matheca.examples());
  await page.locator(".question-card .card-review").first().click();
  const body = page.getByRole("textbox", { name: "题干与小题", exact: true });
  await body.fill("保存开始时的题干");
  await acquire();
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(150);
  await page.keyboard.press("Control+s");
  await page.keyboard.press("Control+s");
  await body.fill("保存过程中继续输入的新题干，不得被旧响应覆盖");
  await release();
  await page.waitForFunction(
    () =>
      !document.querySelector('button[aria-label="关闭题目校对"]')?.disabled,
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: "after-slow-save.png" });
  assert.equal(
    await body.inputValue(),
    "保存过程中继续输入的新题干，不得被旧响应覆盖",
    "slow save must preserve newer typing",
  );
  await page.waitForFunction(async () =>
    (await window.matheca.state()).questions.some(
      (q) => q.body === "保存过程中继续输入的新题干，不得被旧响应覆盖",
    ),
  );
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.locator(".editor").waitFor({ state: "detached" });
  await page.locator(".question-card .card-review").first().click();
  await body.fill("切页前旧题干");
  await acquire();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "任务", exact: true })
    .click();
  await page.waitForTimeout(150);
  await body.fill("切页保存期间的新输入必须入库");
  await release();
  await page
    .getByRole("heading", { name: "任务", exact: true, level: 1 })
    .waitFor();
  assert.ok(
    await page.evaluate(async () =>
      (await window.matheca.state()).questions.some(
        (q) => q.body === "切页保存期间的新输入必须入库",
      ),
    ),
  );
  await app.close();
  app = undefined;
  app = await appTest.launch({ executablePath: process.env.MATHECA_EXE, env });
  const restarted = await app.firstWindow();
  assert.ok(
    await restarted.evaluate(async () =>
      (await window.matheca.state()).questions.some(
        (q) => q.body === "切页保存期间的新输入必须入库",
      ),
    ),
  );
  fs.writeFileSync(
    path.join(root, "REPORT.md"),
    "PASS: real SQLite writer delay; repeated Ctrl+S and typing preserve and persist newest content; navigation waits for newer input to save; restart retains it.\n",
  );
  console.log(`PASS save race: ${root}`);
} finally {
  if (lock) {
    lock.stdin.end("release\n");
  }
  await app?.close();
}
