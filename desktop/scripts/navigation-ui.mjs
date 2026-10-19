import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";

const env = {
  ...process.env,
  MATHECA_TEST_DATA: path.resolve("test-output", "navigation-" + Date.now()),
};
delete env.ELECTRON_RUN_AS_NODE;
const launch = () =>
  electron.launch({
    executablePath:
      process.env.MATHECA_EXE ??
      path.resolve("node_modules/electron/dist/electron.exe"),
    args: process.env.MATHECA_EXE
      ? []
      : [path.resolve(".vite/build/main.cjs")],
    env,
  });
for (let restart = 0; restart < 2; restart++) {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.locator("h1").waitFor();
    const back = page.getByRole("button", { name: "后退", exact: true });
    const forward = page.getByRole("button", { name: "前进", exact: true });
    const sidebar = page.locator(".library-sidebar-toggle");
    assert.equal(
      await sidebar.count(),
      1,
      "sidebar toggle is present on fresh launch and restart",
    );
    assert.ok(await back.isDisabled());
    assert.ok(await forward.isDisabled());
    const positions = await Promise.all(
      [back, forward, sidebar].map((el) => el.boundingBox()),
    );
    assert.ok(positions[0].x + positions[0].width <= positions[1].x);
    assert.ok(positions[1].x + positions[1].width <= positions[2].x);
    assert.equal(
      await back.evaluate((el) =>
        getComputedStyle(el).getPropertyValue("-webkit-app-region"),
      ),
      "no-drag",
    );
    await sidebar.click();
    assert.equal(await sidebar.getAttribute("aria-expanded"), "true");
    const navigate = async (name) => {
      await page
        .locator(".sidebar")
        .getByRole("button", { name, exact: true })
        .click();
      await page.waitForFunction(
        (expected) => document.querySelector("h1")?.textContent === expected,
        name,
      );
    };
    await navigate("知识点");
    await navigate("任务");
    await back.click();
    await page.waitForFunction(
      () => document.querySelector("h1")?.textContent === "知识点",
    );
    await back.click();
    await page.waitForFunction(
      () => document.querySelector("h1")?.textContent === "题库",
    );
    assert.ok(await back.isDisabled());
    assert.equal(await sidebar.count(), 1);
    await forward.click();
    await page.waitForFunction(
      () => document.querySelector("h1")?.textContent === "知识点",
    );
    await forward.click();
    await page.waitForFunction(
      () => document.querySelector("h1")?.textContent === "任务",
    );
    assert.ok(await forward.isDisabled());
    await back.click();
    await page.waitForFunction(
      () => document.querySelector("h1")?.textContent === "知识点",
    );
    await navigate("题集");
    assert.ok(
      await forward.isDisabled(),
      "new destination replaces forward history",
    );
    await navigate("题集");
    await back.click();
    await page.waitForFunction(
      () => document.querySelector("h1")?.textContent === "知识点",
    );
    assert.equal(
      await sidebar.count(),
      0,
      "sidebar toggle is limited to library page",
    );
    await navigate("题库");
    await page.mouse.move(650, 350);
    await page.waitForTimeout(350);
    await page.screenshot({ path: "test-output/titlebar-navigation.png" });
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
}
console.log(
  "PASS: launch/restart sidebar toggle, titlebar ordering, back/forward, history boundaries, duplicate destinations and new navigation branch.",
);
