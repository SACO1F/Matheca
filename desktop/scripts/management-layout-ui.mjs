import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import path from "node:path";
const root = path.resolve("test-output", "management-layout-" + Date.now());
const env = { ...process.env, MATHECA_TEST_DATA: root };
delete env.ELECTRON_RUN_AS_NODE;
let app, db;
try {
  app = await electron.launch({
    executablePath: process.env.MATHECA_EXE,
    env,
    args: [
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
    ],
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("h1").waitFor();
  const nav = (name) =>
    page.locator(".sidebar").getByRole("button", { name, exact: true });
  db = new Database(path.join(root, "library.sqlite"));
  db.prepare(
    "INSERT INTO history(timestamp,title,detail,category,status) VALUES(?,?,?,?,?)",
  ).run(
    Date.now() - 86400000,
    "创建题集",
    "高一数学 · 三角函数专项练习",
    "operation",
    "done",
  );
  const id = await page.evaluate(async () => {
    await window.matheca.examples();
    const q = (await window.matheca.state()).questions[0];
    await window.matheca.saveQuestion({ ...q, knowledge: "函数单调性" });
    await window.matheca.saveCollection({
      id: "layout-paper",
      title: "高一数学阶段检测",
      paperTitle: "高一数学阶段检测",
      createdAt: String(Date.now()),
      examInstructions: "",
      examMinutes: 60,
      totalScore: 100,
    });
    await window.matheca.addQuestions("layout-paper", [q.id]);
    try {
      await window.matheca.addQuestions("missing", [q.id]);
    } catch {}
    return q.id;
  });
  const rows = [
    "processing",
    "solution",
    "partial",
    "complete",
    "paused",
    "queued",
  ].map((status, index) => ({
    id: "layout-" + status,
    type: status === "solution" ? "solution" : "import",
    status: status === "solution" ? "processing" : status,
    createdAt: String(Date.now() - index * 1000),
    message:
      status === "complete"
        ? "识别完成，题目已加入题库"
        : status === "partial"
          ? "第 3 页识别失败，可继续重试"
          : "正在处理，已识别内容自动保存",
    completed: status === "complete" ? 3 : 2,
    total: 3,
    labels: [
      "2026—2027学年高一数学第一学期期中阶段质量检测（含图像选项与解答题）.pdf",
    ],
    questionId: id,
  }));
  for (const row of rows) {
    db.prepare("INSERT INTO jobs VALUES (?,?,?)").run(
      row.id,
      Number(row.createdAt),
      JSON.stringify(row),
    );
    if (row.type === "import")
      for (let i = 0; i < 2; i++)
        db.prepare("INSERT INTO pages VALUES (?,?,?,?)").run(
          row.id,
          0,
          i,
          JSON.stringify({
            complete: true,
            sourcePath: "",
            questionIds: ["a", "b"],
          }),
        );
  }
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .webContents.send("state:changed"),
  );
  await nav("知识点").click();
  const knowledge = page.locator(".knowledge-page");
  assert.equal(
    await knowledge.locator(".knowledge-modules button").count(),
    13,
  );
  await knowledge.getByRole("button", { name: /^函数\s/ }).click();
  assert.ok(
    (
      await knowledge
        .locator(".knowledge-point-list li")
        .filter({ hasText: "函数单调性" })
        .innerText()
    ).includes("1 道题"),
  );
  await knowledge.getByRole("button", { name: /^不等式\s/ }).click();
  await knowledge
    .getByRole("button", { name: "添加知识点", exact: true })
    .click();
  await knowledge
    .getByLabel("知识点名称", { exact: true })
    .fill("分段函数的综合应用");
  await knowledge
    .getByRole("combobox", { name: "所属模块", exact: true })
    .click();
  assert.ok(await page.getByText("知识点总类", { exact: true }).isVisible());
  await page.getByRole("option", { name: "函数", exact: true }).click();
  await knowledge
    .getByRole("button", { name: "确认添加", exact: true })
    .click();
  await knowledge
    .locator(".knowledge-point-list li")
    .filter({ hasText: "分段函数的综合应用" })
    .waitFor();
  assert.equal(
    await knowledge.locator(".knowledge-detail-heading h2").innerText(),
    "函数",
  );
  await page.getByRole("button", { name: "关闭通知", exact: true }).click();
  const search = knowledge.getByRole("searchbox", {
    name: "搜索知识点",
    exact: true,
  });
  await search.fill("分段函数");
  assert.equal(await knowledge.locator(".knowledge-point-list li").count(), 1);
  await search.fill("不存在的知识点");
  await knowledge.getByText("没有找到相关知识点", { exact: true }).waitFor();
  await knowledge
    .getByRole("button", { name: "清空搜索", exact: true })
    .click();
  await knowledge.getByRole("button", { name: "收起", exact: true }).click();
  await nav("任务").click();
  await page.getByRole("button", { name: /^待处理/ }).click();
  assert.equal(await page.locator(".job-card").count(), 2);
  await page.getByRole("button", { name: /^已完成/ }).click();
  assert.equal(await page.locator(".job-card").count(), 1);
  await page.getByRole("button", { name: /^全部/ }).click();
  await page
    .locator('[data-job-id="layout-processing"] .lattice-loader')
    .waitFor();
  assert.ok(
    await page
      .locator('[data-job-id="layout-processing"] .lattice-loader__cell')
      .first()
      .evaluate((el) => el.getAnimations().length > 0),
  );
  await nav("历史记录").click();
  await page.locator(".history-day").first().waitFor();
  assert.equal(await page.locator(".history-day").count(), 2);
  const hSearch = page.getByRole("searchbox", {
    name: "搜索历史记录",
    exact: true,
  });
  await hSearch.fill("阶段检测");
  await page.waitForTimeout(400);
  assert.ok(
    (
      await page.locator(".history-page .history-description").allTextContents()
    ).every((s) => s.includes("阶段检测")),
  );
  await hSearch.fill("");
  await page.waitForTimeout(400);
  // Batch the three page captures at both supported window sizes.
  for (const [label, width, height] of [
    ["desktop", 1440, 960],
    ["minimum", 1024, 700],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, [width, height]) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.isVisible())
          .setSize(width, height),
      [width, height],
    );
    for (const [name, selector, stem] of [
      ["知识点", ".knowledge-page", "knowledge"],
      ["任务", ".tasks-page", "tasks"],
      ["历史记录", ".history-page", "history"],
    ]) {
      await nav(name).click();
      await page.locator(selector).waitFor();
      await page.waitForTimeout(300);
      assert.ok(
        await page
          .locator(selector)
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        name + " has no horizontal overflow",
      );
      await page.screenshot({
        path: `test-output/management-${stem}-${label}.png`,
      });
    }
    await nav("题库").click();
    await page.locator(`[data-question-id="${id}"] .card-review`).click();
    const hold = page.getByRole("button", {
      name: "长按删除此题",
      exact: true,
    });
    await hold.focus();
    await page.keyboard.down("Space");
    await page.waitForTimeout(420);
    const geometry = await hold.evaluate((el) => {
      const feedback = el.querySelector(".hold-feedback");
      const b = el.getBoundingClientRect(),
        f = feedback.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(feedback);
      const text = range.getBoundingClientRect();
      return {
        bx: b.x + b.width / 2,
        by: b.y + b.height / 2,
        tx: text.x + text.width / 2,
        ty: text.y + text.height / 2,
        textHeight: text.height,
        height: b.height,
        whiteSpace: getComputedStyle(feedback).whiteSpace,
        feedbackWidth: f.width,
        width: b.width,
      };
    });
    assert.ok(
      Math.abs(geometry.bx - geometry.tx) < 1 &&
        Math.abs(geometry.by - geometry.ty) < 2,
      "hold feedback text centered",
    );
    assert.equal(geometry.whiteSpace, "nowrap");
    assert.ok(geometry.textHeight < geometry.height);
    await page.screenshot({ path: `test-output/management-hold-${label}.png` });
    await page.keyboard.up("Space");
    assert.ok(await page.locator(".editor").isVisible());
    await page
      .getByRole("button", { name: "关闭题目校对", exact: true })
      .click();
    await page.locator(".editor").waitFor({ state: "hidden" });
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: knowledge modules/counts/add/search/empty states, task filters and retained animation, dated history and search, centered hold feedback and cancellation, normal/minimum window layout. Isolated data: " +
      root,
  );
} finally {
  db?.close();
  await app?.close();
}
