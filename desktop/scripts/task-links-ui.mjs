import { _electron as electron } from "playwright";
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const output = path.resolve("test-output", `task-links-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env, MATHECA_TEST_DATA: path.join(output, "data") };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath =
  process.env.MATHECA_EXE ||
  fs
    .readFileSync("releases/latest.txt", "utf8")
    .match(/^EXE: (.+)$/m)[1]
    .trim();
const app = await electron.launch({ executablePath, env });
let db;
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await page.locator("h1").waitFor();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const questions = await page.evaluate(async () => {
    await window.matheca.examples();
    return (await window.matheca.state()).questions;
  });
  db = new Database(path.join(env.MATHECA_TEST_DATA, "library.sqlite"));
  const jobs = [
    {
      id: "import-success",
      type: "import",
      status: "complete",
      labels: ["练习.png"],
      total: 1,
      completed: 1,
    },
    {
      id: "solve-success",
      type: "solution",
      status: "complete",
      questionId: questions[1].id,
      total: 1,
      completed: 1,
    },
    {
      id: "solve-working",
      type: "solution",
      status: "processing",
      questionId: questions[0].id,
      total: 1,
      completed: 0,
    },
    {
      id: "orphan",
      type: "solution",
      status: "complete",
      questionId: "deleted",
      total: 1,
      completed: 1,
    },
    {
      id: "retry",
      type: "solution",
      status: "failed",
      questionId: questions[2].id,
      total: 1,
      completed: 0,
    },
  ];
  for (const [i, job] of jobs.entries())
    db.prepare("INSERT INTO jobs VALUES(?,?,?)").run(
      job.id,
      Date.now() + i,
      JSON.stringify({
        ...job,
        createdAt: String(Date.now() + i),
        message: "隔离任务验证",
      }),
    );
  db.prepare("INSERT INTO pages VALUES(?,?,?,?)").run(
    "import-success",
    0,
    0,
    JSON.stringify({
      complete: true,
      sourcePath: "",
      questionIds: [questions[0].id, questions[1].id, "deleted"],
    }),
  );
  const refresh = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send("state:changed"),
    );
  await refresh();
  const tasks = () =>
    page
      .locator(".sidebar")
      .getByRole("button", { name: "任务", exact: true })
      .click();
  await tasks();
  const imported = page.locator('[data-job-id="import-success"]');
  await imported.locator("summary").click();
  assert.equal(await imported.locator("ol button").count(), 2);
  assert.equal(
    await page.locator('[data-job-id="orphan"] .task-result-button').count(),
    0,
  );
  await page.screenshot({ path: path.join(output, "task-results.png") });
  await imported.locator("ol button").first().click();
  const body = page.getByRole("textbox", { name: "题干与小题", exact: true });
  await body.waitFor();
  assert.equal(await body.inputValue(), questions[0].body);
  const progress = page.locator(".solution-task-progress .lattice-loader");
  assert.equal(await progress.getAttribute("data-status"), "working");
  const generate = page.getByRole("button", {
    name: "生成 / 重试",
    exact: true,
  });
  assert.ok(await generate.isDisabled());
  await progress.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "solution-working.png") });
  const working = JSON.parse(
    db.prepare("SELECT data FROM jobs WHERE id=?").get("solve-working").data,
  );
  working.status = "failed";
  db.prepare("UPDATE jobs SET data=? WHERE id=?").run(
    JSON.stringify(working),
    working.id,
  );
  await refresh();
  await page.waitForFunction(
    () =>
      document.querySelector(".solution-task-progress .lattice-loader")?.dataset
        .status === "error",
  );
  assert.ok(await generate.isEnabled());
  const style = (locator) =>
    locator.evaluate((el) => {
      const s = getComputedStyle(el);
      return [
        s.height,
        s.padding,
        s.border,
        s.borderRadius,
        s.backgroundColor,
        s.color,
        s.fontSize,
      ];
    });
  const generationStyle = await style(generate);
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await tasks();
  assert.deepEqual(
    await style(page.locator('[data-job-id="retry"] .generation-button')),
    generationStyle,
  );
  await page
    .locator('[data-job-id="solve-success"]')
    .getByRole("button", { name: "查看题目", exact: true })
    .click();
  await body.waitFor();
  assert.equal(await body.inputValue(), questions[1].body);
  assert.equal(await progress.getAttribute("data-status"), "done");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: import results, deleted result exclusion, successful solution link, working/error/done progress, duplicate generation disabled, shared retry style. " +
      output,
  );
} finally {
  db?.close();
  await app.close();
}
