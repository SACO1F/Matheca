import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const output = path.resolve("test-output", "close-choice-" + Date.now());
fs.mkdirSync(output, { recursive: true });
const exe = fs
  .readFileSync("releases/latest.txt", "utf8")
  .match(/^EXE: (.+)$/m)[1]
  .trim();
const env = { ...process.env, MATHECA_TEST_DATA: path.join(output, "data") };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const errors = [];
const modal = () =>
  page.getByRole("dialog", { name: "关闭 Matheca", exact: true });
const draftModal = () =>
  page.getByRole("dialog", { name: "保存这道题目？", exact: true });
async function launch() {
  app = await electron.launch({ executablePath: exe, env });
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("h1").waitFor();
  await app.evaluate(({ dialog, Tray }) => {
    globalThis.nativePrompts = [];
    dialog.showMessageBox = async (...args) => {
      globalThis.nativePrompts.push(args.at(-1));
      return { response: 0 };
    };
    const original = Tray.prototype.setContextMenu;
    Tray.prototype.setContextMenu = function (menu) {
      globalThis.testTray = this;
      globalThis.testMenu = menu;
      return original.call(this, menu);
    };
  });
}
const close = () =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.close();
    win.close();
  });
async function visible(value) {
  for (let i = 0; i < 100; i++) {
    if (
      (await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      )) === value
    )
      return;
    await new Promise((r) => setTimeout(r, 35));
  }
  assert.fail("visibility did not settle");
}
const preference = () =>
  page.evaluate(
    async () => (await window.matheca.state()).settings.closeAction,
  );
async function decision(name, remember = false) {
  await modal().waitFor();
  if (remember)
    await modal().getByLabel("保持以上选择", { exact: true }).check();
  await modal().getByRole("button", { name, exact: true }).click();
}
const trayExit = () =>
  app.evaluate(() =>
    globalThis.testMenu.items.find((i) => i.label === "退出").click(),
  );
try {
  await launch();
  assert.equal(await page.locator(".workbench-wordmark img").count(), 0);
  await assert.rejects(
    page.evaluate(() => window.matheca.setCloseAction("bad")),
    /关闭行为无效/,
  );
  await page.evaluate(() =>
    window.matheca.resolveCloseChoice("background", true),
  );
  await visible(true);
  assert.equal(await preference(), "ask");
  await close();
  await modal().waitFor();
  assert.equal(
    await modal().getByLabel("保持以上选择", { exact: true }).isChecked(),
    false,
  );
  for (const theme of ["GRAPHITE", "BLUE", "CLAY", "PLUM"]) {
    await page.evaluate((theme) => window.matheca.setColorTheme(theme), theme);
    await page.waitForFunction(
      (theme) => document.documentElement.dataset.colorTheme === theme,
      theme,
    );
    await page.screenshot({ path: path.join(output, `close-${theme}.png`) });
  }
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1024, 720),
  );
  await page.screenshot({ path: path.join(output, "close-compact.png") });
  await decision("取消", true);
  assert.equal(await preference(), "ask");
  await close();
  await modal().waitFor();
  assert.equal(
    await modal().getByLabel("保持以上选择", { exact: true }).isChecked(),
    false,
  );
  await page.keyboard.press("Escape");
  await modal().waitFor({ state: "detached" });
  assert.equal(await preference(), "ask");
  await page.keyboard.press("Control+n");
  const body = () =>
    page.getByRole("textbox", { name: "题干与小题", exact: true });
  await body().fill("记住关闭选择时保留的手动题草稿。");
  await close();
  await decision("后台运行");
  await visible(false);
  assert.equal(await body().inputValue(), "记住关闭选择时保留的手动题草稿。");
  await app.evaluate(() => globalThis.testTray.emit("click"));
  await visible(true);
  assert.equal(await preference(), "ask");
  await close();
  await decision("后台运行", true);
  await visible(false);
  await app.evaluate(() => globalThis.testTray.emit("double-click"));
  await visible(true);
  assert.equal(await preference(), "background");
  await close();
  await visible(false);
  assert.equal(await modal().count(), 0);
  await trayExit();
  await draftModal().waitFor();
  await draftModal().getByRole("button", { name: "取消", exact: true }).click();
  await visible(true);
  assert.equal(await preference(), "background");
  await close();
  await visible(false);
  const quit = app.waitForEvent("close");
  await trayExit();
  await draftModal().getByRole("button", { name: "保存", exact: true }).click();
  await quit;
  app = undefined;
  await launch();
  assert.equal(await preference(), "background");
  assert.ok(
    (await page.evaluate(() => window.matheca.state())).questions.some(
      (q) => q.body === "记住关闭选择时保留的手动题草稿。",
    ),
  );
  await close();
  await visible(false);
  await app.evaluate(() => globalThis.testTray.emit("click"));
  await visible(true);
  await page.getByRole("button", { name: "设置与备份", exact: true }).click();
  await page.getByLabel("关闭窗口时", { exact: true }).selectOption("ask");
  await page.waitForFunction(
    async () => (await window.matheca.state()).settings.closeAction === "ask",
  );
  await close();
  await modal().waitFor();
  await decision("取消");
  assert.equal(
    await app.evaluate(() => globalThis.nativePrompts.length),
    0,
    "normal close never uses a native message box",
  );
  await close();
  const exited = app.waitForEvent("close");
  await decision("直接退出", true);
  await exited;
  app = undefined;
  await launch();
  assert.equal(await preference(), "quit");
  const direct = app.waitForEvent("close");
  await close();
  await direct;
  app = undefined;
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, "RESULT.md"),
    `PASS: final EXE; isolated data; themed HTML close modal in four accents and compact size; checkbox unchecked by default; cancellation does not persist; unremembered choice prompts again; background persists across restart; settings resets to ask; quit persists across restart; tray exit honors save/cancel; no native close dialogs; invalid inputs rejected.\nEXE: ${exe}\n`,
  );
  console.log("PASS: " + output);
} finally {
  if (app) await app.close();
}
