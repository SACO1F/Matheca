import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
const env = {
  ...process.env,
  MATHECA_TEST_DATA: path.resolve(
    "test-output",
    "toast-collections-" + Date.now(),
  ),
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
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("h1").waitFor();
  const fixture = await page.evaluate(async () => {
    await window.matheca.examples();
    const q = (await window.matheca.state()).questions[0];
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 100;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#2967e9";
    ctx.fillRect(0, 0, 200, 100);
    await window.matheca.saveQuestion(
      { ...q, figures: [canvas.toDataURL("image/png")], figureWidths: [80] },
      true,
    );
    for (let i = 0; i < 24; i++) {
      const c = {
        id: "compact-" + i,
        title:
          i === 0
            ? "高一函数与集合练习"
            : i === 1
              ? "特别长的题集名称用于检查窄栏换行和可读性，第二学期期末综合复习试卷"
              : "数学专题练习 " + (i + 1),
        createdAt: String(Date.now() + i),
        paperTitle: "数学练习",
        examMinutes: 60,
        totalScore: 100,
        examInstructions: "",
      };
      await window.matheca.saveCollection(c);
      if (i < 2) await window.matheca.addQuestions(c.id, [q.id]);
    }
    return q.id;
  });
  const state = () => page.evaluate(() => window.matheca.state());
  const confirm = page.getByRole("button", { name: "确认已校对", exact: true });
  const card = page.locator(`.question-card[data-question-id="${fixture}"]`);
  const confirmAndReopen = async () => {
    await confirm.click();
    await page.locator(".editor").waitFor({ state: "detached" });
    assert.equal(await page.locator("h1").innerText(), "题库");
    await card.locator(".card-review").click();
    await page.locator(".editor").waitFor();
  };
  await card.click();
  await confirm.waitFor();
  await page.waitForTimeout(500);
  const body = page.getByRole("textbox", { name: "题干与小题", exact: true });
  const original = await body.inputValue();
  await body.fill(original + "\nToast 保存验证");
  const width = page.getByRole("spinbutton", {
    name: "图形 1 宽度（毫米）",
    exact: true,
  });
  await width.fill("120");
  await width.press("Enter");
  const statsBefore = await page.locator(".stats").boundingBox();
  await confirmAndReopen();
  const toast = page.getByRole("region", { name: "通知", exact: true });
  await toast.waitFor();
  await page.waitForTimeout(400);
  const statsAfter = await page.locator(".stats").boundingBox();
  assert.equal(statsAfter.y, statsBefore.y, "toast does not shift workbench");
  const header = await page.locator(".topbar").boundingBox(),
    box = await toast.boundingBox();
  assert.ok(
    Math.abs(box.x + box.width / 2 - (header.x + header.width / 2)) < 2 &&
      Math.abs(box.y + box.height / 2 - (header.y + header.height / 2)) < 2,
    "toast centered within title/search row",
  );
  assert.equal(
    await toast.getByRole("button", { name: "撤销", exact: true }).count(),
    1,
  );
  await page.screenshot({ path: "test-output/swipe-toast-desktop.png" });
  // A newer unsaved edit must not be overwritten by an older undo.
  const confirmedBody = await body.inputValue();
  await body.fill(confirmedBody + "\n还未保存的新编辑");
  await toast.getByRole("button", { name: "撤销", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await body.inputValue(), confirmedBody + "\n还未保存的新编辑");
  assert.equal(
    (await state()).questions.find((q) => q.id === fixture).body,
    confirmedBody,
  );
  await body.fill(confirmedBody);
  await page.locator(".banner.error button").click();
  // Restore the saved step, including its previous reviewed state.
  await toast.getByRole("button", { name: "撤销", exact: true }).click();
  await page.waitForTimeout(250);
  const undone = (await state()).questions.find((q) => q.id === fixture);
  assert.equal(undone.body, original);
  assert.equal(undone.reviewed, true);
  assert.deepEqual(undone.figureWidths, [80]);
  assert.equal(await width.inputValue(), "80");
  assert.equal(await body.inputValue(), original);
  await page.getByRole("button", { name: "关闭通知", exact: true }).click();
  await toast.waitFor({ state: "hidden" });
  await body.fill((await body.inputValue()) + "\n新的一步");
  await confirmAndReopen();
  await toast.waitFor();
  await page.waitForTimeout(350);
  await toast.getByRole("button", { name: "撤销", exact: true }).focus();
  const remaining = await toast.evaluate((el) =>
    Number(el.style.getPropertyValue("--toast-remaining")),
  );
  await page.waitForTimeout(8300);
  assert.ok(await toast.isVisible(), "keyboard focus pauses countdown");
  assert.ok(
    Math.abs(
      (await toast.evaluate((el) =>
        Number(el.style.getPropertyValue("--toast-remaining")),
      )) - remaining,
    ) < 0.03,
  );
  await toast.press("Escape");
  await toast.waitFor({ state: "hidden" });
  assert.ok(
    await page.locator(".editor").isVisible(),
    "Escape only dismisses toast after reopening editor",
  );
  // A short swipe springs back; a downward swipe dismisses without changing review status.
  await body.fill((await body.inputValue()) + "\n新的一步");
  await confirmAndReopen();
  await toast.waitFor();
  await page.waitForTimeout(350);
  const rect = await toast.boundingBox();
  await page.mouse.move(rect.x + 70, rect.y + 20);
  await page.mouse.down();
  await page.mouse.move(rect.x + 70, rect.y + 30, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  assert.ok(await toast.isVisible());
  await page.mouse.move(rect.x + 70, rect.y + 20);
  await page.mouse.down();
  await page.mouse.move(rect.x + 70, rect.y + 100, { steps: 10 });
  await page.mouse.up();
  await toast.waitFor({ state: "hidden" });
  assert.equal(
    (await state()).questions.find((q) => q.id === fixture).reviewed,
    true,
  );
  await body.fill((await body.inputValue()) + "\n新的一步");
  await confirmAndReopen();
  await toast.waitFor();
  await page.mouse.move(1100, 80);
  await page.waitForTimeout(8700);
  await toast.waitFor({ state: "hidden" });
  // Repeated confirmation replaces one toast and restarts the countdown.
  const beforeRepeat = await body.inputValue();
  await body.fill(beforeRepeat + "\n重复确认验证");
  await confirmAndReopen();
  await confirmAndReopen();
  assert.equal(await toast.count(), 1);
  await toast.getByRole("button", { name: "撤销", exact: true }).click();
  assert.equal(
    await body.inputValue(),
    beforeRepeat,
    "repeat confirmation preserves the original undo step",
  );
  await page.getByRole("button", { name: "关闭通知", exact: true }).click();
  await toast.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.waitForTimeout(500);
  const nav = (name) =>
    page.locator(".sidebar").getByRole("button", { name, exact: true });
  await nav("题集").click();
  const rows = page.locator(".collection-card");
  await rows.first().waitFor();
  assert.equal(await rows.count(), 24);
  const row = rows.filter({ hasText: "高一函数与集合练习" });
  await row.click();
  assert.equal(await row.getAttribute("aria-current"), "true");
  const rowBox = await row.boundingBox();
  assert.ok(rowBox.height <= 82, "compact rows fit one or two title lines");
  const cols = await Promise.all(
    [".collection-list", ".collection-settings", ".collection-detail"].map(
      (s) => page.locator(s).boundingBox(),
    ),
  );
  assert.ok(
    cols[0].width <= 190 &&
      cols[0].x + cols[0].width <= cols[1].x &&
      cols[1].x + cols[1].width <= cols[2].x,
  );
  assert.ok(
    await page
      .locator(".collection-list-items")
      .evaluate((el) => el.scrollHeight > el.clientHeight),
  );
  const long = rows.filter({ hasText: "特别长的题集名称" });
  assert.ok(await long.getAttribute("title"));
  await long.click();
  assert.equal(await long.getAttribute("aria-current"), "true");
  const checkCreate = async () => {
    const create = page.locator(".collection-create"),
      button = await create.boundingBox(),
      list = await page.locator(".collection-list-items").boundingBox();
    assert.ok(
      button.y >= list.y + list.height &&
        button.y + button.height <=
          (await page.locator(".collection-list").boundingBox()).y +
            (await page.locator(".collection-list").boundingBox()).height +
            1,
    );
    assert.ok(await create.isVisible());
    await create.click();
    await page
      .getByRole("textbox", { name: "题集名称", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "取消", exact: true }).click();
  };
  await checkCreate();
  await page.screenshot({
    path: "test-output/compact-collections-desktop.png",
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1024, 700),
  );
  await page.waitForTimeout(500);
  await checkCreate();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth === innerWidth,
    ),
  );
  await page.screenshot({
    path: "test-output/compact-collections-minimum.png",
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await nav("题库").click();
  await card.click();
  await body.fill((await body.inputValue()) + "\n新的一步");
  await confirmAndReopen();
  await toast.waitFor();
  assert.equal(
    await toast.evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await toast.getByRole("button", { name: "撤销", exact: true }).click();
  await page.waitForTimeout(150);
  assert.equal(
    (await state()).questions.find((q) => q.id === fixture).reviewed,
    true,
  );
  const history = await page.evaluate(() => window.matheca.historyList());
  assert.ok(history.records.some((r) => r.title === "撤销题目修改"));
  await page.screenshot({ path: "test-output/swipe-toast-minimum.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: centered title-row position, floating without layout shift, real edit undo restoring prior content and reviewed status, focus pause, countdown expiry, short/long swipe, Escape, repeated confirmation, reduced motion, meaningful history, compact 24-item collection navigation, long titles and minimum window",
  );
} finally {
  await app.close();
}
