import { appTest } from "./tauri-ui-session.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("test-output", `titlebar-${Date.now()}`);
const app = await appTest.launch({
  executablePath: process.env.MATHECA_EXE,
  env: { ...process.env, MATHECA_TEST_DATA: root },
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  assert.equal(await page.title(), "Matheca");
  assert.equal(await page.locator(".migration-preview-notice").count(), 0);
  assert.equal(
    await page.getByText("Tauri 迁移版", { exact: true }).count(),
    0,
  );
  // header is inside the application div, so locate its explicit label directly.
  const titlebar = page.locator(".window-titlebar");
  assert.equal(
    await titlebar.getByRole("group", { name: "窗口控制" }).count(),
    1,
  );
  assert.equal(await titlebar.getAttribute("data-tauri-drag-region"), "");
  await titlebar.getByRole("button", { name: "最大化", exact: true }).click();
  await page.waitForFunction(() => window.mathecaWindow.isMaximized());
  await titlebar.getByRole("button", { name: "还原窗口", exact: true }).click();
  await page.waitForFunction(
    async () => !(await window.mathecaWindow.isMaximized()),
  );
  for (const [width, height, label] of [
    [1440, 960, "wide"],
    [960, 640, "compact"],
  ]) {
    await page.setViewportSize({ width, height });
    const geometry = await page.evaluate(() => {
      const rect = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { top: r.top, height: r.height, left: r.left, right: r.right };
      };
      return {
        bar: rect(".window-titlebar"),
        content: rect(".content-shell"),
        nav: rect(".titlebar-navigation"),
        controls: rect(".window-controls"),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.equal(geometry.bar.top, 0);
    assert.equal(geometry.bar.height, 36);
    assert.ok(geometry.content.top >= 36 && geometry.content.top < 46);
    assert.ok(geometry.nav.right < geometry.controls.left);
    assert.equal(geometry.overflow, false);
    await page.screenshot({ path: `titlebar-${label}.png` });
  }
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "设置与备份", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "复制原版题库", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "导入 Windows 题库", exact: true })
    .scrollIntoViewIfNeeded();
  assert.ok(
    await page
      .getByRole("button", { name: "导出完整题库", exact: true })
      .isVisible(),
  );
  await page.screenshot({ path: "migration-in-settings.png" });
  await titlebar.getByRole("button", { name: "后退", exact: true }).click();
  await page
    .getByRole("heading", { name: "题库", level: 1, exact: true })
    .waitFor();
  await titlebar.getByRole("button", { name: "前进", exact: true }).click();
  await page
    .getByRole("heading", { name: "设置与备份", level: 1, exact: true })
    .waitFor();
  await titlebar.getByRole("button", { name: "关闭窗口", exact: true }).click();
  const closing = page.getByRole("dialog", {
    name: "关闭 Matheca",
    exact: true,
  });
  await closing.waitFor();
  await closing.getByRole("button", { name: "取消", exact: true }).click();
  await closing.waitFor({ state: "detached" });
  if (process.argv.includes("--native")) {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "题库", exact: true })
      .click();
    console.log(`NATIVE TITLEBAR READY: ${root}`);
    const deadline = Date.now() + 240000;
    while (!fs.existsSync(path.join(root, "native-done"))) {
      if (Date.now() > deadline)
        throw Error("Native titlebar validation timed out");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(root, "REPORT.md"),
    `# Titlebar verification\n\nPASS: single 36px title row; no migration banner; native maximize/restore via actual buttons; compact/wide layout; removed legacy copy button; ZIP import/export retained; navigation; close dialog cancellation; renderer errors 0.\n`,
  );
  console.log(`PASS titlebar: ${root}`);
} finally {
  await app.close();
}
