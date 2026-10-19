import { _electron as electron } from "playwright";
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import path from "node:path";

const root = path.resolve("test-output", "lattice-" + Date.now());
const env = { ...process.env, MATHECA_TEST_DATA: root };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.MATHECA_EXE,
  args: [
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
  ],
  env,
});
let db;
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("h1").waitFor();
  await page.evaluate(() => window.matheca.examples());
  const question = (await page.evaluate(() => window.matheca.state()))
    .questions[0];
  db = new Database(path.join(root, "library.sqlite"));
  const rows = [
    "processing",
    "complete",
    "failed",
    "partial",
    "queued",
    "paused",
  ].map((status, i) => ({
    id: "lattice-" + status,
    status,
    type: "import",
    createdAt: String(Date.now() - i * 1000),
    message: {
      processing: "正在识别第 2 页，已识别内容已保存",
      complete: "识别完成，题目已加入题库",
      failed: "接口暂时不可用，请检查设置后重试",
      partial: "2 页识别成功，1 页失败，可以继续重试",
      queued: "等待识别",
      paused: "任务已停止，点击继续",
    }[status],
    completed: status === "complete" ? 3 : 2,
    total: 3,
    labels: ["高一数学期中试卷.pdf", "补充题目截图.png"],
  }));
  rows.push({
    ...rows[0],
    id: "lattice-solution",
    type: "solution",
    createdAt: String(Date.now() - 7000),
    message: "正在生成解题步骤",
    questionId: question.id,
  });
  const put = (j) =>
    db
      .prepare(
        "INSERT INTO jobs VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET createdAt=excluded.createdAt,data=excluded.data",
      )
      .run(j.id, Number(j.createdAt), JSON.stringify(j));
  rows.forEach(put);
  const putPage = (jobId, fileOrdinal, pageOrdinal, data) =>
    db
      .prepare("INSERT OR REPLACE INTO pages VALUES (?,?,?,?)")
      .run(jobId, fileOrdinal, pageOrdinal, JSON.stringify(data));
  for (const row of rows.filter((j) => j.type === "import")) {
    putPage(row.id, 0, 0, {
      complete: true,
      sourcePath: "",
      questionIds: ["first", "second"],
    });
    putPage(row.id, 0, 1, {
      complete: true,
      sourcePath: "",
      questionIds: ["third"],
    });
    putPage(row.id, 1, 0, {
      complete: row.status === "complete",
      sourcePath: "",
      questionIds: row.status === "complete" ? ["fourth"] : [],
      error: "截图读取失败",
    });
  }
  const refresh = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.isVisible())
        .webContents.send("state:changed"),
    );
  await refresh();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "任务", exact: true })
    .click();
  const card = (status) => page.locator(`[data-job-id="lattice-${status}"]`);
  const loader = (status) => card(status).locator(".lattice-loader");
  await loader("processing").waitFor();
  await page.waitForTimeout(400);
  assert.ok(
    (await card("processing").innerText()).includes("高一数学期中试卷.pdf"),
  );
  assert.ok((await card("processing").innerText()).includes("已识别 3 道题"));
  assert.ok((await card("complete").innerText()).includes("已识别 4 道题"));
  assert.ok(
    (await card("partial").innerText()).includes("0 页已识别 · 0 道题"),
  );
  const publicJob = (
    await page.evaluate(() => window.matheca.state())
  ).jobs.find((j) => j.id === "lattice-processing");
  assert.equal(publicJob.paths, undefined);
  assert.equal(publicJob.labels, undefined);
  assert.equal(publicJob.recognizedCount, 3);
  assert.equal(
    await loader("processing").getAttribute("data-status"),
    "working",
  );
  assert.ok((await loader("processing").innerText()).includes("正在识别"));
  assert.equal(await loader("complete").getAttribute("data-status"), "done");
  for (const status of ["failed", "partial"])
    assert.equal(await loader(status).getAttribute("data-status"), "error");
  for (const status of ["queued", "paused"]) {
    assert.equal(await loader(status).getAttribute("data-status"), "idle");
    assert.equal(
      await loader(status)
        .locator(".lattice-loader__run .lattice-loader__cell")
        .first()
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
  }
  assert.equal(
    await loader("complete").locator(".lattice-loader__mark [data-on]").count(),
    4,
  );
  assert.equal(
    await loader("failed").locator(".lattice-loader__mark [data-on]").count(),
    5,
  );
  assert.equal(
    await loader("processing").locator(".lattice-loader__timer").count(),
    0,
  );
  assert.ok(
    await loader("processing")
      .locator(".lattice-loader__run .lattice-loader__cell")
      .first()
      .evaluate((el) =>
        el.getAnimations().some((a) => a.playState === "running"),
      ),
  );
  await page.screenshot({ path: "test-output/task-details-desktop.png" });
  // Update the same persisted task and verify the loader survives the transition.
  const original = await loader("processing").elementHandle();
  put({
    ...rows[0],
    status: "complete",
    completed: 3,
    message: "识别完成，题目已加入题库",
  });
  await refresh();
  await page.waitForFunction(
    () =>
      document.querySelector(
        '[data-job-id="lattice-processing"] .lattice-loader',
      ).dataset.status === "done",
  );
  assert.ok(await original.evaluate((el) => el.isConnected));
  assert.equal(
    await card("processing")
      .getByRole("button", { name: "停止", exact: true })
      .count(),
    0,
  );
  put(rows[0]);
  await refresh();
  await card("processing")
    .getByRole("button", { name: "停止", exact: true })
    .click();
  await card("processing")
    .getByRole("button", { name: "继续 / 重试", exact: true })
    .waitFor();
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).jobs.find(
      (j) => j.id === rows[0].id,
    ).status,
    "paused",
  );
  assert.equal(await loader("processing").getAttribute("data-status"), "idle");
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).jobs.find(
      (j) => j.id === rows[0].id,
    ).recognizedCount,
    3,
  );
  put(rows[0]);
  await refresh();
  await page.waitForTimeout(250);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1024, 700),
  );
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-output/task-details-minimum.png" });
  assert.ok(
    await page
      .locator(".task-list")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  );
  await card("solution").scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  assert.ok((await loader("solution").innerText()).includes("正在解题"));
  assert.ok(
    (await card("solution").locator(".job-question-preview").innerText())
      .length > 0,
  );
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).jobs.find(
      (j) => j.id === "lattice-solution",
    ).questionPreview,
    question.body,
  );
  assert.equal(
    await loader("processing").getAttribute("data-animate"),
    "false",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: "test-output/task-solution-minimum.png" });
  assert.equal(
    await loader("solution")
      .locator(".lattice-loader__run .lattice-loader__cell")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  assert.deepEqual(errors, []);
  // A real task creation saves its subject, even when no AI endpoint is configured.
  await page.evaluate((id) => window.matheca.solveQuestion(id), question.id);
  await page.waitForTimeout(300);
  const snapshotJob = (
    await page.evaluate(() => window.matheca.state())
  ).jobs.find((j) => j.type === "solution" && j.id !== "lattice-solution");
  assert.equal(snapshotJob.questionPreview, question.body);
  await page.evaluate(async ({ id }) => {
    const q = (await window.matheca.state()).questions.find(
      (q) => q.id === id,
    );
    await window.matheca.saveQuestion({
      ...q,
      body: "题干后来修改，任务仍保留原题",
    });
    await window.matheca.deleteQuestion(id);
  }, question);
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).jobs.find(
      (j) => j.id === snapshotJob.id,
    ).questionPreview,
    question.body,
  );
  console.log(
    "PASS: packaged EXE, source filenames and per-file/total question counts, legacy solution subject fallback, real solution task snapshot preserved after question edit/deletion, processing/done/error/partial/queued/paused states, live transition, stop action, minimum window, offscreen pause, reduced motion; isolated test data.",
  );
} finally {
  db?.close();
  await app.close();
}
