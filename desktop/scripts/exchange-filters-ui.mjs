import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const output = path.resolve("test-output", "exchange-filters-" + Date.now());
fs.mkdirSync(output, { recursive: true });
const exe = fs
  .readFileSync("releases/latest.txt", "utf8")
  .match(/^EXE: (.+)$/m)[1]
  .trim();
const env = { ...process.env, MATHECA_TEST_DATA: path.join(output, "data") };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: exe, env });
let page;
try {
  page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("h1").waitFor();
  await page.evaluate(async () => {
    await window.matheca.examples();
    const state = await window.matheca.state();
    const sample = state.questions[0];
    for (const q of state.questions) await window.matheca.deleteQuestion(q.id);
    await window.matheca.addKnowledge({
      group: "函数",
      name: "联动筛选验证点",
    });
    const fixtures = [
      {
        id: "filter-a",
        title: "高一基础选择",
        grade: "高一",
        difficulty: "基础",
        kind: "选择题",
        knowledge: "函数单调性、联动筛选验证点",
      },
      {
        id: "filter-b",
        title: "高二进阶计算",
        grade: "高二",
        difficulty: "进阶",
        kind: "计算题",
        knowledge: "等差数列",
      },
      {
        id: "filter-c",
        title: "高一进阶证明",
        grade: "高一",
        difficulty: "进阶",
        kind: "证明题",
        knowledge: "函数单调性",
      },
      {
        id: "filter-d",
        title: "高三挑战填空",
        grade: "高三",
        difficulty: "挑战",
        kind: "填空题",
        knowledge: "导数与极值最值",
      },
    ];
    for (const fixture of fixtures)
      await window.matheca.saveQuestion({
        ...sample,
        ...fixture,
        body: "已知函数 f(x)=x²，讨论性质并说明理由。",
      });
    await window.matheca.saveCollection({
      id: "filter-collection",
      title: "联动筛选验证题集",
      createdAt: "1",
      paperTitle: "",
      examInstructions: "",
      examMinutes: 0,
      totalScore: 0,
    });
    await window.matheca.addQuestions("filter-collection", ["filter-a"]);
  });
  await page.getByRole("button", { name: "新建题目", exact: true }).click();
  await page.getByRole("menuitem", { name: "手机联动", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "手机联动", exact: true });
  await dialog.getByRole("tab", { name: "题库交换", exact: true }).click();
  const sets = dialog.locator(".exchange-select");
  const collections = sets.nth(0),
    questions = sets.nth(1);
  async function animation(section) {
    await section.scrollIntoViewIfNeeded();
    const sample = await section.evaluate(async (el) => {
      const summary = el.querySelector("summary");
      const height = () => el.getBoundingClientRect().height;
      const before = height();
      summary.click();
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      const active =
        parseFloat(
          getComputedStyle(el, "::details-content").transitionDuration,
        ) > 0;
      await new Promise((r) => setTimeout(r, 65));
      const middle = height();
      await new Promise((r) => setTimeout(r, 300));
      const after = height();
      return { before, middle, after, active, open: el.open };
    });
    assert.ok(
      sample.active,
      "native expansion transition must be running: " + JSON.stringify(sample),
    );
    assert.ok(
      sample.middle > Math.min(sample.before, sample.after) &&
        sample.middle < Math.max(sample.before, sample.after),
      JSON.stringify(sample),
    );
    return sample;
  }
  const motion = [];
  motion.push(await animation(collections));
  motion.push(await animation(collections));
  motion.push(await animation(collections));
  await dialog.getByLabel("联动筛选验证题集", { exact: true }).check();
  motion.push(await animation(questions));
  async function pick(label, value) {
    const trigger = questions.getByRole("combobox", {
      name: label,
      exact: true,
    });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const listbox = dialog.getByRole("listbox", { name: label, exact: true });
    await listbox.waitFor();
    const menu = await listbox.boundingBox(),
      bounds = await dialog.boundingBox();
    assert.ok(
      menu.x >= bounds.x && menu.x + menu.width <= bounds.x + bounds.width + 1,
    );
    await listbox.getByRole("option", { name: value, exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".glide-menu").length === 0,
    );
  }
  const ids = () =>
    questions
      .locator(".exchange-question")
      .evaluateAll((es) => es.map((e) => e.dataset.questionId).sort());
  assert.deepEqual(await ids(), [
    "filter-a",
    "filter-b",
    "filter-c",
    "filter-d",
  ]);
  await dialog.getByLabel("高一基础选择", { exact: true }).check();
  await pick("年级", "高一");
  assert.deepEqual(await ids(), ["filter-a", "filter-c"]);
  await pick("难度", "进阶");
  assert.deepEqual(await ids(), ["filter-c"]);
  await pick("知识点", "函数单调性");
  assert.deepEqual(await ids(), ["filter-c"]);
  await pick("题型", "选择题");
  assert.equal((await ids()).length, 0);
  await questions.getByText("没有符合条件的题目，请调整或清除筛选。").waitFor();
  assert.match(
    await dialog.locator(".exchange-send-footer").innerText(),
    /已选 1 道题 · 1 个题集/,
  );
  await questions
    .getByRole("button", { name: "清除筛选", exact: true })
    .click();
  assert.deepEqual(await ids(), [
    "filter-a",
    "filter-b",
    "filter-c",
    "filter-d",
  ]);
  await dialog
    .getByLabel("高一基础选择", { exact: true })
    .isChecked()
    .then((v) => assert.ok(v));
  await pick("知识点", "联动筛选验证点");
  assert.deepEqual(await ids(), ["filter-a"]);
  await page.screenshot({ path: path.join(output, "filters-wide.png") });
  await questions
    .getByRole("button", { name: "清除筛选", exact: true })
    .click();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1024, 720),
  );
  await pick("年级", "高二");
  assert.deepEqual(await ids(), ["filter-b"]);
  await questions
    .getByRole("combobox", { name: "知识点", exact: true })
    .click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll(".glide-menu.open")).some(
      (el) => getComputedStyle(el).opacity === "1",
    ),
  );
  await page.screenshot({ path: path.join(output, "knowledge-compact.png") });
  await page.keyboard.press("Escape");
  assert.ok(await dialog.isVisible());
  await questions
    .getByRole("button", { name: "清除筛选", exact: true })
    .click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.ok(
    await questions.evaluate(
      (el) =>
        parseFloat(
          getComputedStyle(el, "::details-content").transitionDuration,
        ) <= 0.001,
    ),
  );
  await questions.locator("summary").focus();
  await page.keyboard.press("Space");
  assert.equal(await questions.getAttribute("open"), null);
  await page.keyboard.press("Space");
  assert.notEqual(await questions.getAttribute("open"), null);
  assert.match(
    await dialog.locator(".exchange-send-footer").innerText(),
    /已选 1 道题 · 1 个题集/,
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, "RESULT.md"),
    `PASS: final portable EXE, isolated data, combined grade/difficulty/knowledge/kind filters, custom knowledge, empty/reset, hidden selection retained, visible modal menus, native open/close transitions, keyboard, compact and reduced motion.\n${JSON.stringify(motion, null, 2)}\nEXE: ${exe}\n`,
  );
  console.log("PASS: " + output);
} catch (error) {
  if (page)
    await page
      .screenshot({ path: path.join(output, "failure.png") })
      .catch(() => {});
  throw error;
} finally {
  await app.close();
}
