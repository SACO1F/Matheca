import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";

const env = {
  ...process.env,
  MATHECA_TEST_DATA: path.resolve("test-output", "hold-" + Date.now()),
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
  const ids = await page.evaluate(async () => {
    await window.matheca.examples();
    const base = (await window.matheca.state()).questions[0];
    await window.matheca.saveQuestion({
      ...base,
      id: "pending-review-fixture",
      title: "待校对验证",
    });
    const ids = (await window.matheca.state()).questions.map((q) => q.id);
    for (const id of ["hold-first", "hold-second"]) {
      await window.matheca.saveCollection({
        id,
        title: id,
        createdAt: Date.now().toString(),
        paperTitle: "长按验证",
        examMinutes: 60,
        totalScore: 100,
        examInstructions: "",
      });
      await window.matheca.addQuestions(id, ids);
    }
    return ids;
  });
  const nav = (name) =>
    page.locator(".sidebar").getByRole("button", { name, exact: true });
  const state = () => page.evaluate(() => window.matheca.state());
  const card = page.locator(".question-card").first();
  const deletion = card.getByRole("button", {
    name: "从题库中长按删除",
    exact: true,
  });
  await deletion.waitFor();
  const heights = await card
    .locator(".card-actions button")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height),
    );
  assert.ok(heights.length >= 3 && heights.every((height) => height === 30));
  const fonts = await card
    .locator(".card-actions button")
    .evaluateAll((buttons) =>
      buttons.map((button) => getComputedStyle(button).fontSize),
    );
  assert.deepEqual(fonts, ["12px", "12px", "12px"]);
  const shapes = await card
    .locator(".card-actions button")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const style = getComputedStyle(button);
        return {
          radius: style.borderRadius,
          padding: style.padding,
          border: style.borderTopWidth,
          line: style.lineHeight,
        };
      }),
    );
  assert.deepEqual(
    shapes,
    Array(3).fill({
      radius: "8px",
      padding: "0px 10px",
      border: "1px",
      line: "16px",
    }),
  );
  const beforeReview = await state();
  for (const question of beforeReview.questions) {
    assert.equal(
      await page
        .locator(
          `.question-card[data-question-id="${question.id}"] .card-review`,
        )
        .textContent(),
      question.reviewed ? "修改" : "校对",
    );
  }
  const pending = page.locator(
    '.question-card[data-question-id="pending-review-fixture"]',
  );
  assert.equal(await pending.locator(".card-review").textContent(), "校对");
  await pending.locator(".card-review").click();
  await page.locator(".editor").waitFor();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "确认已校对", exact: true }).click();
  await page.waitForFunction(
    async () =>
      (await window.matheca.state()).questions.find(
        (q) => q.id === "pending-review-fixture",
      )?.reviewed,
  );
  await page.waitForTimeout(650);
  assert.equal(await pending.locator(".card-review").textContent(), "修改");
  await pending.locator(".card-review").click();
  await page.locator(".editor").waitFor();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.waitForTimeout(650);
  assert.ok(
    await deletion.evaluate((button) =>
      button.nextElementSibling?.textContent.includes("加入题集"),
    ),
  );
  await deletion.click();
  assert.equal((await state()).questions.length, ids.length);
  assert.equal(await page.locator(".editor").count(), 0);
  const box = await deletion.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(500);
  const progress = await deletion.evaluate((button) =>
    Number(button.style.getPropertyValue("--hold-progress")),
  );
  assert.ok(progress > 0.2 && progress < 0.8);
  await page.screenshot({ path: "test-output/hold-button-progress.png" });
  await page.mouse.up();
  await page.waitForTimeout(800);
  assert.equal((await state()).questions.length, ids.length);
  assert.equal(
    await deletion.evaluate((button) =>
      button.style.getPropertyValue("--hold-progress"),
    ),
    "0",
  );
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.move(box.x - 10, box.y - 10);
  await page.waitForTimeout(1300);
  await page.mouse.up();
  assert.equal(
    (await state()).questions.length,
    ids.length,
    "moving outside cancels captured pointer hold",
  );
  await deletion.focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1300);
  await page.keyboard.up("Space");
  assert.equal(
    (await state()).questions.length,
    ids.length,
    "Escape cancels keyboard hold",
  );
  await page.keyboard.down("Enter");
  await page.waitForTimeout(150);
  await deletion.evaluate((button) => button.blur());
  await page.waitForTimeout(1300);
  await page.keyboard.up("Enter");
  assert.equal(
    (await state()).questions.length,
    ids.length,
    "focus loss cancels hold",
  );
  await nav("题集").click();
  await page
    .locator(".collection-card")
    .filter({ hasText: "hold-first" })
    .click();
  const selectedCard = page
    .locator(".collection-question-list .question-card")
    .first();
  const removedId = await selectedCard.getAttribute("data-question-id");
  const remove = selectedCard.getByRole("button", {
    name: "从题集中删去",
    exact: true,
  });
  await remove.click();
  assert.equal(
    (await state()).items.filter((item) => item.collectionId === "hold-first")
      .length,
    ids.length,
  );
  await remove.press("Space", { delay: 1400 });
  await page.waitForFunction(
    async (id) =>
      !(await window.matheca.state()).items.some(
        (item) => item.collectionId === "hold-first" && item.questionId === id,
      ),
    removedId,
  );
  const afterRemove = await state();
  assert.equal(afterRemove.questions.length, ids.length);
  assert.ok(
    afterRemove.items.some(
      (item) =>
        item.collectionId === "hold-second" && item.questionId === removedId,
    ),
  );
  await page.screenshot({ path: "test-output/hold-button-collection.png" });
  await nav("题库").click();
  const libraryCard = page.locator(".question-card[data-question-id]").first();
  await libraryCard.waitFor();
  await page.waitForTimeout(450);
  const deletedId = await libraryCard.getAttribute("data-question-id");
  assert.ok(
    deletedId,
    "library card has a stable question ID after navigation",
  );
  const deleteButton = libraryCard.getByRole("button", {
    name: "从题库中长按删除",
    exact: true,
  });
  const target = await deleteButton.boundingBox();
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2,
  );
  await page.mouse.down();
  await page.waitForTimeout(1450);
  await page.mouse.up();
  await page.waitForFunction(
    async (id) =>
      !(await window.matheca.state()).questions.some((q) => q.id === id),
    deletedId,
  );
  assert.equal(
    (await state()).questions.length,
    ids.length - 1,
    "one hold deletes exactly one question",
  );
  assert.equal(await page.locator(".editor").count(), 0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedButton = page.locator(".library-remove").first();
  assert.equal(
    await reducedButton
      .locator(".hold-label")
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
  );
  await reducedButton.press("Space", { delay: 200 });
  assert.equal(
    (await state()).questions.length,
    ids.length - 1,
    "reduced motion preserves the confirmation duration",
  );
  const bw = await app.browserWindow(page);
  await bw.evaluate((win) => win.setSize(900, 640));
  await page.waitForTimeout(350);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: "test-output/hold-button-minimum.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: all library actions 30px, delete precedes add, progress fill, short press/release/move/Escape/focus cancellation, keyboard collection removal preserves library and other collections, pointer library deletion exactly once, reduced motion, minimum window.",
  );
} finally {
  await app.close();
}
