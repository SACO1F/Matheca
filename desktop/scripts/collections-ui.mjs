import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
const env = {
  ...process.env,
  MATHECA_TEST_DATA: path.resolve("test-output", "collections-" + Date.now()),
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
  await page.locator('.sidebar button[aria-label="题集"]').click();
  const createInList = page.locator(".collection-list .collection-create");
  await createInList.waitFor();
  assert.equal(
    await page.locator(".top-actions .collection-create").count(),
    0,
  );
  assert.equal(
    await page
      .locator(".top-actions")
      .getByRole("button", { name: /创建题集/ })
      .count(),
    0,
  );
  assert.ok(
    await page.locator(".collection-list").isVisible(),
    "empty library retains first-column create entry",
  );
  await createInList.click();
  await page
    .getByRole("textbox", { name: "题集名称", exact: true })
    .fill("左栏创建验证");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).collections.length,
    0,
  );
  await page.screenshot({ path: "test-output/collections-create-empty.png" });
  await page.locator('.sidebar button[aria-label="题库"]').click();
  const fixture = await page.evaluate(async () => {
    await window.matheca.examples();
    const state = await window.matheca.state();
    await window.matheca.saveQuestion({
      ...state.questions[0],
      reviewed: false,
    });
    const collection = {
      id: "three-column-fixture",
      createdAt: Date.now().toString(),
      title: "三列布局验证",
      paperTitle: "数学练习",
      examMinutes: 60,
      totalScore: 100,
      examInstructions: "请认真作答。",
    };
    await window.matheca.saveCollection(collection);
    const ids = state.questions.map((q) => q.id);
    await window.matheca.addQuestions(collection.id, ids);
    return { ids, id: collection.id };
  });
  const nav = (label) =>
    page.locator(".sidebar").getByRole("button", { name: label, exact: true });
  await page.locator(".question-card").first().click();
  await page.waitForTimeout(600);
  const body = page.locator('.editor textarea[aria-label="题干与小题"]');
  const original = await body.inputValue();
  await body.fill(original + "\n返回校对验证");
  await nav("题集").click();
  // Start observing before navigation commits, so the first library frame is checked.
  await page.evaluate(() => {
    window.returnFrames = [];
    window.watchReturn = true;
    const sample = () => {
      if (!window.watchReturn) return;
      const el = document.querySelector(".editor-reveal.open");
      if (document.querySelector("h1")?.textContent === "题库")
        window.returnFrames.push(el ? getComputedStyle(el).opacity : "missing");
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await nav("题库").click();
  await page.waitForTimeout(700);
  const frames = await page.evaluate(() => {
    window.watchReturn = false;
    return window.returnFrames;
  });
  assert.ok(frames.length > 2);
  assert.ok(
    frames.every((v) => v === "1"),
    JSON.stringify(frames),
  );
  assert.equal(await body.inputValue(), original + "\n返回校对验证");
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.waitForTimeout(650);
  assert.equal(await page.locator(".editor").count(), 0);
  await nav("题集").click();
  await page
    .locator(".collection-card")
    .filter({ hasText: "三列布局验证" })
    .click();
  const columns = await Promise.all(
    [".collection-list", ".collection-settings", ".collection-detail"].map(
      (s) => page.locator(s).boundingBox(),
    ),
  );
  assert.ok(columns[0].x + columns[0].width <= columns[1].x);
  assert.ok(columns[1].x + columns[1].width <= columns[2].x);
  const cards = page.locator(".collection-question-list .question-card");
  assert.equal(await cards.count(), fixture.ids.length);
  const reviewState = await page.evaluate(() => window.matheca.state());
  for (let index = 0; index < (await cards.count()); index++) {
    const id = await cards.nth(index).getAttribute("data-question-id");
    const question = reviewState.questions.find((q) => q.id === id);
    assert.equal(
      await cards.nth(index).locator(".card-review").textContent(),
      question.reviewed ? "修改" : "校对",
    );
  }
  assert.equal(
    await page
      .locator(".collection-question-list .question-card.active")
      .count(),
    0,
    "library selection does not highlight collection cards",
  );
  assert.equal(await cards.first().locator(".card-add-collection").count(), 0);
  assert.ok(
    await cards
      .first()
      .getByRole("button", { name: "上移", exact: true })
      .isDisabled(),
  );
  assert.ok(
    await cards
      .last()
      .getByRole("button", { name: "下移", exact: true })
      .isDisabled(),
  );
  const ids = () =>
    cards.evaluateAll((els) => els.map((el) => el.dataset.questionId));
  const before = await ids();
  await cards
    .first()
    .getByRole("button", { name: "下移", exact: true })
    .click();
  await page.waitForFunction(
    (id) =>
      document.querySelector(".collection-question-list .question-card")
        ?.dataset.questionId === id,
    before[1],
  );
  await cards.nth(1).getByRole("button", { name: "上移", exact: true }).click();
  await page.waitForFunction(
    (id) =>
      document.querySelector(".collection-question-list .question-card")
        ?.dataset.questionId === id,
    before[0],
  );
  await page.screenshot({ path: "test-output/collections-three-columns.png" });
  assert.equal(await cards.first().locator(".card-top button").count(), 0);
  assert.ok((await cards.first().locator(".card-top .tag").count()) >= 2);
  await cards.first().locator(".card-preview").click();
  await cards.first().locator(".card-top .tag").first().click();
  await cards.first().dispatchEvent("keydown", { key: "Enter" });
  assert.equal(await page.locator("h1").textContent(), "题集");
  assert.equal(await page.locator(".editor").count(), 0);
  const scrollBefore = await page
    .locator(".collection-question-list")
    .evaluate((el) => {
      el.scrollTop = 80;
      return el.scrollTop;
    });
  await page.evaluate(() => {
    window.reviewFrames = [];
    window.sampleReviewFrames = true;
    const sample = () => {
      if (!window.sampleReviewFrames) return;
      if (document.querySelector("h1")?.textContent === "题库") {
        const editor = document.querySelector(".editor-reveal.open");
        const style = editor && getComputedStyle(editor);
        window.reviewFrames.push({
          visible: !!editor && Number(style.opacity) >= 0.99,
          clip: style?.clipPath,
        });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await cards.first().locator(".card-review").click();
  await page.locator(".editor").waitFor();
  assert.equal(await page.locator("h1").textContent(), "题库");
  await page.waitForTimeout(600);
  const reviewedBody = page.locator(
    '.editor textarea[aria-label="题干与小题"]',
  );
  const updatedBody = (await reviewedBody.inputValue()) + "\n题集校对返回验证";
  await reviewedBody.fill(updatedBody);
  await page.getByRole("button", { name: "确认已校对", exact: true }).click();
  await page.waitForFunction(
    async (id) =>
      (await window.matheca.state()).questions.find((q) => q.id === id)
        ?.reviewed,
    before[0],
  );
  await page.waitForFunction(
    () => document.querySelector("h1")?.textContent === "题集",
  );
  await page.waitForTimeout(600);
  assert.equal(await page.locator(".editor").count(), 0);
  const reviewFrames = await page.evaluate(() => {
    window.sampleReviewFrames = false;
    return window.reviewFrames;
  });
  assert.ok(reviewFrames.length > 0);
  assert.ok(
    reviewFrames.every((frame) => frame.visible && frame.clip === "none"),
    "collection review round-trip never exposes the library between frames",
  );
  assert.ok(
    await page
      .locator(".collection-card.active")
      .filter({ hasText: "三列布局验证" })
      .isVisible(),
  );
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).questions.find(
      (q) => q.id === before[0],
    ).body,
    updatedBody,
  );
  // Focus returns to the originating review button without scrolling the list.
  assert.ok(
    await cards
      .first()
      .locator(".card-review")
      .evaluate((el) => document.activeElement === el),
  );
  const scrollAfter = await page
    .locator(".collection-question-list")
    .evaluate((el) => el.scrollTop);
  assert.ok(Math.abs(scrollAfter - scrollBefore) < 2);
  assert.equal(
    await cards.first().locator(".card-review").textContent(),
    "修改",
  );
  await cards.nth(1).locator(".card-preview").click();
  assert.equal(
    await page
      .locator(".collection-question-list .question-card.active")
      .getAttribute("data-question-id"),
    before[1],
  );
  assert.equal(await cards.first().getAttribute("aria-current"), null);
  assert.equal(await page.locator(".editor").count(), 0);
  await cards.nth(2).locator(".card-top .tag").first().click();
  assert.equal(
    await page
      .locator(".collection-question-list .question-card.active")
      .getAttribute("data-question-id"),
    before[2],
  );
  await cards.first().focus();
  await cards.first().press("Enter");
  assert.equal(
    await page
      .locator(".collection-question-list .question-card.active")
      .getAttribute("data-question-id"),
    before[0],
  );
  assert.equal(await page.locator(".editor").count(), 0);
  await page.screenshot({ path: "test-output/collection-review-return.png" });
  await cards
    .first()
    .getByRole("button", { name: /^修改题目 / })
    .click();
  await page.locator(".editor").waitFor();
  assert.equal(await reviewedBody.inputValue(), updatedBody);
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("h1")?.textContent === "题集",
  );
  await page.getByRole("button", { name: "从题库添加", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "从题库添加", exact: true });
  await picker.getByRole("tab", { name: /已选题目/ }).click();
  const pickerCard = picker.locator(".question-card").first();
  assert.equal(await pickerCard.locator(".card-top button").count(), 0);
  await pickerCard.locator(".card-preview").click();
  assert.equal(await page.locator("h1").textContent(), "题集");
  await picker.getByRole("button", { name: "完成添加", exact: true }).click();
  await picker.waitFor({ state: "hidden" });
  await cards
    .first()
    .getByRole("button", { name: "从题集中删去", exact: true })
    .press("Space", { delay: 1400 });
  await page.waitForFunction(
    (n) =>
      document.querySelectorAll(".collection-question-list .question-card")
        .length === n,
    before.length - 1,
  );
  const state = await page.evaluate(() => window.matheca.state());
  assert.ok(state.questions.some((q) => q.id === before[0]));
  assert.ok(
    !state.items.some(
      (i) => i.collectionId === fixture.id && i.questionId === before[0],
    ),
  );
  await page.getByLabel("试卷主标题", { exact: true }).fill("设置保存验证");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).collections.find(
      (c) => c.id === fixture.id,
    ).paperTitle,
    "设置保存验证",
  );
  await nav("题库").click();
  await page.locator(".question-card").first().locator(".card-review").click();
  await page.locator(".editor").waitFor();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.waitForTimeout(600);
  assert.equal(
    await page.locator("h1").textContent(),
    "题库",
    "library-origin review still closes to library",
  );
  await nav("题集").click();
  const bw = await app.browserWindow(page);
  await bw.evaluate((win) => win.setSize(900, 640));
  await page.waitForTimeout(350);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "test-output/collections-three-columns-minimum.png",
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: status-based review/modify labels, saved review becomes modify, modify reopens saved content, independent collection selection by card/tag/keyboard, no library flash on round-trip, three columns, reorder, removal, settings persistence, minimum window.",
  );
} finally {
  await app.close();
}
