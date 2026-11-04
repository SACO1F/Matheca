import { appTest } from "./tauri-ui-session.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("test-output", `final-ui-${Date.now()}`);
const env = { ...process.env, MATHECA_TEST_DATA: root };
let app, page;
const errors = [],
  findings = [];
const launch = async () => {
  app = await appTest.launch({ executablePath: process.env.MATHECA_EXE, env });
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
};
const state = () => page.evaluate(() => window.matheca.state());
const nav = async (name) => {
  await page
    .locator(".sidebar")
    .getByRole("button", { name, exact: true })
    .click();
  await page.getByRole("heading", { name, exact: true, level: 1 }).waitFor();
};
const body = () =>
  page.getByRole("textbox", { name: "题干与小题", exact: true });
const modal = () =>
  page.getByRole("dialog", { name: "保存这道题目？", exact: true });
const create = async () => {
  await page.keyboard.press("Control+n");
  await body().waitFor();
};
const choose = async (name, action) => {
  await action();
  await modal().waitFor();
  assert.ok(
    await modal()
      .getByRole("button", { name: "取消", exact: true })
      .evaluate((el) => el === document.activeElement),
  );
  await modal().getByRole("button", { name, exact: true }).click();
  await modal().waitFor({ state: "detached" });
};
const capture = async (name) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${name}.png` });
  findings.push({
    name,
    ...(await page.evaluate(() => ({
      viewport: [innerWidth, innerHeight],
      documentOverflow: document.documentElement.scrollWidth > innerWidth,
      font: getComputedStyle(document.body).fontFamily,
      headings: [...document.querySelectorAll("h1,h2")].map(
        (el) => el.textContent,
      ),
      unnamedControls: [
        ...document.querySelectorAll("button,input,textarea,select"),
      ]
        .filter(
          (el) =>
            el.getBoundingClientRect().width &&
            !el.textContent?.trim() &&
            !el.getAttribute("aria-label") &&
            !el.getAttribute("aria-labelledby") &&
            !el.labels?.length &&
            !el.getAttribute("title"),
        )
        .map((el) => el.outerHTML.slice(0, 250)),
    }))),
  });
  assert.equal(
    findings.at(-1).documentOverflow,
    false,
    `${name}: document overflow`,
  );
};
try {
  await launch();
  for (const [width, height, label] of [
    [1440, 960, "wide"],
    [960, 640, "compact"],
  ]) {
    await page.setViewportSize({ width, height });
    for (const name of [
      "题库",
      "题集",
      "知识点",
      "任务",
      "历史记录",
      "设置与备份",
    ]) {
      await nav(name);
      await capture(`empty-${name}-${label}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await nav("题集");
  const collectionTrigger = page.locator(".collection-create");
  await collectionTrigger.click();
  const collectionModal = page.getByRole("dialog", {
    name: "创建题集",
    exact: true,
  });
  await collectionModal.waitFor();
  const collectionName = collectionModal.getByRole("textbox", {
    name: "题集名称",
    exact: true,
  });
  await collectionName.fill("最终验收题集");
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    assert.ok(
      await collectionModal.evaluate(
        (el) =>
          el.contains(document.activeElement) ||
          document.activeElement === document.body,
      ),
    );
  }
  await collectionName.focus();
  await page.keyboard.press("Control+n");
  assert.equal(
    await page.locator(".editor").count(),
    0,
    "modal blocks background shortcuts",
  );
  await capture("collection-modal-wide");
  await page.setViewportSize({ width: 960, height: 640 });
  await capture("collection-modal-compact");
  await page.keyboard.press("Escape");
  await collectionModal.waitFor({ state: "detached" });
  await page.waitForFunction(() =>
    document.activeElement?.matches(".collection-create"),
  );
  assert.equal((await state()).collections.length, 0);
  await collectionTrigger.click();
  await collectionName.fill("最终验收题集");
  await collectionModal
    .getByRole("button", { name: "创建题集", exact: true })
    .click();
  await collectionModal.waitFor({ state: "detached" });
  assert.equal((await state()).collections.length, 1);
  await page.setViewportSize({ width: 1440, height: 960 });
  await create();
  assert.equal((await state()).questions.length, 0);
  await choose("取消", () =>
    page.getByRole("button", { name: "关闭题目校对", exact: true }).click(),
  );
  assert.ok(await body().isVisible());
  await choose("保存", () =>
    page.getByRole("button", { name: "保存题目", exact: true }).click(),
  );
  await page.locator(".editor").waitFor({ state: "detached" });
  assert.equal((await state()).questions.length, 0);
  await create();
  await body().fill("最终验收手动录入：求函数 \\(f(x)=x^2+1\\) 的最小值。");
  await choose("取消", () =>
    page
      .locator(".sidebar")
      .getByRole("button", { name: "任务", exact: true })
      .click(),
  );
  assert.match(await body().inputValue(), /最终验收/);
  await choose("保存", () =>
    page.getByRole("button", { name: "保存题目", exact: true }).click(),
  );
  await page.locator(".editor").waitFor({ state: "detached" });
  assert.equal((await state()).questions.length, 1);
  await create();
  await body().fill("放弃的草稿不得入库");
  await choose("不保存", () =>
    page.getByRole("button", { name: "关闭题目校对", exact: true }).click(),
  );
  await page.locator(".editor").waitFor({ state: "detached" });
  assert.equal((await state()).questions.length, 1);
  await create();
  await body().fill("取消退出后保留草稿");
  await page.evaluate(() => window.matheca.setCloseAction("ask"));
  await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().close());
  await page
    .getByRole("dialog", { name: "关闭 Matheca", exact: true })
    .getByRole("button", { name: "直接退出", exact: true })
    .click();
  await modal().waitFor();
  await page.waitForTimeout(16000);
  await capture("manual-quit-decision");
  await modal().getByRole("button", { name: "取消", exact: true }).click();
  await modal().waitFor({ state: "detached" });
  assert.equal(await body().inputValue(), "取消退出后保留草稿");
  for (const theme of ["GRAPHITE", "BLUE", "CLAY", "PLUM"]) {
    await page.evaluate((theme) => window.matheca.setColorTheme(theme), theme);
    await page
      .getByRole("button", { name: "关闭题目校对", exact: true })
      .click();
    await modal().waitFor();
    for (const [width, height, label] of [
      [1440, 960, "wide"],
      [960, 640, "compact"],
    ]) {
      await page.setViewportSize({ width, height });
      assert.ok(
        await modal().evaluate((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.left >= 0 &&
            r.top >= 0 &&
            r.right <= innerWidth &&
            r.bottom <= innerHeight
          );
        }),
      );
      await capture(`manual-${theme}-${label}`);
    }
    await page.keyboard.press("Escape");
    await modal().waitFor({ state: "detached" });
  }
  await choose("不保存", () =>
    page.getByRole("button", { name: "关闭题目校对", exact: true }).click(),
  );
  await page.locator(".editor").waitFor({ state: "detached" });
  await page.setViewportSize({ width: 1440, height: 960 });
  await nav("知识点");
  const knowledge = page.locator(".knowledge-page");
  assert.equal(
    await knowledge.locator(".knowledge-modules button").count(),
    13,
  );
  await knowledge
    .getByRole("button", { name: "添加知识点", exact: true })
    .click();
  await knowledge
    .getByLabel("知识点名称", { exact: true })
    .fill("最终验收函数综合应用");
  await knowledge
    .getByRole("combobox", { name: "所属模块", exact: true })
    .click();
  await page.getByRole("option", { name: "函数", exact: true }).click();
  await knowledge
    .getByRole("button", { name: "确认添加", exact: true })
    .click();
  await knowledge
    .locator(".knowledge-point-list li")
    .filter({ hasText: "最终验收函数综合应用" })
    .waitFor();
  const search = knowledge.getByRole("searchbox", {
    name: "搜索知识点",
    exact: true,
  });
  await search.fill("不存在的验收知识点");
  await knowledge.getByText("没有找到相关知识点", { exact: true }).waitFor();
  await knowledge
    .getByRole("button", { name: "清空搜索", exact: true })
    .click();
  await nav("设置与备份");
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
  for (let i = 0; i < 6; i++) {
    await guide.locator(".api-guide-nav > button").nth(i).click();
    await capture(`guide-${i + 1}`);
    assert.ok(
      await guide
        .locator("img")
        .evaluateAll((images) =>
          images.every((i) => i.complete && i.naturalWidth > 0),
        ),
    );
  }
  await page.keyboard.press("Escape");
  await guide.waitFor({ state: "detached" });
  assert.ok(await trigger.evaluate((el) => el === document.activeElement));
  await page.evaluate(() => window.matheca.examples());
  for (const [width, height, label] of [
    [1440, 960, "wide"],
    [960, 640, "compact"],
  ]) {
    await page.setViewportSize({ width, height });
    for (const name of [
      "题库",
      "题集",
      "知识点",
      "任务",
      "历史记录",
      "设置与备份",
    ]) {
      await nav(name);
      await capture(`populated-${name}-${label}`);
    }
  }
  await nav("题库");
  const joinTrigger = page
    .locator(".question-card .card-add-collection")
    .first();
  await joinTrigger.click();
  const joinModal = page.getByRole("dialog", { name: "加入题集", exact: true });
  await joinModal.waitFor();
  await capture("join-collection-compact");
  await page.keyboard.press("Escape");
  await joinModal.waitFor({ state: "detached" });
  await page.waitForFunction(() =>
    document.activeElement?.matches(".card-add-collection"),
  );
  assert.ok(await joinTrigger.evaluate((el) => el === document.activeElement));
  await page.locator(".question-card .card-review").first().click();
  await body().waitFor();
  await capture("editor-compact");
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture("editor-wide");
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  const count = (await state()).questions.length;
  await app.close();
  app = undefined;
  await launch();
  assert.equal((await state()).questions.length, count);
  assert.ok(
    (await state()).questions.some((q) => q.body.includes("最终验收手动录入")),
  );
  assert.equal(
    (await state()).customKnowledge.filter(
      (p) => p.name === "最终验收函数综合应用",
    ).length,
    1,
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(root, "UI-FINDINGS.json"),
    JSON.stringify(findings, null, 2),
  );
  console.log(
    `PASS: manual save/discard/cancel/quit/restart, knowledge add/search, six guide steps, six pages empty/populated, four themes, 960/1440 viewport, focus, assets, no page errors. ${root}`,
  );
} finally {
  await app?.close();
}
