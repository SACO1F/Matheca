import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
const env = {
  ...process.env,
  MATHECA_TEST_DATA: path.resolve("test-output", "workflow-" + Date.now()),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.MATHECA_EXE,
  args: [
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
  ],
  env,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("h1").waitFor();
  await page.evaluate(async () => {
    await window.matheca.examples();
    await window.matheca.addKnowledge({
      group: "函数",
      name: "跳转验证知识点",
    });
    const state = await window.matheca.state();
    await window.matheca.saveQuestion({
      ...state.questions[0],
      id: "jump-target",
      knowledge: "跳转验证知识点",
      body: "知识点筛选目标",
    });
  });
  await page.waitForFunction(
    () => document.querySelectorAll(".question-card").length === 4,
  );
  const card = page
    .locator('.question-card:not([data-question-id="jump-target"])')
    .first();
  const id = await card.getAttribute("data-question-id");
  await card.locator(".card-add-collection").click();
  const join = page.getByRole("dialog", { name: "加入题集", exact: true });
  await join.getByLabel("新题集名称", { exact: true }).fill("加入流程验证");
  await page.screenshot({ path: "test-output/join-collection-dialog.png" });
  await join.getByRole("button", { name: "创建并加入", exact: true }).click();
  await join.waitFor({ state: "hidden" });
  const membership = await page.evaluate(async (id) => {
    const state = await window.matheca.state();
    const collection = state.collections.find(
      (c) => c.title === "加入流程验证",
    );
    return state.items.filter(
      (item) => item.collectionId === collection.id && item.questionId === id,
    ).length;
  }, id);
  assert.equal(membership, 1);
  await card.locator(".card-add-collection").click();
  await join.getByRole("button", { name: "加入流程验证", exact: true }).click();
  await join.waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(
      async (id) =>
        (await window.matheca.state()).items.filter(
          (item) => item.questionId === id,
        ).length,
      id,
    ),
    1,
  );
  await card.locator(".card-review").click();
  await page.waitForTimeout(600);
  const body = page.locator('.editor textarea[aria-label="题干与小题"]');
  const text = (await body.inputValue()) + "\n切换取消验证";
  await body.fill(text);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "题集", exact: true })
    .click();
  const choosePoint = async () => {
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "题库", exact: true })
      .hover();
    await page.locator(".knowledge-reveal.hover-preview").waitFor();
    const group = page.getByRole("treeitem", { name: "函数", exact: true });
    if ((await group.getAttribute("aria-expanded")) === "false")
      await group.click();
    await page
      .getByRole("treeitem", { name: "跳转验证知识点", exact: true })
      .click();
  };
  await choosePoint();
  const confirm = page.getByRole("dialog", {
    name: "保存当前题目？",
    exact: true,
  });
  await confirm.waitFor();
  assert.equal(await page.locator("h1").textContent(), "题库");
  assert.equal(await body.inputValue(), text);
  assert.equal(
    await page
      .locator(".editor-reveal")
      .evaluate((el) => getComputedStyle(el).opacity),
    "1",
    "original proofreading is fully visible before confirmation",
  );
  assert.equal(
    await page.locator(".question-card").count(),
    4,
    "filter is not applied before confirmation",
  );
  await page.screenshot({ path: "test-output/knowledge-switch-confirm.png" });
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  assert.ok(await page.locator(".editor").isVisible());
  const savedText = text + "\n切换保存验证";
  await body.fill(savedText);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "题集", exact: true })
    .click();
  await choosePoint();
  await confirm
    .getByRole("button", { name: "保存并切换", exact: true })
    .click();
  await page.waitForFunction(() => !document.querySelector(".editor"));
  assert.equal(await page.locator(".question-card").count(), 1);
  assert.equal(
    await page.locator(".question-card").getAttribute("data-question-id"),
    "jump-target",
  );
  assert.equal(
    await page.evaluate(
      async (id) =>
        (await window.matheca.state()).questions.find((q) => q.id === id)
          .body,
      id,
    ),
    savedText,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: create-and-add, existing collection deduplication, active proofreading return, cancel keeps editor, save applies knowledge filter without reopening editor.",
  );
} finally {
  await app.close();
}
