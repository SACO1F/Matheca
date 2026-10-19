import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const env = {
  ...process.env,
  MATHECA_TEST_DATA: path.resolve("test-output", "tree-" + Date.now()),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath:
    process.env.MATHECA_EXE ??
    path.resolve("node_modules/electron/dist/electron.exe"),
  args: [
    ...(process.env.MATHECA_EXE ? [] : [path.resolve(".vite/build/main.cjs")]),
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
  await page.evaluate(async () => {
    await window.matheca.examples();
    await window.matheca.addKnowledge({
      group: "函数",
      name: "隔离测试知识点",
    });
    await window.matheca.addKnowledge({
      group: "函数",
      name: "较长知识点名称用于验证换行以后分支连线仍然正确对齐",
    });
    const state = await window.matheca.state();
    await window.matheca.saveQuestion(
      {
        ...state.questions[0],
        id: "tree-fixture",
        knowledge: "隔离测试知识点",
      },
      false,
    );
  });
  const library = page
    .locator(".sidebar")
    .getByRole("button", { name: "题库", exact: true });
  assert.equal(await page.locator(".library-sidebar-toggle").count(), 1);
  for (const name of ["题库", "题集", "知识点", "任务", "设置与备份"]) {
    const button = page
      .locator(".sidebar")
      .getByRole("button", { name, exact: true });
    await button.hover();
    // Keep the CSS assertion ahead of screenshot capture; if another native
    // window took the pointer, restore hover rather than waiting on a stale one.
    await page.waitForTimeout(180);
    if (!(await button.evaluate((el) => el.matches(":hover")))) {
      await page.bringToFront();
      await button.hover();
    }
    console.log("Checking hover:", name);
    await page.waitForFunction((name) => {
      const button = document.querySelector(
        `.sidebar button[aria-label="${name}"]`,
      );
      return (
        button &&
        getComputedStyle(button).backgroundColor === "rgb(232, 232, 232)"
      );
    }, name);
    const hoverStyle = await button.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        background: style.backgroundColor,
        borderWidth: style.borderTopWidth,
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
        radius: style.borderRadius,
      };
    });
    assert.deepEqual(
      hoverStyle,
      {
        background: "rgb(232, 232, 232)",
        borderWidth: "0px",
        width: 36,
        height: 36,
        radius: "10px",
      },
      `${name} preserves the workbench navigation geometry and hover highlight`,
    );
    await page.screenshot({ path: "test-output/menu-hover-check.png" });
  }
  await page.mouse.move(650, 350);
  await page.waitForTimeout(550);
  await library.click();
  await page.waitForTimeout(400);
  assert.equal(
    await library.getAttribute("aria-expanded"),
    "false",
    "library click only navigates, without opening a sidebar",
  );
  assert.equal(
    await page.locator(".knowledge-reveal").getAttribute("aria-hidden"),
    "true",
    "library navigation keeps the sidebar closed",
  );
  const sidebarToggle = page.locator(".library-sidebar-toggle");
  await sidebarToggle.click();
  assert.ok(
    await page
      .locator(".knowledge-reveal")
      .evaluate((el) =>
        el
          .getAnimations()
          .some((animation) =>
            animation.effect
              .getKeyframes()
              .some((frame) => frame.transform === "translateX(-100%)"),
          ),
      ),
    "docked sidebar uses horizontal translation",
  );
  assert.ok(
    await page
      .locator(".knowledge-reveal")
      .evaluate(
        (el) =>
          el.classList.contains("docked") && !el.classList.contains("floating"),
      ),
  );
  await page.waitForTimeout(400);
  assert.equal(await library.getAttribute("aria-expanded"), "true");
  assert.equal(
    await page.locator(".library-sidebar-toggle").getAttribute("aria-expanded"),
    "true",
  );
  await sidebarToggle.click();
  await page.mouse.move(650, 350);
  await page.waitForTimeout(650);
  const workspaceBefore = await page.locator(".workspace").boundingBox();
  await library.hover();
  await page.waitForTimeout(650);
  assert.equal(
    await page.locator(".knowledge-reveal.hover-preview").count(),
    0,
    "library hover never opens a floating sidebar",
  );
  assert.equal(
    await page.locator(".knowledge-reveal").getAttribute("aria-hidden"),
    "true",
  );
  assert.equal(await sidebarToggle.getAttribute("aria-expanded"), "false");
  const workspaceAfterHover = await page.locator(".workspace").boundingBox();
  assert.equal(workspaceAfterHover.x, workspaceBefore.x);
  assert.equal(workspaceAfterHover.width, workspaceBefore.width);
  await sidebarToggle.hover();
  await page.waitForTimeout(400);
  assert.equal(
    await page.locator(".knowledge-reveal").getAttribute("aria-hidden"),
    "true",
    "titlebar toggle hover does not show floating navigation",
  );
  await sidebarToggle.click();
  await page.waitForTimeout(400);
  assert.equal(await sidebarToggle.getAttribute("aria-expanded"), "true");
  assert.equal(
    await page.locator(".knowledge-reveal.hover-preview").count(),
    0,
  );
  assert.ok(
    await page.evaluate(
      () =>
        document.querySelector(".knowledge-reveal").parentElement ===
          document.querySelector(".workspace").parentElement &&
        document
          .querySelector(".workspace")
          .parentElement.classList.contains("content-shell"),
    ),
  );
  const tree = page.getByRole("tree", { name: "数学知识点" });
  const group = tree.getByRole("treeitem", { name: "函数", exact: true });
  await group.focus();
  await group.press("ArrowLeft");
  assert.equal(await group.getAttribute("aria-expanded"), "false");
  await group.press("ArrowRight");
  await group.press("ArrowRight");
  assert.equal(
    await page.evaluate(() => document.activeElement.textContent),
    "函数的概念与性质",
  );
  const custom = tree.getByRole("treeitem", {
    name: "隔离测试知识点",
    exact: true,
  });
  await custom.click();
  await page.waitForFunction(
    () => document.querySelectorAll(".question-card").length === 1,
  );
  assert.equal(
    await page.locator(".question-card").getAttribute("data-question-id"),
    "tree-fixture",
  );
  assert.equal(await custom.getAttribute("aria-selected"), "true");
  await page.waitForTimeout(450);
  assert.ok(
    await page
      .locator(".branched-menu__marker")
      .evaluate((el) => el.hasAttribute("data-on")),
  );
  assert.equal(await page.locator(".branch-chevron").count(), 0);
  assert.ok(
    await custom.evaluate((el) => {
      const heading = el
        .closest(".knowledge-branch")
        .querySelector(".knowledge-group")
        .getBoundingClientRect();
      const marker = document
        .querySelector(".branched-menu__marker")
        .getBoundingClientRect();
      return (
        Math.abs(
          marker.top + marker.height / 2 - heading.top - heading.height / 2,
        ) < 1
      );
    }),
    "moving marker aligns with selected section",
  );
  const longName = tree.getByRole("treeitem", {
    name: "较长知识点名称用于验证换行以后分支连线仍然正确对齐",
    exact: true,
  });
  assert.ok(
    await longName.evaluate((el) => el.offsetHeight > 36),
    "long names wrap naturally",
  );
  assert.ok(
    await longName.evaluate((el) => {
      const rows = [...el.parentElement.querySelectorAll(".knowledge-leaf")];
      const branch =
        el.parentElement.querySelectorAll("g .branch-line")[rows.indexOf(el)];
      const match = branch.getAttribute("d").match(/24 ([\d.]+) H/);
      return (
        Math.abs(Number(match[1]) - el.offsetTop - el.offsetHeight / 2) < 1
      );
    }),
    "arc endpoint tracks measured variable row height",
  );
  await page.screenshot({
    path: "test-output/knowledge-branched-selected.png",
  });

  await page.waitForFunction(() =>
    document
      .querySelector(".branch-trace.active")
      ?.getAttribute("d")
      .includes("A"),
  );

  assert.ok(
    (
      await page.locator(".library-filters [role=combobox]").nth(3).innerText()
    ).includes("隔离测试知识点"),
  );
  const builtin = await page.evaluate(
    async () =>
      (await window.matheca.state()).questions
        .find((question) => question.id !== "tree-fixture")
        .knowledge.split("、")[0],
  );
  const builtinItem = tree.getByRole("treeitem", {
    name: builtin,
    exact: true,
  });
  const builtinGroup = page.locator(".knowledge-group").filter({
    hasText: await builtinItem.evaluate(
      (element) => element.closest(".knowledge-branch").dataset.group,
    ),
  });
  if ((await builtinGroup.getAttribute("aria-expanded")) === "false")
    await builtinGroup.click();
  await builtinItem.click();
  const expectedBuiltin = await page.evaluate(
    async (point) =>
      (await window.matheca.state()).questions.filter((question) =>
        question.knowledge.split("、").includes(point),
      ).length,
    builtin,
  );
  await page.waitForFunction(
    (count) => document.querySelectorAll(".question-card").length === count,
    expectedBuiltin,
  );
  await page.getByRole("button", { name: "全部题目", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".question-card").length === 4,
  );
  await page.waitForTimeout(600);
  await page
    .locator(".knowledge-tree-scroll")
    .evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: "test-output/knowledge-tree-wide.png" });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1024, 700),
  );
  await page.waitForTimeout(600);
  assert.ok(
    await page.evaluate(() =>
      [...document.querySelectorAll(".glide-trigger, .favorite-filter")].every(
        (el) => el.getBoundingClientRect().right <= innerWidth,
      ),
    ),
    "tree and filters fit minimum window",
  );
  await page.screenshot({ path: "test-output/knowledge-tree-minimum.png" });
  const firstCard = page.locator(".question-card").first();
  await page.mouse.move(650, 80);
  await page.waitForTimeout(300);
  const cardBefore = await firstCard.boundingBox();
  const cardBorderBefore = await firstCard.evaluate(
    (el) => getComputedStyle(el).borderColor,
  );
  await firstCard.hover();
  await page.waitForTimeout(350);
  const cardBorderAfter = await firstCard.evaluate(
    (el) => getComputedStyle(el).borderColor,
  );
  assert.notEqual(
    cardBorderAfter,
    cardBorderBefore,
    "card boundary becomes clearer on hover without shifting layout",
  );
  const cardAfter = await firstCard.boundingBox();
  assert.equal(cardBefore.width, cardAfter.width);
  assert.equal(cardBefore.height, cardAfter.height);
  await page.screenshot({ path: "test-output/question-card-hover.png" });
  const joinedId = await firstCard.getAttribute("data-question-id");
  await firstCard.locator(".card-add-collection").click();
  const joinDialog = page.getByRole("dialog", {
    name: "加入题集",
    exact: true,
  });
  await joinDialog
    .getByLabel("新题集名称", { exact: true })
    .fill("卡片加入验证");
  await joinDialog
    .getByRole("button", { name: "创建并加入", exact: true })
    .click();
  await page.waitForFunction(
    () => !document.querySelector('[aria-labelledby="join-collection-title"]'),
  );
  assert.ok(
    await page.evaluate(async (id) => {
      const state = await window.matheca.state();
      const collection = state.collections.find(
        (c) => c.title === "卡片加入验证",
      );
      return state.items.some(
        (item) => item.collectionId === collection.id && item.questionId === id,
      );
    }, joinedId),
  );
  await firstCard.locator(".card-add-collection").click();
  await joinDialog
    .getByRole("button", { name: "卡片加入验证", exact: true })
    .click();
  await page.waitForFunction(
    () => !document.querySelector('[aria-labelledby="join-collection-title"]'),
  );
  assert.equal(
    await page.locator(".editor").count(),
    0,
    "adding to a collection does not open proofreading",
  );
  await firstCard.locator(".card-review").click();
  await page.waitForTimeout(600);
  assert.ok(await page.locator(".editor").isVisible());
  const editedId = await firstCard.getAttribute("data-question-id");
  const bodyInput = page.getByRole("textbox", {
    name: "题干与小题",
    exact: true,
  });
  const editedBody = (await bodyInput.inputValue()) + "\n卡片收起保存验证";
  await bodyInput.fill(editedBody);
  await page.locator(".editor .preview").click();
  await page.waitForTimeout(600);
  assert.equal(
    await page.locator(".editor").count(),
    0,
    "second card click closes panel",
  );
  assert.equal(
    await page.evaluate(
      async (id) =>
        (await window.matheca.state()).questions.find((q) => q.id === id).body,
      editedId,
    ),
    editedBody,
  );
  await firstCard.click();
  await page.waitForTimeout(600);
  assert.ok(
    await page.locator(".editor").isVisible(),
    "third click reopens panel",
  );
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "题集", exact: true })
    .click();
  await library.click();
  await sidebarToggle.click();
  await custom.click();
  const switchDialog = page.getByRole("dialog", {
    name: "保存当前题目？",
    exact: true,
  });
  await switchDialog.waitFor();
  assert.equal(await page.locator("h1").textContent(), "题库");
  assert.equal(
    await page
      .locator('.editor textarea[aria-label="题干与小题"]')
      .inputValue(),
    editedBody,
    "knowledge jump first returns to the active proofreading question",
  );
  assert.ok(
    !(
      await page.locator(".library-filters [role=combobox]").nth(3).innerText()
    ).includes("隔离测试知识点"),
    "filter is unchanged before confirmation",
  );
  await switchDialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.ok(await page.locator(".editor").isVisible());
  const pendingBody = editedBody + "\n跳转保存验证";
  await bodyInput.fill(pendingBody);
  await library.click();
  await sidebarToggle.click();
  await custom.click();
  await switchDialog
    .getByRole("button", { name: "保存并切换", exact: true })
    .click();
  await page.waitForTimeout(650);
  assert.equal(await page.locator(".editor").count(), 0);
  assert.equal(await page.locator(".question-card").count(), 1);
  assert.equal(
    await page.evaluate(
      async (id) =>
        (await window.matheca.state()).questions.find((q) => q.id === id).body,
      editedId,
    ),
    pendingBody,
  );
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await page.locator(`.question-card[data-question-id="${editedId}"]`).click();
  await page.waitForTimeout(600);
  await sidebarToggle.click();
  await page.waitForTimeout(400);

  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.waitForTimeout(450);
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "隐藏侧边栏", exact: true }).click();
    await page.getByRole("button", { name: "显示侧边栏", exact: true }).click();
  }
  await group.focus();
  await group.press("Escape");
  assert.equal(await library.getAttribute("aria-expanded"), "false");
  assert.equal(
    await page
      .locator(".library-sidebar-toggle")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) => w.isVisible());
    w.setMinimumSize(640, 620);
    w.setSize(800, 700);
  });
  await library.click();
  await sidebarToggle.click();
  await page.waitForTimeout(400);
  assert.ok(await page.locator(".knowledge-panel").isVisible());
  await tree
    .getByRole("treeitem", { name: "隔离测试知识点", exact: true })
    .click();
  assert.equal(
    await library.getAttribute("aria-expanded"),
    "false",
    "small-screen selection dismisses tree",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await library.click();
  await sidebarToggle.click();
  assert.ok(
    await page.locator(".knowledge-reveal").evaluate((el) =>
      getComputedStyle(el)
        .transitionDuration.split(",")
        .every((value) => parseFloat(value) <= 0.001),
    ),
    "reduced motion makes all sidebar transitions effectively immediate",
  );
  assert.deepEqual(errors, []);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "设置与备份", exact: true })
    .click();
  assert.equal(await page.locator(".library-sidebar-toggle").count(), 0);
  const settingsWorkspace = await page.locator(".workspace").boundingBox();
  await library.hover();
  await page.waitForTimeout(250);
  assert.equal(
    await page.locator(".knowledge-reveal.hover-preview").count(),
    0,
  );
  assert.equal(await page.locator("h1").textContent(), "设置与备份");
  const settingsPreviewWorkspace = await page
    .locator(".workspace")
    .boundingBox();
  assert.equal(settingsPreviewWorkspace.x, settingsWorkspace.x);
  assert.equal(settingsPreviewWorkspace.width, settingsWorkspace.width);
  await page.mouse.move(650, 350);
  await page.waitForTimeout(550);
  assert.equal(await page.getByLabel("主题", { exact: true }).count(), 0);
  assert.equal(
    await page.getByRole("heading", { name: "外观", exact: true }).count(),
    1,
  );
  await page.emulateMedia({ colorScheme: "dark" });
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "light",
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1440, 940),
  );
  await library.click();
  await sidebarToggle.click();
  await page.getByRole("button", { name: "全部题目", exact: true }).click();
  assert.equal(
    await page
      .locator(".knowledge-panel")
      .evaluate((element) => getComputedStyle(element).backgroundColor),
    "rgb(247, 247, 247)",
  );
  await page.waitForTimeout(600);
  await page
    .locator(".knowledge-tree-scroll")
    .evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: "test-output/knowledge-tree-light.png" });
  const tagCard = page.locator(".question-card").first();
  const gradeTag = tagCard
    .locator('button[aria-label^="按年级筛选："]')
    .first();
  const chosenGrade = await gradeTag.textContent();
  await gradeTag.click();
  assert.ok(
    (
      await page.locator(".library-filters [role=combobox]").nth(0).innerText()
    ).includes(chosenGrade),
  );
  const difficultyTag = page
    .locator('.question-card button[aria-label^="按难度筛选："]')
    .first();
  const chosenDifficulty = await difficultyTag.textContent();
  await difficultyTag.focus();
  await difficultyTag.press("Enter");
  assert.ok(
    (
      await page.locator(".library-filters [role=combobox]").nth(1).innerText()
    ).includes(chosenDifficulty),
  );
  const knowledgeTag = page
    .locator('.question-card button[aria-label^="按知识点筛选："]')
    .first();
  const chosenKnowledge = await knowledgeTag.textContent();
  await knowledgeTag.click();
  assert.ok(
    (
      await page.locator(".library-filters [role=combobox]").nth(3).innerText()
    ).includes(chosenKnowledge),
  );
  const expectedTags = await page.evaluate(
    async ([grade, difficulty, knowledge]) =>
      (await window.matheca.state()).questions.filter(
        (q) =>
          q.grade === grade &&
          q.difficulty === difficulty &&
          q.knowledge.split("、").includes(knowledge),
      ).length,
    [chosenGrade, chosenDifficulty, chosenKnowledge],
  );
  await page.waitForFunction(
    (count) => document.querySelectorAll(".question-card").length === count,
    expectedTags,
  );
  assert.equal(
    await page.locator(".editor").count(),
    0,
    "tag clicks filter without opening proofreading",
  );
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".question-card").length === 4,
  );
  const backupFile = env.MATHECA_TEST_DATA + "/quick-import.zip";
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, backupFile);
  await page.evaluate(() => window.matheca.exportBackup());
  await page.locator(".fab").click();
  await page.getByRole("menuitem", { name: "导入题库", exact: true }).click();
  await page
    .getByRole("heading", { name: "题库导入预览", exact: true })
    .waitFor();
  assert.equal(await page.locator(".fab-menu").count(), 0);
  await page
    .locator(".modal")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await page.locator(".fab").click();
  assert.equal(await page.locator(".fab-menu [role=menuitem]").count(), 7);
  assert.equal(await page.locator(".fab-menu .quick-icon").count(), 7);
  await page.screenshot({ path: "test-output/question-list-quick-menu.png" });
  await page.getByRole("menuitem", { name: "创建题集", exact: true }).click();
  await page.getByLabel("题集名称", { exact: true }).fill("快捷创建测试题集");
  await page
    .locator(".modal")
    .getByRole("button", { name: "创建题集", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector("h1")?.textContent === "题集",
  );
  assert.ok(
    await page.evaluate(async () =>
      (await window.matheca.state()).collections.some(
        (c) => c.title === "快捷创建测试题集",
      ),
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: tree expansion, keyboard navigation, built-in/custom filtering, dropdown sync, reset, minimum window, detail view, rapid toggles, Escape focus return, narrow overlay and reduced motion.",
  );
} finally {
  await app.close();
}
