import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const output = path.resolve("test-output", `classification-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
const exe = fs
  .readFileSync("releases/latest.txt", "utf8")
  .match(/^EXE: (.+)$/m)[1]
  .trim();
const env = { ...process.env, MATHECA_TEST_DATA: path.join(output, "data") };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: exe, env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("h1").waitFor();
  const filter = page.getByRole("combobox", { name: "知识点", exact: true });
  await filter.click();
  assert.equal(
    await page
      .getByRole("listbox", { name: "知识点", exact: true })
      .getByRole("option")
      .count(),
    1,
  );
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    await window.matheca.examples();
    const state = await window.matheca.state();
    for (const question of state.questions)
      await window.matheca.deleteQuestion(question.id);
    await window.matheca.addKnowledge({
      group: "函数",
      name: "已使用自定义点",
    });
    await window.matheca.addKnowledge({
      group: "函数",
      name: "未使用自定义点",
    });
    await window.matheca.saveQuestion({
      ...state.questions[0],
      id: "classification-one",
      title: "分类校对验证",
      body: "求函数的定义域。",
      knowledge: "函数单调性、已使用自定义点",
    });
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send("state:changed"),
  );
  await page.locator(".question-card").waitFor();
  await filter.click();
  const list = page.getByRole("listbox", { name: "知识点", exact: true });
  assert.deepEqual(await list.getByRole("option").allTextContents(), [
    "全部知识点✓",
    "函数单调性",
    "已使用自定义点",
  ]);
  await page.keyboard.press("Escape");
  await page.locator(".question-card").first().click();
  const editor = page.locator(".editor");
  await editor.waitFor();
  assert.equal(
    await editor.locator(".editor-classification select").count(),
    0,
  );
  const fields = ["题目年级", "题目题型", "题目难度", "添加知识点"];
  const styles = [];
  await page.mouse.move(30, 30);
  for (const name of fields) {
    const control = editor.getByRole("combobox", { name, exact: true });
    await control.scrollIntoViewIfNeeded();
    styles.push(
      await control.evaluate((element) => {
        const s = getComputedStyle(element);
        return [
          s.height,
          s.fontSize,
          s.borderRadius,
          s.padding,
          s.backgroundColor,
          s.borderColor,
          s.color,
        ];
      }),
    );
  }
  for (const style of styles) assert.deepEqual(style, styles[0]);
  for (const [name, value] of [
    ["题目年级", "高三"],
    ["题目题型", "证明题"],
    ["题目难度", "挑战"],
  ]) {
    await editor.getByRole("combobox", { name, exact: true }).click();
    await page
      .getByRole("listbox", { name, exact: true })
      .getByRole("option", { name: value, exact: true })
      .click();
  }
  await editor
    .getByRole("combobox", { name: "添加知识点", exact: true })
    .click();
  const assignment = page.getByRole("listbox", {
    name: "添加知识点",
    exact: true,
  });
  assert.equal(
    await assignment
      .getByRole("option", { name: "集合的概念", exact: true })
      .count(),
    1,
  );
  await assignment
    .getByRole("option", { name: "未使用自定义点", exact: true })
    .click();
  await page.waitForTimeout(240);
  await page.screenshot({ path: path.join(output, "editor.png") });
  await page.getByRole("button", { name: "确认已校对", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  const saved = await page.evaluate(
    async () => (await window.matheca.state()).questions[0],
  );
  assert.equal(saved.grade, "高三");
  assert.equal(saved.kind, "证明题");
  assert.equal(saved.difficulty, "挑战");
  assert.ok(saved.knowledge.includes("未使用自定义点"));
  await filter.click();
  await list
    .getByRole("option", { name: "未使用自定义点", exact: true })
    .click();
  await page.locator(".question-card").waitFor();
  await page.evaluate(() =>
    window.matheca.deleteQuestion("classification-one"),
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send("state:changed"),
  );
  await page.waitForFunction(() =>
    document
      .querySelector('[role="combobox"][aria-label="知识点"]')
      ?.textContent?.includes("知识点"),
  );
  await filter.click();
  assert.equal(await list.getByRole("option").count(), 1);
  await page.keyboard.press("Escape");
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "知识点", exact: true })
    .click();
  await page.getByRole("searchbox", { name: "搜索知识点" }).fill("集合的概念");
  assert.ok(await page.getByText("集合的概念", { exact: true }).count());
  await page.screenshot({
    path: path.join(output, "knowledge-empty-library.png"),
  });
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, "RESULT.md"),
    `PASS: final EXE, isolated data; empty/used-only filter; complete assignment catalogue; custom points; all four editor dropdowns share styling; selections persist; deleted points clear filters; knowledge module retains unused catalogue.\nEXE: ${exe}\n`,
  );
  console.log(`PASS: ${output}`);
} finally {
  await app.close();
}
