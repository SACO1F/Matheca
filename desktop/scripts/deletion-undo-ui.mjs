import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
const env = {
  ...process.env,
  MATHECA_TEST_DATA: path.resolve("test-output", "delete-undo-" + Date.now()),
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
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("h1").waitFor();
  const before = await page.evaluate(async () => {
    await window.matheca.examples();
    const initial = await window.matheca.state();
    const q = initial.questions[0];
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 100;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#2967e9";
    ctx.fillRect(0, 0, 200, 100);
    await window.matheca.saveQuestion(
      { ...q, figures: [canvas.toDataURL()], figureWidths: [90] },
      true,
    );
    const ids = initial.questions.map((q) => q.id);
    for (const id of ["undo-one", "undo-two"]) {
      await window.matheca.saveCollection({
        id,
        title: id,
        createdAt: String(Date.now()),
        paperTitle: "恢复试卷标题",
        examMinutes: 90,
        totalScore: 150,
        examInstructions: "保留考试说明",
      });
      await window.matheca.addQuestions(
        id,
        id === "undo-one" ? ids : [...ids].reverse(),
      );
    }
    return window.matheca.state();
  });
  const ids = before.questions.map((q) => q.id),
    state = () => page.evaluate(() => window.matheca.state()),
    nav = (name) =>
      page.locator(".sidebar").getByRole("button", { name, exact: true }),
    toast = page.getByRole("region", { name: "通知", exact: true });
  const undo = async () => {
    await toast.getByRole("button", { name: "撤销", exact: true }).click();
    await page.waitForTimeout(250);
    assert.ok((await toast.innerText()).includes("已撤销删除"));
    await toast.getByRole("button", { name: "关闭通知", exact: true }).click();
    await toast.waitFor({ state: "hidden" });
  };
  const order = (s, id) =>
    s.items
      .filter((i) => i.collectionId === id)
      .sort((a, b) => a.position - b.position)
      .map((i) => i.questionId);
  const library = page
    .locator(`.question-card[data-question-id="${ids[0]}"]`)
    .getByRole("button", { name: "从题库中长按删除", exact: true });
  await library.waitFor();
  await library.press("Space", { delay: 300 });
  assert.equal(await toast.count(), 0);
  await library.press("Space", { delay: 1400 });
  await toast.waitFor();
  await page.waitForTimeout(450);
  await page.screenshot({ path: "test-output/library-delete-undo-toast.png" });
  assert.ok(!(await state()).questions.some((q) => q.id === ids[0]));
  await undo();
  assert.deepEqual(
    (await state()).questions.find((q) => q.id === ids[0]),
    before.questions.find((q) => q.id === ids[0]),
  );
  for (const id of ["undo-one", "undo-two"])
    assert.deepEqual(order(await state(), id), order(before, id));
  await nav("题集").click();
  await page
    .locator(".collection-card")
    .filter({ hasText: "undo-one" })
    .click();
  const item = page
    .locator(`.collection-question-list [data-question-id="${ids[1]}"]`)
    .getByRole("button", { name: "从题集中删去", exact: true });
  await item.press("Space", { delay: 1400 });
  await toast.waitFor();
  await undo();
  assert.deepEqual(order(await state(), "undo-one"), order(before, "undo-one"));
  await page.getByLabel("试卷主标题", { exact: true }).fill("删除前编辑的标题");
  await page
    .getByRole("button", { name: "长按删除题集", exact: true })
    .press("Space", { delay: 1400 });
  await toast.waitFor();
  assert.ok(!(await state()).collections.some((c) => c.id === "undo-one"));
  await undo();
  assert.deepEqual(
    (await state()).collections.find((c) => c.id === "undo-one"),
    {
      ...before.collections.find((c) => c.id === "undo-one"),
      paperTitle: "删除前编辑的标题",
    },
  );
  assert.deepEqual(order(await state(), "undo-one"), order(before, "undo-one"));
  assert.equal(
    await page.getByLabel("试卷主标题", { exact: true }).inputValue(),
    "删除前编辑的标题",
  );
  await page.getByRole("button", { name: "从题库添加", exact: true }).click();
  const picker = page.locator(
    `.collection-picker-results [data-question-id="${ids[2]}"]`,
  );
  await picker
    .getByRole("button", { name: "从题集中删去", exact: true })
    .press("Space", { delay: 1400 });
  await toast.waitFor();
  await undo();
  assert.deepEqual(order(await state(), "undo-one"), order(before, "undo-one"));
  await picker
    .getByRole("button", { name: "从题集中删去", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "关闭题库选择", exact: true }).click();
  // The proofreading delete confirmation uses the same undo path.
  await nav("题库").click();
  await page
    .locator(`.question-card[data-question-id="${ids[0]}"] .card-review`)
    .press("Enter");
  const editedBody =
    before.questions.find((q) => q.id === ids[0]).body + "\n删除前未保存的修改";
  await page.getByLabel("题干与小题", { exact: true }).fill(editedBody);
  await page.getByRole("button", { name: "删除此题", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await toast.waitFor();
  await undo();
  const restoredQuestion = (await state()).questions.find(
    (q) => q.id === ids[0],
  );
  assert.equal(restoredQuestion.body, editedBody);
  assert.deepEqual(
    restoredQuestion.figures,
    before.questions.find((q) => q.id === ids[0]).figures,
  );
  assert.deepEqual(restoredQuestion.figureWidths, [90]);
  // Both knowledge surfaces use the established custom select and visible hierarchy.
  await nav("知识点").click();
  const group = page.getByRole("combobox", { name: "所属模块", exact: true });
  await group.click();
  await page.waitForTimeout(300);
  assert.ok((await group.boundingBox()).width >= 150);
  const groupMenu = page.getByRole("listbox", {
    name: "所属模块",
    exact: true,
  });
  assert.equal(
    await groupMenu.locator(".glide-group-title").textContent(),
    "知识点总类",
  );
  await page.screenshot({ path: "test-output/knowledge-group-glide.png" });
  await groupMenu.getByRole("option", { name: "函数", exact: true }).click();
  await page.locator(".point-form input").fill("撤销验证自定义子知识点");
  await page
    .locator(".point-form")
    .getByRole("button", { name: "添加知识点", exact: true })
    .click();
  assert.ok(
    (await state()).customKnowledge.some(
      (p) => p.group === "函数" && p.name === "撤销验证自定义子知识点",
    ),
  );
  await nav("题库").click();
  await page
    .locator(`.question-card[data-question-id="${ids[0]}"] .card-review`)
    .press("Enter");
  const add = page.getByRole("combobox", { name: "添加知识点", exact: true });
  await page.waitForTimeout(550);
  await add.click();
  await page.waitForTimeout(300);
  assert.ok((await add.boundingBox()).width >= 150);
  const menu = page.getByRole("listbox", { name: "添加知识点", exact: true });
  assert.equal(await menu.locator(".glide-group-title").count(), 13);
  assert.ok(
    await menu.getByRole("group", { name: "集合与逻辑", exact: true }).count(),
  );
  assert.ok(
    await menu
      .getByRole("group", { name: "函数", exact: true })
      .getByRole("option", { name: "撤销验证自定义子知识点", exact: true })
      .count(),
  );
  await page.screenshot({ path: "test-output/knowledge-children-glide.png" });
  await menu.getByRole("option", { name: "集合的概念", exact: true }).click();
  assert.ok(
    await page
      .locator(".editor .tags")
      .getByRole("button", { name: "集合的概念 ×", exact: true })
      .isVisible(),
  );
  await add.click();
  await add.press("Escape");
  assert.equal(await add.getAttribute("aria-expanded"), "false");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1024, 700),
  );
  await add.click();
  await page.waitForTimeout(250);
  const menuBox = await menu.boundingBox();
  assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= 1024);
  await page.screenshot({ path: "test-output/knowledge-glide-minimum.png" });
  await add.press("Escape");
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  assert.ok(
    (await state()).questions
      .find((q) => q.id === ids[0])
      .knowledge.includes("集合的概念"),
  );
  const history = await page.evaluate(() => window.matheca.historyList());
  assert.ok(history.records.some((r) => r.title === "撤销删除"));
  assert.deepEqual(errors, []);
  console.log(
    "PASS: undo restores library question/images and both collection placements, collection settings/order, selected-item and picker removal, proofreading delete; all deletion toasts expose Undo; grouped GlideSelect on knowledge page/editor, custom child points, selection persistence, Escape and minimum window, meaningful history, isolated data.",
  );
} finally {
  await app.close();
}
