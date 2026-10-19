import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import yauzl from "yauzl";
const env = {
  ...process.env,
  MATHECA_TEST_DATA: path.resolve("test-output", "expanded-" + Date.now()),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath:
    process.env.MATHECA_EXE ??
    path.resolve("node_modules/electron/dist/electron.exe"),
  args: process.env.MATHECA_EXE ? [] : [path.resolve(".vite/build/main.cjs")],
  env,
});
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("h1").waitFor();
  await page.evaluate(() => window.matheca.examples());
  const state = await page.evaluate(() => window.matheca.state()),
    id = state.questions[0].id;
  const image = path.join(env.MATHECA_TEST_DATA, "source.png");
  fs.copyFileSync(path.resolve("assets/vision-test.png"), image);
  const db = new Database(path.join(env.MATHECA_TEST_DATA, "library.sqlite"));
  const question = JSON.parse(
    db.prepare("SELECT data FROM questions WHERE id=?").get(id).data,
  );
  question.sourcePath = image;
  question.sourceLabel = "隔离验证原图";
  db.prepare("UPDATE questions SET data=? WHERE id=?").run(
    JSON.stringify(question),
    id,
  );
  db.close();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .webContents.send("state:changed"),
  );
  await page.waitForTimeout(450);
  const card = page.locator(`[data-question-id="${id}"]`);
  await card.click();
  await page.waitForTimeout(80);
  assert.ok(
    await page
      .locator(".editor-reveal")
      .evaluate((el) =>
        el.getAnimations().every((a) => a.playState !== "running"),
      ),
    "editor opens immediately without a transition",
  );
  await page.waitForTimeout(450);
  assert.ok(await page.locator(".editor").isVisible());
  assert.deepEqual(
    await page
      .locator(".editor-footer button")
      .evaluateAll((buttons) =>
        buttons.map(
          (button) => button.getAttribute("aria-label") || button.textContent,
        ),
      ),
    ["长按删除此题", "确认已校对"],
  );
  assert.equal(
    await page.getByRole("button", { name: "保存草稿", exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "长按删除此题", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page
      .locator(".editor-footer .editor-delete")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(255, 241, 242)",
  );
  await page.locator(".editor-footer .editor-delete").click();
  assert.ok(
    await page.locator(".editor").isVisible(),
    "short click does not delete",
  );
  assert.ok(
    await page.locator(".library-list").evaluate((el) => el.inert),
    "covered list is excluded from keyboard interaction",
  );

  assert.equal(
    await page.getByText("独立公式校对", { exact: true }).count(),
    0,
  );
  assert.ok(
    await page.evaluate(() => {
      const tags = document
        .querySelector(".editor-top-tags")
        .getBoundingClientRect();
      const preview = document
        .querySelector(".editor .preview")
        .getBoundingClientRect();
      const edit = document
        .querySelector(".editor textarea")
        .getBoundingClientRect();
      const source = document
        .querySelector(".editor .source-pane")
        .getBoundingClientRect();
      return (
        tags.bottom <= preview.top &&
        preview.bottom <= edit.top &&
        source.left >= preview.right
      );
    }),
    "tags, preview, edit ordered; original is on right",
  );
  assert.ok(
    await page
      .getByAltText("放大的题目原图", { exact: true })
      .evaluate((img) => img.complete && img.naturalWidth > 0),
  );
  const canvas = page.locator(".source-canvas");
  await canvas.focus();
  await canvas.press("+");
  assert.equal(
    await page.locator(".source-tools output").textContent(),
    "125%",
  );
  await canvas.press("ArrowRight");
  assert.ok(
    await page
      .getByAltText("放大的题目原图")
      .evaluate(
        (img) => new DOMMatrix(getComputedStyle(img).transform).m41 <= 0,
      ),
  );
  await canvas.press("0");
  assert.equal(
    await page.locator(".source-tools output").textContent(),
    "100%",
  );
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator(".source-tools output").textContent(),
    "115%",
  );
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 30,
    box.y + box.height / 2 + 20,
  );
  await page.mouse.up();
  assert.ok(
    await page.getByAltText("放大的题目原图").evaluate((img) => {
      const matrix = new DOMMatrix(getComputedStyle(img).transform),
        canvas = img.parentElement;
      const fit = Math.min(
        canvas.clientWidth / img.naturalWidth,
        canvas.clientHeight / img.naturalHeight,
      );
      return (
        Math.abs(matrix.m41) <=
          Math.abs(img.naturalWidth * fit * matrix.a - canvas.clientWidth) / 2 +
            1 &&
        Math.abs(matrix.m42) <=
          Math.abs(img.naturalHeight * fit * matrix.d - canvas.clientHeight) /
            2 +
            1
      );
    }),
    "drag stays inside image bounds",
  );
  assert.equal(
    await canvas.evaluate((el) =>
      el.dispatchEvent(
        new DragEvent("dragstart", { bubbles: true, cancelable: true }),
      ),
    ),
    false,
    "native drag is blocked",
  );
  const cropZoomBefore = await page
    .locator(".source-tools output")
    .textContent();
  const cropTransformBefore = await page
    .getByAltText("放大的题目原图")
    .evaluate((img) => getComputedStyle(img).transform);
  await page.getByRole("button", { name: "提取图形", exact: true }).click();
  assert.equal(
    await page.locator(".source-tools output").textContent(),
    cropZoomBefore,
    "entering crop preserves zoom",
  );
  assert.equal(
    await page
      .getByAltText("放大的题目原图")
      .evaluate((img) => getComputedStyle(img).transform),
    cropTransformBefore,
    "entering crop preserves image position",
  );
  const cropBox = await canvas.boundingBox();
  await page.mouse.move(
    cropBox.x + cropBox.width * 0.35,
    cropBox.y + cropBox.height * 0.3,
  );
  await page.mouse.down();
  await page.mouse.move(
    cropBox.x + cropBox.width * 0.65,
    cropBox.y + cropBox.height * 0.7,
  );
  await page.mouse.up();
  await page.getByRole("button", { name: "插入图形", exact: true }).click();
  await page
    .locator(".editor .preview")
    .getByAltText("题目图形 1", { exact: true })
    .waitFor();
  assert.ok(
    await page
      .locator(".editor .preview")
      .getByAltText("题目图形 1", { exact: true })
      .evaluate((img) => img.complete && img.naturalWidth > 8),
  );
  await page.screenshot({ path: "test-output/expanded-question-desktop.png" });
  const body = page.getByRole("textbox", { name: "题干与小题", exact: true });
  const value = (await body.inputValue()) + "\n展开保存测试";
  await body.fill(value);
  assert.ok(
    (await page.locator(".editor .preview").innerText()).includes(
      "展开保存测试",
    ),
  );
  await page.locator(".editor .preview").click();
  await page.waitForTimeout(600);
  assert.equal(await page.locator(".editor").count(), 0);
  assert.equal(
    await page.evaluate(
      async (id) =>
        (await window.matheca.state()).questions.find((q) => q.id === id)
          .body,
      id,
    ),
    value,
  );
  assert.equal(
    await page.evaluate(
      async (id) =>
        (await window.matheca.state()).questions.find((q) => q.id === id)
          .figures.length,
      id,
    ),
    1,
  );
  const figureCard = page.locator(`.question-card[data-question-id="${id}"]`);
  const cardFigure = figureCard.locator(".card-figures img");
  await cardFigure.scrollIntoViewIfNeeded();
  await cardFigure.evaluate((img) => img.decode());
  await page.waitForTimeout(500);
  assert.equal(await cardFigure.count(), 1);
  assert.ok(
    await cardFigure.evaluate((img) => img.naturalWidth > 8 && !img.draggable),
  );
  assert.ok(
    await figureCard.evaluate((card) => {
      const image = card
        .querySelector(".card-figures img")
        .getBoundingClientRect();
      const footer = card.querySelector(".card-footer").getBoundingClientRect();
      const rect = card.getBoundingClientRect();
      return (
        image.bottom <= footer.top &&
        image.right <= rect.right &&
        image.left >= rect.left
      );
    }),
    "saved figure fits in the question card above its footer",
  );
  assert.ok(
    await figureCard.evaluate((card) => {
      const next = card
        .closest(".masonry-item")
        .nextElementSibling?.querySelector(".question-card");
      return (
        !next ||
        next.getBoundingClientRect().top >= card.getBoundingClientRect().bottom
      );
    }),
    "image-loaded card does not overlap the following card",
  );
  await page.screenshot({ path: "test-output/question-card-with-figure.png" });
  await page.evaluate(async (id) => {
    await window.matheca.saveCollection({
      id: "figure-paper",
      title: "图形导出验证",
      createdAt: Date.now().toString(),
      paperTitle: "含图形题目",
      examInstructions: "",
      examMinutes: 0,
      totalScore: 0,
    });
    await window.matheca.addQuestions("figure-paper", [id]);
  }, id);
  await app.evaluate(({ dialog }, folder) => {
    dialog.showMessageBox = async () => ({ response: 0 });
    dialog.showSaveDialog = async (_window, options) => ({
      canceled: false,
      filePath: folder + "/" + options.defaultPath,
    });
  }, env.MATHECA_TEST_DATA);
  const exported = await page.evaluate(async () => ({
    pdf: await window.matheca.exportCollection("figure-paper", "pdf"),
    docx: await window.matheca.exportCollection("figure-paper", "docx"),
  }));
  assert.ok(
    fs.readFileSync(exported.pdf.path).includes(Buffer.from("/Subtype /Image")),
    "PDF contains extracted figure",
  );
  const entries = await new Promise((resolve, reject) =>
    yauzl.open(exported.docx.path, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const names = [];
      zip.on("entry", (entry) => {
        names.push(entry.fileName);
        zip.readEntry();
      });
      zip.on("end", () => resolve(names));
      zip.on("error", reject);
      zip.readEntry();
    }),
  );
  assert.ok(
    entries.some((name) => name.startsWith("word/media/")),
    "Word embeds figure images",
  );
  await cardFigure.click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.waitForTimeout(70);
  await card.click();
  await page.waitForTimeout(600);
  assert.ok(
    await page.locator(".editor").isVisible(),
    "closing animation can reverse safely",
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1024, 700),
  );
  await page.waitForTimeout(600);
  assert.ok(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth === innerWidth &&
        document.documentElement.scrollHeight === innerHeight,
    ),
  );
  await page.screenshot({ path: "test-output/expanded-question-minimum.png" });
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.waitForTimeout(600);
  await cardFigure.scrollIntoViewIfNeeded();
  assert.ok(
    await cardFigure.evaluate((img) => {
      const image = img.getBoundingClientRect(),
        card = img.closest(".question-card").getBoundingClientRect();
      return (
        image.width <= 360 &&
        image.height <= 240 &&
        image.left >= card.left &&
        image.right <= card.right
      );
    }),
    "figure fits the card at minimum window size",
  );
  await page.screenshot({
    path: "test-output/question-card-with-figure-minimum.png",
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await card.click();
  assert.ok(
    await page
      .locator(".editor-reveal")
      .evaluate((el) =>
        el.getAnimations().every((a) => a.playState !== "running"),
      ),
  );
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.waitForTimeout(100);
  await page
    .locator(".question-card")
    .filter({ has: page.locator(".card-review") })
    .nth(1)
    .click();
  assert.ok(
    await page.getByText("此题暂无来源原图", { exact: true }).isVisible(),
  );
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "设置与备份", exact: true })
    .click();
  await page.locator(".settings-page").waitFor();
  for (const [width, height, label] of [
    [1440, 940, "wide"],
    [1024, 700, "minimum"],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.isVisible())
          .setSize(size[0], size[1]),
      [width, height],
    );
    await page.waitForTimeout(300);
    assert.ok(
      await page
        .locator(".settings-page")
        .evaluate(
          (el) =>
            Math.abs(
              el.getBoundingClientRect().width -
                el.closest(".workspace").getBoundingClientRect().width,
            ) <= 1,
        ),
      "settings fills workspace width",
    );
    assert.ok(
      await page
        .locator(".settings-page")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
      "settings has no horizontal overflow",
    );
    assert.ok(
      await page
        .locator(".settings-page")
        .evaluate((el) =>
          getComputedStyle(el).scrollbarColor.includes("206, 206, 206"),
        ),
      "scrollbar uses muted light color",
    );
    await page.locator(".settings-page").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    assert.ok(
      await page
        .getByRole("button", { name: "导入 Windows 题库", exact: true })
        .isVisible(),
    );
    await page.locator(".settings-page").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({
      path: `test-output/settings-full-width-${label}.png`,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: card-origin expansion, metadata/preview/edit order, original on right, wheel/keyboard zoom, pan/reset, removed formula field, live preview, saved close/reopen, minimum window, reduced motion, source placeholder.",
  );
} finally {
  await app.close();
}
