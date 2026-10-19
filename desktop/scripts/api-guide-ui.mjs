import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
const env = {
  ...process.env,
  MATHECA_TEST_DATA: path.resolve("test-output", "api-guide-" + Date.now()),
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({
    executablePath: process.env.MATHECA_EXE,
    env,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("h1").waitFor();
  await app.evaluate(async ({ shell, clipboard }) => {
    globalThis.savedGuideClipboard = await clipboard.read();
    globalThis.guideOpened = [];
    shell.openExternal = async (url) => {
      globalThis.guideOpened.push(url);
    };
  });
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "设置与备份", exact: true })
    .click();
  assert.equal(await page.locator(".quick-help li").count(), 6);
  assert.equal(await page.locator(".quick-help button").count(), 0);
  assert.equal(
    await page.getByRole("heading", { name: "桌面录入", exact: true }).count(),
    0,
  );
  await page
    .getByRole("textbox", { name: "API Key", exact: true })
    .fill("test-only-matheca-guide-key");
  const trigger = page.getByRole("button", {
    name: "图文配置教学",
    exact: true,
  });
  await trigger.click();
  const guide = page.getByRole("dialog", {
    name: "DeepSeek 接口图文教学",
    exact: true,
  });
  await guide.waitFor();
  assert.equal(await guide.locator(".api-guide-nav > button").count(), 6);
  assert.ok(
    await guide
      .getByRole("button", { name: "上一步", exact: true })
      .isDisabled(),
  );
  const labels = [
    "打开 DeepSeek",
    "注册或登录",
    "充值 API 余额",
    "创建并复制 API Key",
    "填写接口配置",
    "保存并测试",
  ];
  const urls = [
    "https://platform.deepseek.com/",
    "https://platform.deepseek.com/",
    "https://platform.deepseek.com/balance",
    "https://platform.deepseek.com/api_keys",
    "https://api-docs.deepseek.com/guides/vision/",
    "https://api-docs.deepseek.com/faq/",
  ];
  for (let i = 0; i < 6; i++) {
    await guide.locator(".api-guide-nav > button").nth(i).click();
    assert.equal(
      await guide
        .getByRole("img", { name: labels[i] + "操作示意图", exact: true })
        .count(),
      1,
    );
    assert.ok((await guide.innerText()).includes("操作示意图，非平台实拍"));
    await guide.locator(".guide-platform-link").click();
    assert.equal(
      await app.evaluate(() => globalThis.guideOpened.at(-1)),
      urls[i],
    );
    await page.screenshot({
      path: `test-output/api-guide-step-${i + 1}-desktop.png`,
    });
  }
  await guide.locator(".api-guide-nav > button").nth(4).click();
  await guide.getByRole("button", { name: "复制地址", exact: true }).click();
  assert.equal(
    await app.evaluate(({ clipboard }) => clipboard.readText()),
    "https://api.deepseek.com",
  );
  await guide.getByRole("button", { name: "复制模型名", exact: true }).click();
  assert.equal(
    await app.evaluate(({ clipboard }) => clipboard.readText()),
    "deepseek-flash",
  );
  await guide
    .getByRole("button", { name: "填入地址与模型名", exact: true })
    .click();
  await guide.waitFor({ state: "hidden" });
  assert.equal(
    await page
      .getByRole("textbox", { name: "接口地址", exact: true })
      .inputValue(),
    "https://api.deepseek.com",
  );
  assert.equal(
    await page
      .getByRole("textbox", { name: "模型名", exact: true })
      .inputValue(),
    "deepseek-flash",
  );
  assert.equal(
    await page
      .getByRole("textbox", { name: "API Key", exact: true })
      .inputValue(),
    "test-only-matheca-guide-key",
  );
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).settings.address,
    "",
    "defaults are not silently saved",
  );
  await page.locator(".quick-help").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-output/api-guide-quick-help.png" });
  await trigger.click();
  await guide.waitFor();
  await page.keyboard.press("Escape");
  await guide.waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent),
    "图文配置教学",
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1024, 700),
  );
  await trigger.click();
  await guide.waitFor();
  for (let i = 0; i < 6; i++) {
    await guide.locator(".api-guide-nav > button").nth(i).click();
    await page.waitForTimeout(80);
    assert.ok(
      await guide.evaluate((el) => {
        const b = el.getBoundingClientRect();
        return (
          b.top >= 36 &&
          b.bottom <= innerHeight &&
          b.left >= 0 &&
          b.right <= innerWidth &&
          el.scrollWidth <= el.clientWidth + 1
        );
      }),
    );
    assert.ok(await guide.locator(".api-guide-footer").isVisible());
    await page.screenshot({
      path: `test-output/api-guide-step-${i + 1}-minimum.png`,
    });
  }
  await guide.getByRole("button", { name: "返回设置", exact: true }).click();
  await guide.waitFor({ state: "hidden" });
  await assert.rejects(
    page.evaluate(() => window.matheca.openGuideLink("__proto__")),
    /教学链接无效/,
  );
  await assert.rejects(
    page.evaluate(() => window.matheca.copyGuideValue("not-a-config")),
    /教学配置项无效/,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: independent modal tutorial, six illustrated steps, correct official URLs, address/model clipboard, explicit defaults without saving/overwriting key, concise help, Escape focus return, normal/minimum window, link/copy validation; isolated data and clipboard restored.",
  );
} finally {
  if (app) {
    await app.evaluate(async ({ clipboard, ClipboardItem }) => {
      if (globalThis.savedGuideClipboard) {
        const items = await Promise.all(
          globalThis.savedGuideClipboard.map(async (item) => {
            const data = {};
            for (const type of item.types)
              data[type] = await item.getType(type);
            return new ClipboardItem(data);
          }),
        );
        await clipboard.write(items);
      }
    });
    await app.close();
  }
}
