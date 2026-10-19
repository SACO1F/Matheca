import { _electron as electron } from "playwright";
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert/strict";
const root = path.resolve("test-output", "fab-scroll-" + Date.now());
fs.mkdirSync(root, { recursive: true });
const env = { ...process.env, MATHECA_TEST_DATA: path.join(root, "appdata") };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.MATHECA_EXE,
  env,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("h1").waitFor();
  await page.evaluate(async () => {
    await window.matheca.examples();
    const base = (await window.matheca.state()).questions[0];
    const ids = [];
    for (let i = 0; i < 12; i++) {
      const q = await window.matheca.saveQuestion(
        {
          ...base,
          id: "fab-" + i,
          body: base.body.repeat((i % 3) + 1),
          autoSolve: false,
        },
        true,
      );
      ids.push(q.id);
    }
    await window.matheca.saveCollection({
      id: "fab-paper",
      title: "悬浮按钮滚动验证",
      createdAt: String(Date.now()),
      paperTitle: "",
      examInstructions: "",
      examMinutes: 0,
      totalScore: 0,
    });
    await window.matheca.addQuestions("fab-paper", ids);
  });
  await page.waitForFunction(
    () => document.querySelectorAll(".question-card").length === 15,
  );
  const client = await page.context().newCDPSession(page);
  async function check(selector, name, width, height) {
    const scroll = page.locator(selector);
    // Window resize can start the existing 400ms masonry transition, which
    // owns scrollTop while it plays. Check the settled end-of-list geometry.
    await page.waitForTimeout(500);
    await page.waitForFunction(
      () => !document.querySelector('.masonry-grid[data-moving="true"]'),
    );
    await scroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.waitForTimeout(300);
    const geometry = await page.evaluate((selector) => {
      const scroll = document.querySelector(selector),
        fab = document.querySelector(".fab"),
        workspace = document.querySelector(".workspace");
      const card = [...scroll.querySelectorAll(".question-card")].at(-1);
      const last = card.getBoundingClientRect(),
        button = fab.getBoundingClientRect(),
        pane = scroll.getBoundingClientRect();
      const actions = card
        .querySelector(".card-actions")
        .getBoundingClientRect();
      const hit = document.elementFromPoint(
        actions.x + actions.width / 2,
        actions.y + actions.height / 2,
      );
      return {
        gap: button.top - last.bottom,
        padding: parseFloat(getComputedStyle(scroll).paddingBottom),
        workspacePadding: getComputedStyle(workspace).paddingBottom,
        remaining: scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop,
        extendsBehind: pane.bottom > button.top,
        hit: card.contains(hit),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    }, selector);
    assert.equal(geometry.workspacePadding, "0px");
    assert.ok(
      geometry.padding >= 128 && geometry.remaining <= 1,
      `${name}: ${JSON.stringify(geometry)}`,
    );
    assert.ok(
      geometry.extendsBehind,
      "content uses the original full-height layout",
    );
    assert.ok(
      geometry.gap >= 8,
      `${name}: last card clears floating button: ${JSON.stringify(geometry)}`,
    );
    assert.ok(geometry.hit && !geometry.overflow);
    await page.screenshot({
      path: path.join(root, `${name}-${width}-${height}.png`),
    });
  }
  for (const [width, height] of [
    [1440, 940],
    [1024, 700],
  ]) {
    await client.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.locator('.sidebar button[aria-label="题库"]').click();
    await check(".cards", "library", width, height);
    await page.locator('.sidebar button[aria-label="题集"]').click();
    await page
      .locator(".collection-card")
      .filter({ hasText: "悬浮按钮滚动验证" })
      .click();
    await check(".collection-question-list", "collection", width, height);
    const before = await page.locator(".collection-settings").boundingBox();
    await page.getByRole("button", { name: "从题库添加", exact: true }).click();
    await page
      .getByRole("dialog", { name: "从题库添加", exact: true })
      .waitFor();
    assert.deepEqual(
      await page.locator(".collection-settings").boundingBox(),
      before,
    );
    await page
      .getByRole("button", { name: "关闭题库选择", exact: true })
      .click();
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: restored floating FAB, no reserved workspace lane, extra end scrolling clears last library/collection actions, stable picker columns, normal/minimum layouts. Data: " +
      root,
  );
} finally {
  await app.close();
}
