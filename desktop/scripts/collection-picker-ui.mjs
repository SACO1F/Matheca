import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
const env = {
  ...process.env,
  MATHECA_TEST_DATA: path.resolve("test-output", "picker-" + Date.now()),
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
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("h1").waitFor();
  const fixture = await page.evaluate(async () => {
    await window.matheca.examples();
    await window.matheca.addKnowledge({
      group: "函数",
      name: "分组自定义知识点",
    });
    const state = await window.matheca.state();
    await window.matheca.saveCollection({
      id: "picker-target",
      createdAt: Date.now().toString(),
      title: "添加题目验证",
      paperTitle: "数学练习",
      examMinutes: 60,
      totalScore: 100,
      examInstructions: "请认真作答。",
    });
    return {
      ids: state.questions.map((q) => q.id),
      grade: state.questions[0].grade,
    };
  });
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "题集", exact: true })
    .click();
  await page
    .locator(".collection-card")
    .filter({ hasText: "添加题目验证" })
    .click();
  const settings = page.locator(".collection-settings");
  const save = settings.getByRole("button", { name: "保存设置", exact: true });
  const pdf = settings.getByRole("button", { name: "导出 PDF", exact: true });
  const word = settings.getByRole("button", { name: "导出 Word", exact: true });
  const del = settings.getByRole("button", {
    name: "长按删除题集",
    exact: true,
  });
  const rects = await Promise.all(
    [save, pdf, word, del].map((el) => el.boundingBox()),
  );
  assert.equal(rects[0].height, 36);
  assert.equal(rects[1].height, 36);
  assert.equal(rects[2].height, 36);
  assert.equal(rects[3].height, 30);
  assert.equal(rects[1].y, rects[2].y);
  assert.ok(Math.abs(rects[1].width - rects[2].width) < 1);
  assert.ok(rects[3].y > rects[2].y + rects[2].height);
  assert.ok(await pdf.isDisabled());
  const trigger = page.getByRole("button", { name: "从题库添加", exact: true });
  assert.deepEqual(
    await trigger.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        color: style.color,
        background: style.backgroundColor,
        height: el.getBoundingClientRect().height,
        icon: !!el.querySelector("svg"),
      };
    }),
    {
      color: "rgb(255, 255, 255)",
      background: "rgb(37, 37, 37)",
      height: 36,
      icon: true,
    },
  );
  const before = await Promise.all(
    [".collection-list", ".collection-settings", ".collection-detail"].map(
      (sel) => page.locator(sel).boundingBox(),
    ),
  );
  await trigger.click();
  const picker = page.getByRole("dialog", { name: "从题库添加", exact: true });
  await picker.waitFor();
  await page.waitForTimeout(300);
  assert.equal(await page.locator("h1").textContent(), "题集");
  assert.equal(await page.locator(".editor").count(), 0);
  const bounds = await picker.boundingBox();
  const parent = await page.locator(".collection-detail").boundingBox();
  assert.ok(bounds.x >= parent.x && bounds.y >= parent.y);
  assert.ok(bounds.x + bounds.width <= parent.x + parent.width + 1);
  assert.ok(bounds.y + bounds.height <= parent.y + parent.height + 1);
  const after = await Promise.all(
    [".collection-list", ".collection-settings"].map((sel) =>
      page.locator(sel).boundingBox(),
    ),
  );
  assert.deepEqual(after, before.slice(0, 2));
  assert.ok(
    await settings.getByLabel("试卷主标题", { exact: true }).isEnabled(),
  );
  const results = picker.locator(".question-card");
  assert.equal(await results.count(), 3);
  assert.equal(await picker.locator(".card-review").count(), 0);
  const first = results.first();
  const firstId = await first.getAttribute("data-question-id");
  await first.getByRole("button", { name: "加入题集", exact: true }).click();
  const remove = first.getByRole("button", {
    name: "从题集中删去",
    exact: true,
  });
  await remove.waitFor();
  const styleOf = (button) =>
    button.evaluate((el) => {
      const style = getComputedStyle(el);
      return [
        style.color,
        style.backgroundColor,
        style.borderColor,
        style.borderRadius,
        style.fontSize,
        style.lineHeight,
        el.getBoundingClientRect().height,
      ];
    });
  await page.mouse.move(650, 50);
  await page.waitForTimeout(180);
  assert.deepEqual(
    await styleOf(del),
    await styleOf(remove),
    "both destructive actions share one rest style",
  );
  await del.hover();
  await page.waitForTimeout(180);
  const deleteHover = await styleOf(del);
  await remove.hover();
  await page.waitForTimeout(180);
  assert.deepEqual(
    await styleOf(remove),
    deleteHover,
    "both destructive actions share one hover style",
  );
  await del.focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(240);
  assert.equal(
    await del.evaluate((el) => getComputedStyle(el).color),
    "rgb(255, 255, 255)",
  );
  await page.keyboard.up("Space");
  assert.ok(
    (await page.evaluate(() => window.matheca.state())).collections.some(
      (c) => c.id === "picker-target",
    ),
    "cancelled hold preserves collection",
  );
  await first
    .getByRole("button", { name: "从题集中删去", exact: true })
    .waitFor();
  assert.ok(
    await first
      .getByRole("button", { name: "从题集中删去", exact: true })
      .isEnabled(),
  );
  await first
    .getByRole("button", { name: "从题集中删去", exact: true })
    .press("Space", { delay: 1400 });
  await first.getByRole("button", { name: "加入题集", exact: true }).waitFor();
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).items.length,
    0,
  );
  await first.getByRole("button", { name: "加入题集", exact: true }).click();
  await first
    .getByRole("button", { name: "从题集中删去", exact: true })
    .waitFor();
  await first.click();
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).items.filter(
      (i) => i.collectionId === "picker-target" && i.questionId === firstId,
    ).length,
    1,
  );
  assert.equal(await page.locator("h1").textContent(), "题集");
  await picker
    .getByRole("button", { name: "查看已选题目", exact: true })
    .click();
  assert.equal(await results.count(), 1);
  assert.equal(await results.first().getAttribute("data-question-id"), firstId);
  await page.screenshot({ path: "test-output/collection-picker-selected.png" });
  await results
    .first()
    .getByRole("button", { name: "从题集中删去", exact: true })
    .press("Space", { delay: 1400 });
  await picker.getByText("尚未加入题目", { exact: true }).waitFor();
  await picker.getByRole("tab", { name: "题库", exact: true }).click();
  await first.getByRole("button", { name: "加入题集", exact: true }).click();
  await first
    .getByRole("button", { name: "从题集中删去", exact: true })
    .waitFor();
  const search = picker.getByRole("searchbox", { name: "搜索添加题目" });
  await search.fill("不存在的搜索条件");
  await picker.getByText("没有符合条件的题目", { exact: true }).waitFor();
  await picker.getByRole("button", { name: "重置筛选", exact: true }).click();
  assert.equal(await results.count(), 3);
  const knowledge = picker.getByRole("combobox", {
    name: "知识点",
    exact: true,
  });
  await knowledge.click();
  const knowledgeMenu = page.getByRole("listbox", {
    name: "知识点",
    exact: true,
  });
  const group = knowledgeMenu.getByRole("group", { name: "函数", exact: true });
  assert.equal(
    await group
      .getByRole("option", { name: "分组自定义知识点", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await knowledgeMenu
      .getByRole("option", { name: "函数", exact: true })
      .count(),
    0,
  );
  await knowledge.press("ArrowDown");
  await page.waitForTimeout(250);
  const highlight = await knowledgeMenu
    .locator(".glide-highlight")
    .boundingBox();
  const option = await knowledgeMenu.locator('[data-index="1"]').boundingBox();
  assert.ok(Math.abs(highlight.y - option.y) < 1);
  await page.screenshot({ path: "test-output/knowledge-dropdown-grouped.png" });
  await group.getByRole("option", { name: "函数单调性", exact: true }).click();
  assert.equal(await results.count(), 1);
  await picker.getByRole("tab", { name: /已选题目/ }).click();
  assert.equal(
    await results.count(),
    1,
    "selected review is independent of library filters",
  );
  await picker.getByRole("tab", { name: "题库", exact: true }).click();
  await picker.getByRole("button", { name: "重置筛选", exact: true }).click();
  await picker.getByRole("combobox", { name: "年级", exact: true }).click();
  const menu = page.getByRole("listbox", { name: "年级", exact: true });
  await menu.waitFor();
  const mr = await menu.boundingBox();
  assert.ok(mr.x >= bounds.x && mr.x + mr.width <= bounds.x + bounds.width);
  assert.ok(mr.y >= bounds.y && mr.y + mr.height <= bounds.y + bounds.height);
  await page.keyboard.press("Escape");
  assert.ok(await picker.isVisible());
  await picker.getByRole("combobox", { name: "年级", exact: true }).click();
  await page.getByRole("option", { name: fixture.grade, exact: true }).click();
  assert.equal(await page.locator("h1").textContent(), "题集");
  await picker.getByRole("button", { name: "重置筛选", exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: "test-output/collection-library-picker.png" });
  await picker.getByRole("button", { name: "完成添加", exact: true }).click();
  await picker.waitFor({ state: "hidden" });
  assert.ok(await trigger.evaluate((el) => document.activeElement === el));
  assert.equal(
    await page.locator(".collection-question-list .question-card").count(),
    1,
  );
  await settings.getByLabel("试卷主标题", { exact: true }).fill("文档按钮验证");
  await save.click();
  await page.waitForTimeout(150);
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).collections[0]
      .paperTitle,
    "文档按钮验证",
  );
  await app.evaluate(({ dialog }, folder) => {
    dialog.showSaveDialog = async (_win, options) => ({
      canceled: false,
      filePath: folder + "/" + options.defaultPath,
    });
  }, env.MATHECA_TEST_DATA);
  await pdf.click();
  const exportPreview = page.getByRole("dialog", {
    name: "导出预览",
    exact: true,
  });
  await exportPreview
    .getByRole("button", { name: "确认导出 PDF", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.body.textContent.includes("文档已保存"),
  );
  await word.click();
  await exportPreview
    .getByRole("button", { name: "确认导出 Word", exact: true })
    .click();
  await exportPreview.waitFor({ state: "hidden" });
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".paper-export-actions button")].every(
      (button) => !button.disabled,
    ),
  );
  assert.ok(
    fs
      .readdirSync(env.MATHECA_TEST_DATA)
      .some((name) => name.endsWith(".pdf")),
  );
  assert.ok(
    fs
      .readdirSync(env.MATHECA_TEST_DATA)
      .some((name) => name.endsWith(".docx")),
  );
  await page.screenshot({
    path: "test-output/collection-document-actions.png",
  });
  const bw = await app.browserWindow(page);
  await bw.evaluate((win) => win.setSize(900, 640));
  await page.waitForTimeout(300);
  await trigger.click();
  await page.waitForTimeout(300);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "test-output/collection-library-picker-minimum.png",
  });
  await page.keyboard.press("Escape");
  await picker.waitFor({ state: "hidden" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await trigger.click();
  assert.equal(
    await picker.evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await picker
    .getByRole("button", { name: "关闭题库选择", exact: true })
    .click();
  await picker.waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: local picker boundaries, stable adjacent columns, direct add and deduplication, local search/filter, dropdown bounds/Escape, focus return, document button sizing/alignment, save and PDF/Word export, minimum window, reduced motion.",
  );
} finally {
  await app.close();
}
