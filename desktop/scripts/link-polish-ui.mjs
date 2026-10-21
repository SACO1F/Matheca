import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const output = path.resolve("test-output", "link-polish-" + Date.now());
fs.mkdirSync(output, { recursive: true });
const exe =
  process.env.MATHECA_EXE ||
  fs
    .readFileSync("releases/latest.txt", "utf8")
    .match(/^EXE: (.+)$/m)[1]
    .trim();
const env = { ...process.env, MATHECA_TEST_DATA: path.join(output, "data") };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const errors = [];
try {
  app = await electron.launch({ executablePath: exe, env });
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("h1").waitFor();
  await page.evaluate(async () => {
    const q = {
      id: "polish-long",
      title: "完整函数综合题",
      body:
        "已知函数 \\(f(x)=x^2-2x\\)。\n" +
        Array.from(
          { length: 10 },
          (_, i) => `（${i + 1}）讨论参数变化时的函数性质，写出推理过程。`,
        ).join("\n") +
        "\n末尾条件 完整末尾条件九：求所有满足条件的实数。",
      latex: "",
      grade: "高一",
      kind: "解答题",
      difficulty: "进阶",
      knowledge: "函数单调性",
      sourcePath: "",
      sourceLabel: "手动录入",
      createdAt: "1",
      reviewed: true,
      favorite: false,
      example: false,
      autoSolve: false,
      solution: "",
      solutionLatex: "",
      solutionFingerprint: "",
      solutionError: "",
    };
    await window.matheca.saveQuestion(q);
    await window.matheca.saveCollection({
      id: "polish-c",
      title: "章节复习 · 函数与数列",
      createdAt: "1",
      paperTitle: "",
      examInstructions: "",
      examMinutes: 0,
      totalScore: 0,
    });
    await window.matheca.addQuestions("polish-c", [q.id]);
  });
  const card = page
    .locator('.question-card[data-question-id="polish-long"]')
    .first();
  await card.waitFor();
  assert.match(await card.innerText(), /完整末尾条件九/);
  assert.ok(
    await card
      .locator(".card-preview")
      .evaluate((e) => e.scrollHeight <= e.clientHeight + 2),
  );
  await page.screenshot({ path: path.join(output, "library-full.png") });
  await page.locator('.sidebar button[aria-label="题集"]').click();
  await page
    .locator(".collection-list .collection-card")
    .filter({ hasText: "章节复习 · 函数与数列" })
    .click();
  const collectionQuestion = page.locator(
    '.collection-question-list .question-card[data-question-id="polish-long"]',
  );
  await collectionQuestion.waitFor();
  assert.match(await collectionQuestion.innerText(), /完整末尾条件九/);
  assert.ok(
    await collectionQuestion
      .locator(".card-preview")
      .evaluate((e) => e.scrollHeight <= e.clientHeight + 2),
  );
  await page.screenshot({ path: path.join(output, "collection-full.png") });
  await page.locator('.sidebar button[aria-label="题库"]').click();
  await page.getByRole("button", { name: "新建题目", exact: true }).click();
  await page.getByRole("menuitem", { name: "手机联动", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "手机联动", exact: true });
  await dialog.getByRole("tab", { name: "题库交换", exact: true }).click();
  await dialog.locator("summary").filter({ hasText: "选择题集" }).click();
  await dialog.getByLabel("章节复习 · 函数与数列", { exact: true }).check();
  await dialog.locator("summary").filter({ hasText: "选择题目" }).click();
  const selectedCard = dialog.locator(
    '.question-card[data-question-id="polish-long"]',
  );
  await selectedCard.scrollIntoViewIfNeeded();
  await dialog.getByLabel("完整函数综合题", { exact: true }).check();
  assert.match(await selectedCard.innerText(), /完整末尾条件九/);
  assert.ok(
    await selectedCard
      .locator(".card-preview")
      .evaluate((e) => e.scrollHeight <= e.clientHeight + 2),
  );
  await page.screenshot({
    path: path.join(output, "desktop-selection-full.png"),
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1024, 700),
  );
  await selectedCard.scrollIntoViewIfNeeded();
  assert.ok(
    await dialog.evaluate(
      (e) =>
        e.getBoundingClientRect().right <= innerWidth &&
        e.getBoundingClientRect().bottom <= innerHeight,
    ),
  );
  await page.screenshot({
    path: path.join(output, "desktop-compact-reduced-motion.png"),
  });
  assert.ok(
    parseFloat(
      await dialog
        .getByRole("tab", { name: "题库交换", exact: true })
        .evaluate((e) => getComputedStyle(e).transitionDuration),
    ) <= 0.001,
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, "RESULT.md"),
    `# Link polish validation\n\nPASS: final EXE, isolated data, full long question in library and exchange; shared collection selection; native checkbox operation; 1024×700 and reduced motion; no console errors.\n\nEXE: ${exe}\n`,
  );
  console.log("PASS: " + output);
} catch (error) {
  if (page)
    await page
      .screenshot({ path: path.join(output, "failure.png") })
      .catch(() => {});
  throw error;
} finally {
  if (app) await app.close();
}
