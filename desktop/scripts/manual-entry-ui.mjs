import { _electron as electron } from "playwright";
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const output = path.resolve("test-output", `manual-entry-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
const executablePath =
  process.env.MATHECA_EXE ||
  fs
    .readFileSync("releases/latest.txt", "utf8")
    .match(/^EXE: (.+)$/m)[1]
    .trim();
const env = { ...process.env, MATHECA_TEST_DATA: path.join(output, "data") };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const errors = [];
async function launch() {
  app = await electron.launch({ executablePath, env });
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("h1").waitFor();
  await app.evaluate(({ dialog }) => {
    globalThis.nativePrompts = [];
    dialog.showMessageBox = async (...args) => {
      globalThis.nativePrompts.push(args.at(-1));
      return { response: 0, checkboxChecked: false };
    };
  });
}
const state = () => page.evaluate(() => window.matheca.state());
const body = () =>
  page.getByRole("textbox", { name: "题干与小题", exact: true });
const modal = () =>
  page.getByRole("dialog", { name: "保存这道题目？", exact: true });
const create = async () => {
  await page.keyboard.press("Control+n");
  await body().waitFor();
};
const decide = async (name, action) => {
  await action();
  await modal().waitFor();
  if (
    await modal()
      .getByText("这道题还没有内容。选择保存也不会留下空白题目。", {
        exact: true,
      })
      .count()
  ) {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1024, 700),
    );
    await page.screenshot({ path: path.join(output, "empty-compact.png") });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 940),
    );
  }
  assert.ok(
    await modal()
      .getByRole("button", { name: "取消", exact: true })
      .evaluate((el) => el === document.activeElement),
  );
  await modal().getByRole("button", { name, exact: true }).click();
  await modal().waitFor({ state: "detached" });
};
try {
  await launch();
  assert.equal(await page.title(), "Matheca");
  assert.equal(await app.evaluate(({ app }) => app.getName()), "Matheca");
  await create();
  assert.equal((await state()).questions.length, 0);
  await decide("取消", () =>
    page.getByRole("button", { name: "关闭题目校对", exact: true }).click(),
  );
  assert.ok(await body().isVisible());
  await decide("保存", () =>
    page.getByRole("button", { name: "保存题目", exact: true }).click(),
  );
  await page.locator(".editor").waitFor({ state: "detached" });
  assert.equal((await state()).questions.length, 0);
  await create();
  await body().fill("应保留的手动录入题目：求 x²+1 的最小值。");
  await decide("取消", () =>
    page
      .locator(".sidebar")
      .getByRole("button", { name: "任务", exact: true })
      .click(),
  );
  assert.ok(await body().isVisible());
  assert.equal((await state()).questions.length, 0);
  await decide("保存", () =>
    page.getByRole("button", { name: "保存题目", exact: true }).click(),
  );
  await page.locator(".editor").waitFor({ state: "detached" });
  let saved = (await state()).questions;
  assert.equal(saved.length, 1);
  assert.match(saved[0].body, /应保留/);
  await create();
  await body().fill("不保存的文字");
  await decide("不保存", () =>
    page
      .locator(".sidebar")
      .getByRole("button", { name: "任务", exact: true })
      .click(),
  );
  await page.getByRole("heading", { name: "任务", exact: true }).waitFor();
  assert.equal((await state()).questions.length, 1);
  await create();
  await body().fill("取消退出后继续编辑");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  await modal().waitFor();
  // A deliberate user decision must not trigger the 15s unresponsive warning.
  await page.waitForTimeout(16000);
  assert.equal(await app.evaluate(() => globalThis.nativePrompts.length), 0);
  await modal().getByRole("button", { name: "取消", exact: true }).click();
  await modal().waitFor({ state: "detached" });
  assert.equal(await body().inputValue(), "取消退出后继续编辑");
  assert.equal((await state()).questions.length, 1);
  for (const theme of ["GRAPHITE", "BLUE", "CLAY", "PLUM"]) {
    await page.evaluate((theme) => window.matheca.setColorTheme(theme), theme);
    await page.waitForFunction(
      (theme) => document.documentElement.dataset.colorTheme === theme,
      theme,
    );
    await page
      .getByRole("button", { name: "关闭题目校对", exact: true })
      .click();
    await modal().waitFor();
    await page.mouse.move(700, 80);
    assert.equal(await modal().evaluate((el) => el.getAnimations().length), 0);
    for (const [width, height, size] of [
      [1440, 940, "wide"],
      [1024, 700, "compact"],
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0].setSize(...size),
        [width, height],
      );
      await page.screenshot({
        path: path.join(output, `${theme}-${size}.png`),
      });
      assert.ok(
        await modal().evaluate((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.top >= 0 &&
            r.left >= 0 &&
            r.bottom <= innerHeight &&
            r.right <= innerWidth &&
            el.scrollWidth <= el.clientWidth
          );
        }),
      );
    }
    await page.keyboard.press("Escape");
    await modal().waitFor({ state: "detached" });
    assert.equal(await body().inputValue(), "取消退出后继续编辑");
  }
  await decide("不保存", () =>
    page.getByRole("button", { name: "关闭题目校对", exact: true }).click(),
  );
  await page.locator(".editor").waitFor({ state: "detached" });
  assert.equal(
    await app.evaluate(() => globalThis.nativePrompts.length),
    0,
    "save prompts never call a native message box",
  );
  const db = new Database(path.join(env.MATHECA_TEST_DATA, "library.sqlite"));
  const empty = {
    ...saved[0],
    id: "legacy-empty",
    title: "新题目",
    body: "",
    latex: "",
    sourcePath: "",
    solution: "",
    solutionLatex: "",
    figures: [],
    sourceLabel: "手动录入",
  };
  const formula = { ...empty, id: "formula-only", latex: "x^2+1" };
  for (const q of [empty, formula])
    db.prepare("INSERT INTO questions VALUES(?,?,?)").run(
      q.id,
      Number(q.createdAt),
      JSON.stringify(q),
    );
  db.close();
  await app.close();
  app = undefined;
  await launch();
  saved = (await state()).questions;
  assert.ok(!saved.some((q) => q.id === "legacy-empty"));
  assert.ok(saved.some((q) => q.id === "formula-only"));
  assert.ok(saved.some((q) => q.body.includes("应保留")));
  assert.deepEqual(errors, []);
  console.log(
    "PASS: themed in-app modal, real save/discard/cancel clicks, focus and Escape, no native boxes, 16s quit decision, content and restart persistence, four themes at1440/1024. " +
      output,
  );
} finally {
  await app?.close();
}
