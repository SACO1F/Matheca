import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
const env = {
  ...process.env,
  MATHECA_TEST_DATA: path.resolve("test-output", "history-" + Date.now()),
};
delete env.ELECTRON_RUN_AS_NODE;
const launch = () =>
  electron.launch({
    executablePath: process.env.MATHECA_EXE,
    args: [
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
    ],
    env,
  });
let app = await launch();
try {
  let page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("h1").waitFor();
  const initial = await page.evaluate(() => window.matheca.historyList());
  assert.equal(
    initial.total,
    0,
    "opening the application does not create history",
  );
  await page.evaluate(() => window.matheca.recordHistory("进入历史记录"));
  await page.evaluate(() => window.matheca.historyList());
  assert.equal(
    (await page.evaluate(() => window.matheca.historyList())).total,
    initial.total,
    "reading history does not create more history",
  );
  const fixture = await page.evaluate(async () => {
    await window.matheca.examples();
    const q = (await window.matheca.state()).questions[0];
    await window.matheca.saveQuestion({ ...q, favorite: !q.favorite });
    await window.matheca.saveCollection({
      id: "history-paper",
      title: "历史记录验证卷",
      createdAt: Date.now().toString(),
      paperTitle: "数学",
      examMinutes: 60,
      totalScore: 100,
      examInstructions: "",
    });
    await window.matheca.addQuestions("history-paper", [q.id]);
    await window.matheca.removeQuestion("history-paper", q.id);
    await window.matheca.saveQuestion({ ...q, favorite: !q.favorite }, true);
    try {
      await window.matheca.addQuestions("missing-collection", [q.id]);
    } catch {}
    try {
      await window.matheca.saveSettings({
        address: "secret-address",
        model: "model",
        theme: "LIGHT",
        autoSolveImports: false,
        apiKey: "secret-token",
        clearApiKey: "invalid",
      });
    } catch {}
    return q.id;
  });
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true });
  });
  await page.evaluate(() => window.matheca.exportBackup());
  let entries = await page.evaluate(() => window.matheca.historyList());
  assert.ok(
    entries.records.some(
      (entry) =>
        entry.title === "创建题集" && entry.detail === "历史记录验证卷",
    ),
  );
  assert.ok(
    entries.records.some((entry) => entry.title === "从题集中移除题目"),
  );
  assert.ok(entries.records.some((entry) => entry.title === "确认题目已校对"));
  assert.ok(
    entries.records.some(
      (entry) => entry.title === "加入题集" && entry.status === "failed",
    ),
  );
  assert.ok(
    entries.records.some(
      (entry) => entry.title === "备份题库" && entry.status === "cancelled",
    ),
  );
  assert.ok(
    !JSON.stringify(entries).includes("secret-token") &&
      !JSON.stringify(entries).includes("secret-address"),
  );
  assert.ok(!entries.records.some((entry) => entry.title === "保存设置"));
  const countBeforeNavigation = entries.total;
  await page.locator(".question-card").first().locator(".card-review").click();
  await page.locator(".editor").waitFor();
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.waitForTimeout(650);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "历史记录", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector("h1")?.textContent === "历史记录",
  );
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "题库", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector("h1")?.textContent === "题库",
  );
  assert.equal(
    (await page.evaluate(() => window.matheca.historyList())).total,
    countBeforeNavigation,
    "navigation, selecting and closing a clean question do not create history",
  );
  await page.getByRole("button", { name: "搜索题目", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索题干、公式或知识点", exact: true })
    .fill("函数");
  await page.waitForTimeout(500);
  entries = await page.evaluate(() => window.matheca.historyList());
  assert.ok(
    !entries.records.some((entry) =>
      /进入|点击：|选中题目|关闭题目校对|打开题目校对/.test(entry.title),
    ),
  );
  assert.ok(
    entries.records.some(
      (entry) => entry.title === "筛选题库" && entry.detail.includes("函数"),
    ),
  );
  await page
    .getByRole("textbox", { name: "搜索题干、公式或知识点", exact: true })
    .fill("");
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    for (let i = 0; i < 5; i++)
      await window.matheca.saveCollection({
        id: "recent-paper-" + i,
        title: "最近步骤 " + i,
        createdAt: Date.now().toString(),
        paperTitle: "历史验证",
        examMinutes: 60,
        totalScore: 100,
        examInstructions: "",
      });
  });
  const trigger = page.getByRole("button", { name: "历史步骤", exact: true });
  const recent = page.getByRole("region", {
    name: "最近五次操作",
    exact: true,
  });
  await trigger.hover();
  await recent.locator("li").first().waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector("#recent-operation-history li p")?.textContent ===
      "最近步骤 4",
  );
  assert.deepEqual(
    await recent.locator("li p").allTextContents(),
    [4, 3, 2, 1, 0].map((i) => "最近步骤 " + i),
  );
  await page.waitForTimeout(200);
  await page.screenshot({ path: "test-output/history-recent.png" });
  await recent.hover();
  await page.waitForTimeout(300);
  assert.ok(
    await recent.isVisible(),
    "pointer can move from trigger to popover",
  );
  await page.mouse.move(600, 700);
  await recent.waitFor({ state: "hidden" });
  await trigger.click();
  await page.mouse.move(600, 700);
  await page.waitForTimeout(300);
  assert.ok(
    await recent.isVisible(),
    "clicked history stays open after pointer leaves",
  );
  await page.keyboard.press("Escape");
  await recent.waitFor({ state: "hidden" });
  assert.ok(
    await trigger.evaluate((button) => document.activeElement === button),
  );
  await trigger.press("Enter");
  await recent.waitFor();
  await recent
    .getByRole("button", { name: "查看全部历史记录", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector("h1")?.textContent === "历史记录",
  );
  const history = page.getByRole("region", { name: "操作历史", exact: true });
  await history.locator("li").first().waitFor();
  await page.screenshot({ path: "test-output/history-page.png" });
  await page.evaluate(async () => {
    for (let i = 0; i < 125; i++)
      await window.matheca.saveCollection({
        id: "page-paper-" + i,
        title: "分页持久化步骤 " + i,
        createdAt: Date.now().toString(),
        paperTitle: "分页验证",
        examMinutes: 60,
        totalScore: 100,
        examInstructions: "",
      });
  });
  const search = history.getByRole("searchbox", {
    name: "搜索历史记录",
    exact: true,
  });
  await search.fill("分页持久化步骤");
  await page.waitForFunction(() =>
    document.querySelector(".history-toolbar p")?.textContent.includes("125"),
  );
  assert.equal(await history.locator("li").count(), 100);
  await history.getByRole("button", { name: "下一页", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".history-page li").length === 25,
  );
  await page.waitForTimeout(200);
  assert.equal(
    await history.locator("li p").first().textContent(),
    "分页持久化步骤 24",
  );
  await search.fill("没有此历史内容");
  await history.getByText("没有匹配的历史记录", { exact: true }).waitFor();
  await search.fill("");
  await history.locator("li").first().waitFor();
  const bw = await app.browserWindow(page);
  await bw.evaluate((win) => win.setSize(900, 640));
  await page.waitForTimeout(350);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await trigger.hover();
  await recent.waitFor();
  const bounds = await recent.boundingBox();
  assert.ok(
    bounds.x >= 0 &&
      bounds.x + bounds.width <= (await page.evaluate(() => innerWidth)),
  );
  await page.waitForTimeout(200);
  await page.screenshot({ path: "test-output/history-minimum.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await recent.evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  assert.deepEqual(errors, []);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.locator("h1").waitFor();
  assert.equal(
    (
      await page.evaluate(() =>
        window.matheca.historyList(100, 0, "分页持久化步骤"),
      )
    ).total,
    125,
  );
  assert.ok(
    (await page.evaluate(() => window.matheca.state())).questions.some(
      (q) => q.id === fixture,
    ),
  );
  console.log(
    "PASS: focused question/collection audit, no navigation/click/selection/app/settings noise, failed/canceled operations, query history, exact recent five, hover/click/keyboard, search/pagination, narrow window, reduced motion, persistence after EXE restart.",
  );
} finally {
  await app.close();
}
