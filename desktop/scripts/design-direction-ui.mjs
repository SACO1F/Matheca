import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const latest = fs
  .readFileSync("releases/latest.txt", "utf8")
  .match(/^EXE: (.+)$/m)[1]
  .trim();
const output = path.resolve("test-output", `design-direction-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env, MATHECA_TEST_DATA: path.join(output, "data") };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.MATHECA_EXE || latest,
  env,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("h1").waitFor();
  await page.evaluate(() => window.matheca.examples());
  // Reload state after seeding through the API.
  await page.reload();
  await page.locator(".question-card").first().waitFor();
  await page.evaluate(async () => {
    const state = await window.matheca.state();
    await window.matheca.saveCollection({
      id: "design-review-paper",
      title: "函数与数列练习",
      createdAt: String(Date.now()),
      paperTitle: "函数与数列练习",
      examInstructions: "请写出必要的解题过程。",
      examMinutes: 45,
      totalScore: 100,
    });
    await window.matheca.addQuestions(
      "design-review-paper",
      state.questions.map((question) => question.id),
    );
  });
  for (const [label, file] of [
    ["题库", "library"],
    ["题集", "collections"],
    ["知识点", "knowledge"],
    ["任务", "tasks"],
    ["历史记录", "history"],
    ["设置与备份", "settings"],
  ]) {
    await page
      .locator(".sidebar")
      .getByRole("button", { name: label, exact: true })
      .click();
    await page.waitForTimeout(350);
    if (label === "题集") {
      await page.getByText("函数与数列练习", { exact: true }).first().click();
      await page.waitForTimeout(350);
    }
    await page.screenshot({ path: path.join(output, `${file}.png`) });
    assert.equal(await page.locator("h1").textContent(), label);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "题库", exact: true })
    .click();
  await page.locator(".card-review").first().click();
  await page.locator(".editor").waitFor();
  await page.waitForFunction(() => {
    const reveal = document.querySelector(".editor-reveal.open");
    return reveal && Number(getComputedStyle(reveal).opacity) >= 0.999;
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(output, "editor.png") });
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.locator(".editor").waitFor({ state: "detached" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1024, 720),
  );
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(output, "library-compact.png") });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(`Design direction validated: ${output}`);
} finally {
  await app.close();
}
