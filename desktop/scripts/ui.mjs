import { _electron as electron } from "playwright";
import path from "node:path";
import assert from "node:assert/strict";
import fs from "node:fs";
import Database from "better-sqlite3";
const env = {
  ...process.env,
  MATHECA_TEST_DATA: path.resolve("test-output", "masonry-" + Date.now()),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath:
    process.env.MATHECA_EXE ??
    path.resolve("node_modules/electron/dist/electron.exe"),
  args: [
    ...(process.env.MATHECA_EXE
      ? []
      : [path.resolve(".vite/build/main.cjs")]),
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
  ],
  env,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("h1").waitFor();
  assert.deepEqual(
    await page.evaluate(() => {
      const bar = document.querySelector(".window-titlebar");

      return {
        height: bar.getBoundingClientRect().height,
        text: bar.textContent.trim(),
        brand: bar.querySelector("img, .brand") !== null,
        drag: getComputedStyle(bar).webkitAppRegion,

        sidebarToggle: document.querySelector(".sidebar-toggle") !== null,
        icons: document.querySelectorAll(".sidebar .nav-icon").length,
        overlay: navigator.windowControlsOverlay.visible,
      };
    }),
    {
      height: 36,
      text: "",
      brand: false,
      drag: "drag",

      sidebarToggle: false,
      icons: 5,
      overlay: true,
    },
    "blank title bar has a clickable menu toggle and native window controls",
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .maximize(),
  );
  await page.waitForTimeout(300);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .unmaximize(),
  );
  await page.waitForTimeout(300);
  assert.ok(
    await app.evaluate(
      ({ Menu, BrowserWindow }) =>
        Menu.getApplicationMenu() === null &&
        !BrowserWindow.getAllWindows()
          .find((w) => w.isVisible())
          .isMenuBarVisible(),
    ),
    "native menu removed",
  );
  await page.keyboard.press("Alt");
  assert.ok(
    await app.evaluate(
      ({ BrowserWindow }) =>
        !BrowserWindow.getAllWindows()
          .find((w) => w.isVisible())
          .isMenuBarVisible(),
    ),
    "Alt cannot reveal a hidden menu",
  );
  assert.equal(
    await page
      .locator(".sidebar")
      .evaluate((el) => el.getBoundingClientRect().width),
    52,
    "fixed icon rail",
  );
  assert.equal(
    await page.locator(".sidebar").innerText(),
    "",
    "rail contains only icons",
  );
  await page.evaluate(() => window.matheca.examples());
  await page.evaluate(async () => {
    const s = await window.matheca.state();
    const base = s.questions[0];
    for (let i = 0; i < 15; i++) {
      await window.matheca.saveQuestion(
        {
          ...base,
          id: "masonry-" + i,
          title: "瀑布流验证 " + i,
          body:
            "已知函数 \\(f(x)=x^2-2x+3\\)，研究函数的性质。\n" +
            Array.from(
              { length: (i % 5) + 1 },
              (_, j) =>
                "（" +
                (j + 1) +
                "）求函数的最小值，写出完整推导过程。".repeat((i % 3) + 1),
            ).join("\n") +
            "\n完整题干终点 " +
            i,
          sourcePath: "",
          reviewed: false,
          favorite: i % 2 === 0,
        },
        false,
      );
    }
  });
  const image = path.join(env.MATHECA_TEST_DATA, "source-preview.png");
  fs.copyFileSync(path.resolve("assets/vision-test.png"), image);
  const fixtureDb = new Database(
    path.join(env.MATHECA_TEST_DATA, "library.sqlite"),
  );
  try {
    const row = fixtureDb
      .prepare("SELECT data FROM questions WHERE id=?")
      .get("masonry-0");
    const question = JSON.parse(row.data);
    question.sourcePath = image;
    question.sourceLabel = "隔离测试来源图片";
    fixtureDb
      .prepare("UPDATE questions SET data=? WHERE id=?")
      .run(JSON.stringify(question), question.id);
  } finally {
    fixtureDb.close();
  }
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .webContents.send("state:changed"),
  );
  await page.waitForTimeout(450);
  async function check(expectedColumns) {
    await page.waitForFunction(
      () => !document.querySelector(".masonry-grid[data-moving]"),
      { timeout: 5000 },
    );
    const r = await page.evaluate(() => {
      const cards = [
        ...document.querySelectorAll(".masonry-grid .question-card"),
      ];
      return {
        columns: getComputedStyle(
          document.querySelector(".masonry-grid"),
        ).gridTemplateColumns.split(" ").length,
        rects: cards.map((e) => {
          const b = e.getBoundingClientRect();
          const p = e.querySelector(".card-preview");
          return {
            left: b.left,
            right: b.right,
            top: b.top,
            bottom: b.bottom,
            height: b.height,
            textHeight: p.clientHeight,
            textScroll: p.scrollHeight,
          };
        }),
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        height: innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
      };
    });
    assert.equal(r.width, r.scrollWidth);
    assert.equal(r.height, r.scrollHeight);
    if (expectedColumns) assert.equal(r.columns, expectedColumns);
    assert.ok(new Set(r.rects.map((e) => e.height)).size >= 3);
    assert.equal(r.columns, 1, "question list stays single-column");
    assert.ok(
      r.rects.every(
        (rect, index) => index === 0 || rect.top >= r.rects[index - 1].bottom,
      ),
      "list follows DOM order vertically",
    );
    for (let i = 0; i < r.rects.length; i++) {
      const a = r.rects[i];
      assert.equal(a.textHeight, a.textScroll, "full question visible");
      for (const b of r.rects.slice(i + 1)) {
        assert.ok(
          a.right <= b.left + 1 ||
            b.right <= a.left + 1 ||
            a.bottom <= b.top + 1 ||
            b.bottom <= a.top + 1,
          "cards overlap",
        );
      }
    }
    console.log(
      "Masonry:",
      r.columns,
      "columns,",
      r.rects.length,
      "cards, full text and no overlap",
    );
  }
  await check(1);
  assert.equal(
    await page.locator(".question-card h3").count(),
    0,
    "card titles removed",
  );
  assert.ok(
    await page
      .locator(".card-preview")
      .evaluateAll((elements) =>
        elements.every((e) => Number(getComputedStyle(e).fontWeight) >= 700),
      ),
    "question bodies are bold",
  );
  assert.ok(
    await page.locator(".question-card").evaluateAll((cards) =>
      cards.every((card) => {
        const top = card.querySelector(".card-top").getBoundingClientRect();
        const body = card
          .querySelector(".card-preview")
          .getBoundingClientRect();
        const footer = card
          .querySelector(".card-footer")
          .getBoundingClientRect();
        return (
          top.bottom <= body.top + 1 &&
          body.bottom <= footer.top + 1 &&
          card.querySelector(".card-actions input[type=checkbox]") &&
          card.querySelector(".card-review")
        );
      }),
    ),
    "cards use metadata/body/footer layout with existing selection",
  );
  await page.screenshot({ path: "test-output/masonry-wide.png" });
  const selectors = page.locator(".library-filters [role=combobox]");
  assert.equal(await selectors.count(), 5);
  const selectorRows = await selectors.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().top),
  );
  assert.ok(
    selectorRows.every((top) => Math.abs(top - selectorRows[0]) < 1),
    "five selectors share one row",
  );
  assert.equal(
    await page
      .locator(".stats")
      .getByRole("checkbox", { name: "仅收藏" })
      .count(),
    1,
  );
  const rowOrder = await page.evaluate(() => {
    const counts = document
      .querySelector(".stat-counts")
      .getBoundingClientRect();
    const filters = document
      .querySelector(".library-filters")
      .getBoundingClientRect();
    const favorite = document
      .querySelector(".favorite-filter")
      .getBoundingClientRect();
    return (
      counts.right <= filters.left &&
      filters.right <= favorite.left &&
      Math.abs(counts.top - favorite.top) < 12
    );
  });
  assert.ok(rowOrder, "filters follow counts and precede favorites");
  assert.equal(await page.getByText(/未选择/).count(), 0);
  await page.getByRole("combobox", { name: "年级", exact: true }).click();
  await page.waitForTimeout(70);
  const popOpacity = await page
    .getByRole("listbox", { name: "年级", exact: true })
    .evaluate((e) => Number(getComputedStyle(e).opacity));
  assert.ok(popOpacity > 0 && popOpacity < 1, "dropdown opening animates");
  await page.getByRole("option", { name: "高二", exact: true }).hover();
  await page.waitForTimeout(250);
  assert.ok(
    (await page
      .locator(".glide-highlight")
      .evaluate((e) => getComputedStyle(e).transform)) !== "none",
    "highlight glides to hovered option",
  );
  await page
    .getByRole("combobox", { name: "年级", exact: true })
    .press("Escape");
  await page.waitForTimeout(220);
  await page.getByRole("combobox", { name: "知识点", exact: true }).click();
  await page
    .getByRole("combobox", { name: "知识点", exact: true })
    .press("End");
  await page
    .getByRole("combobox", { name: "知识点", exact: true })
    .press("Enter");
  assert.equal(
    await page
      .getByRole("combobox", { name: "知识点", exact: true })
      .getAttribute("aria-expanded"),
    "false",
  );
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await page.waitForTimeout(450);
  await page.getByRole("checkbox", { name: "仅收藏" }).check();
  await page.waitForTimeout(450);
  assert.equal(await page.locator(".question-card").count(), 8);
  await page.getByRole("checkbox", { name: "仅收藏" }).uncheck();
  await page.getByRole("combobox", { name: "校对状态", exact: true }).click();
  await page.getByRole("option", { name: "待校对", exact: true }).click();
  await page.waitForTimeout(450);
  assert.equal(await page.locator(".question-card").count(), 15);
  await page.getByRole("combobox", { name: "校对状态", exact: true }).click();
  await page.getByRole("option", { name: "全部状态", exact: true }).click();
  await page.getByRole("button", { name: "搜索题目", exact: true }).click();
  await page.waitForTimeout(450);
  assert.ok(
    (
      await page
        .locator(".search-reveal")
        .evaluate((e) => getComputedStyle(e).transitionTimingFunction)
    ).includes("ease-in-out"),
  );
  await page.getByRole("button", { name: "搜索题目", exact: true }).click();
  await page.waitForTimeout(450);
  async function editorCycle() {
    await page.locator(".cards").evaluate((e) => {
      e.scrollTop = 180;
    });
    const listWidth = await page
      .locator(".library-list")
      .evaluate((e) => e.clientWidth);
    const scrollportWidth = await page
      .locator(".cards")
      .evaluate((e) => e.clientWidth);
    const samples = await page.evaluate(async () => {
      document.querySelector(".question-card").click();
      while (!document.querySelector(".editor-reveal.open"))
        await new Promise(requestAnimationFrame);
      // Force the initial CSS style before recording compositor frames.
      getComputedStyle(document.querySelector(".editor-reveal")).opacity;
      const start = performance.now(),
        frames = [];
      do {
        await new Promise(requestAnimationFrame);
        const card = document.querySelector(".question-card.active");
        frames.push({
          elapsed: performance.now() - start,
          width: card.getBoundingClientRect().width,
          transform: getComputedStyle(card).transform,
          list: document.querySelector(".library-list").clientWidth,
          opacity: Number(
            getComputedStyle(document.querySelector(".editor-reveal")).opacity,
          ),
          moving:
            document.querySelector(".masonry-grid").dataset.moving === "true",
        });
      } while (performance.now() - start < 300);
      return frames;
    });
    const pane = page.locator(".editor-reveal");
    const workspaceWidth = await page
      .locator(".workspace")
      .evaluate((e) => e.clientWidth);
    assert.ok(
      samples.some((frame) => frame.opacity > 0 && frame.opacity < 1),
      "opening animates",
    );
    assert.ok(
      samples.every((frame) => frame.transform === "none"),
      "text is never transformed or scaled",
    );
    if (workspaceWidth > 640) {
      assert.ok(
        samples.some((frame) => frame.list < listWidth),
        "left container progressively narrows",
      );
      assert.ok(
        new Set(samples.map((frame) => frame.list)).size > 2,
        "container width changes continuously",
      );
      assert.ok(
        samples.some((frame) => frame.moving),
        "shared FLIP clock runs",
      );
      assert.equal(
        await page
          .locator(".masonry-grid")
          .evaluate(
            (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
          ),
        1,
      );
    }
    assert.equal(
      await page.locator(".cards").evaluate((e) => e.clientWidth),
      scrollportWidth,
      "departing columns are not clipped",
    );
    await page.waitForTimeout(650);
    if (workspaceWidth > 640) await check(1);
    const center = await page.locator(".question-card.active").evaluate((e) => {
      const rect = e.getBoundingClientRect(),
        grid = e.closest(".masonry-grid").getBoundingClientRect(),
        port = e.closest(".cards").getBoundingClientRect();
      return [
        Math.abs((rect.left + rect.right) / 2 - (grid.left + grid.right) / 2),
        Math.abs(rect.top - port.top - 8),
      ];
    });
    if (workspaceWidth > 640)
      assert.ok(
        center.every((distance) => distance < 2),
        "selected card starts at the top without cropping: " + center,
      );
    await page.screenshot({ path: "test-output/focused-proofreading.png" });
    assert.equal(
      await page
        .getByRole("textbox", { name: "题目标题", exact: true })
        .count(),
      0,
    );
    const selectedId = await page
      .locator(".question-card.active")
      .getAttribute("data-question-id");
    const originalTitle = (
      await page.evaluate(() => window.matheca.state())
    ).questions.find((q) => q.id === selectedId).title;
    const body = page.getByRole("textbox", { name: "题干与小题", exact: true });
    const savedBody = (await body.inputValue()) + "\n保存与关闭动画验证";
    await body.fill(savedBody);
    await page
      .getByRole("button", { name: "关闭题目校对", exact: true })
      .click();
    assert.equal(await pane.count(), 1, "pane stays mounted during closing");
    const closingWidth = await pane.evaluate((e) => e.clientWidth);
    await page.waitForTimeout(80);
    const opacity = await pane.evaluate((e) =>
      Number(getComputedStyle(e).opacity),
    );
    assert.ok(opacity > 0 && opacity < 1, "closing animates");
    assert.equal(
      await pane.evaluate((e) => e.clientWidth),
      closingWidth,
      "closing pane content keeps its width",
    );
    await page.waitForTimeout(550);
    assert.equal(await pane.count(), 0, "pane removed after closing");
    const afterClose = await page
      .locator(".question-card.active")
      .evaluate((e) => {
        const card = e.getBoundingClientRect(),
          viewport = e.closest(".cards").getBoundingClientRect();
        return {
          top: card.top - viewport.top,
          bottom: card.bottom - viewport.top,
          height: card.height,
          available: viewport.height,
        };
      });
    assert.ok(
      Math.abs(afterClose.top - 8) < 2,
      "selected card stays at the top after closing: " + afterClose.top,
    );
    if (afterClose.height <= afterClose.available - 8)
      assert.ok(
        afterClose.bottom <= afterClose.available + 1,
        "a fitting card remains fully visible",
      );
    const saved = (
      await page.evaluate(() => window.matheca.state())
    ).questions.find((q) => q.id === selectedId);
    assert.equal(saved.body, savedBody);
    assert.equal(saved.title, originalTitle, "hidden title data preserved");
  }
  await editorCycle();
  await check(1);
  // Source image now uses a bounded thumbnail, while full-size viewing works.
  await page.locator('[data-question-id="masonry-0"]').dispatchEvent("click");
  await page.getByAltText("题目来源原图", { exact: true }).waitFor();
  await page.waitForTimeout(550);
  const source = await page
    .getByAltText("题目来源原图", { exact: true })
    .evaluate((img) => {
      const rect = img.getBoundingClientRect(),
        pane = img.closest(".source-pane").getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        paneHeight: pane.height,
        loaded: img.complete && img.naturalWidth > 0,
      };
    });
  assert.ok(source.loaded, "local source image loads");
  assert.ok(
    source.width <= 120 && source.height <= 72 && source.paneHeight <= 128,
    "source preview stays compact",
  );
  await page.screenshot({ path: "test-output/compact-source-top.png" });
  await page.getByRole("button", { name: "对照查看", exact: true }).click();
  await page.getByAltText("放大的题目原图", { exact: true }).waitFor();
  await page.waitForTimeout(550);
  assert.equal(
    await page.locator(".modal-backdrop").count(),
    0,
    "original image never obscures the whole window",
  );
  const comparison = await page.evaluate(() => {
    const image = document
      .querySelector(".source-canvas")
      .getBoundingClientRect();
    const preview = document
      .querySelector(".editor-scroll .preview")
      .getBoundingClientRect();
    return (
      image.width > 120 && image.right <= preview.left && image.height > 200
    );
  });
  assert.ok(
    comparison,
    "wide comparison shows enlarged image beside editable preview",
  );
  await page.getByRole("button", { name: "放大原图", exact: true }).click();
  assert.equal(
    await page.locator(".source-tools output").textContent(),
    "125%",
  );
  const canvas = page.locator(".source-canvas");
  await canvas.focus();
  await canvas.press("ArrowRight");
  assert.ok(
    (
      await page
        .getByAltText("放大的题目原图", { exact: true })
        .evaluate((e) => e.style.transform)
    ).includes("-24px"),
    "keyboard pans the image",
  );
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 40,
    box.y + box.height / 2 + 20,
  );
  await page.mouse.up();
  assert.ok(
    (
      await page
        .getByAltText("放大的题目原图", { exact: true })
        .evaluate((e) => e.style.transform)
    ).includes("16px"),
    "pointer drag pans the image",
  );
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator(".source-tools output").textContent(),
    "140%",
  );
  await page.getByRole("button", { name: "适应窗口", exact: true }).click();
  assert.equal(
    await page.locator(".source-tools output").textContent(),
    "100%",
  );
  await page.screenshot({ path: "test-output/source-comparison.png" });
  // Narrow the real test window while comparison remains open.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1024, 700),
  );
  await page.waitForTimeout(700);
  const stacked = await page.evaluate(() => {
    const source = document
        .querySelector(".source-pane")
        .getBoundingClientRect(),
      editor = document.querySelector(".editor-scroll").getBoundingClientRect();
    return (
      (source.bottom <= editor.top + 1 || source.right <= editor.left + 1) &&
      editor.height > 180 &&
      source.height >= 140
    );
  });
  assert.ok(stacked, "minimum window keeps comparison and editing visible");
  await page.locator(".editor-scroll .preview").scrollIntoViewIfNeeded();
  assert.ok(
    await page.evaluate(() => {
      const image = document
          .querySelector(".source-canvas")
          .getBoundingClientRect(),
        preview = document
          .querySelector(".editor-scroll .preview")
          .getBoundingClientRect();
      return (
        image.height > 90 &&
        (preview.top >= image.bottom || preview.left >= image.right) &&
        preview.bottom <= innerHeight
      );
    }),
    "narrow window can show the original and question preview together",
  );
  await page.screenshot({ path: "test-output/source-comparison-narrow.png" });
  await page.getByRole("button", { name: "收起对照", exact: true }).click();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1440, 940),
  );
  await page.waitForTimeout(650);
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  const closeTop = await page.evaluate(async () => {
    const positions = [];
    for (let i = 0; i < 8; i++) {
      await new Promise(requestAnimationFrame);
      const card = document.querySelector(".question-card.active");
      positions.push(
        card.getBoundingClientRect().top -
          card.closest(".cards").getBoundingClientRect().top,
      );
    }
    return positions;
  });
  assert.ok(
    closeTop.every((top) => Math.abs(top - 8) < 2),
    "last card stays at top during closing: " + closeTop,
  );
  await page.waitForTimeout(550);
  // Switching questions must preserve the panel and single-column layout.
  await page.locator(".question-card").first().dispatchEvent("click");
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__panel = document.querySelector(".editor-reveal");
    window.__editorBody = document.querySelector(".editor-body");
  });
  const nextId = await page
    .locator(".question-card")
    .nth(2)
    .getAttribute("data-question-id");
  await page.locator(".question-card").nth(2).dispatchEvent("click");
  await page.waitForTimeout(120);
  assert.ok(
    await page.evaluate(
      () =>
        window.__panel === document.querySelector(".editor-reveal") &&
        window.__editorBody === document.querySelector(".editor-body"),
    ),
    "panel and body stay mounted when switching",
  );
  assert.equal(
    await page
      .locator(".question-card.active")
      .getAttribute("data-question-id"),
    nextId,
  );
  assert.ok(
    await page
      .locator(".editor-body")
      .evaluate((e) =>
        e.getAnimations().some((a) => a.playState === "running"),
      ),
    "content fades when switching",
  );
  await page.waitForTimeout(500);
  await check(1);
  // Clicking the current card during a pending switch now closes the panel;
  // reopening must cancel the previous fade and restore full opacity.
  await page.evaluate(() => {
    document.querySelectorAll(".question-card")[3].click();
    setTimeout(
      () => document.querySelector(".question-card.active").click(),
      30,
    );
  });
  await page.waitForTimeout(450);
  assert.equal(
    await page
      .locator(".question-card.active")
      .getAttribute("data-question-id"),
    nextId,
  );
  assert.equal(
    await page.locator(".editor").count(),
    0,
    "current-card click cancels switch and closes panel",
  );
  await page.locator(".question-card.active").dispatchEvent("click");
  await page.waitForTimeout(500);
  assert.equal(
    await page
      .locator(".editor-body")
      .evaluate((e) => Number(getComputedStyle(e).opacity)),
    1,
    "cancelled switch restores opacity",
  );
  await page.locator(".question-card").nth(3).dispatchEvent("click");
  await page.locator(".question-card").nth(4).dispatchEvent("click");
  const lastId = await page
    .locator(".question-card")
    .nth(5)
    .getAttribute("data-question-id");
  await page.locator(".question-card").nth(5).dispatchEvent("click");
  await page.waitForTimeout(600);
  assert.equal(
    await page
      .locator(".question-card.active")
      .getAttribute("data-question-id"),
    lastId,
    "last click wins",
  );
  await page
    .getByRole("textbox", { name: "题干与小题", exact: true })
    .fill("动态高度验证。".repeat(200));
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.waitForTimeout(600);
  await check(1);
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.waitForTimeout(550);
  await page.locator(".question-card").first().dispatchEvent("click");
  await page.waitForTimeout(70);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1150, 780),
  );
  await page.waitForTimeout(700);
  await check(1);
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.waitForTimeout(550);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1440, 940),
  );
  await page.waitForTimeout(550);
  // Reverse both directions before either layout animation has completed.
  await page.locator(".question-card").first().dispatchEvent("click");
  await page.locator(".editor-reveal.open").waitFor();
  await page.waitForTimeout(55);
  await page
    .getByRole("button", { name: "关闭题目校对", exact: true })
    .dispatchEvent("click");
  await page.waitForTimeout(40);
  const reversalId = await page
    .locator(".question-card")
    .nth(1)
    .getAttribute("data-question-id");
  await page.locator(".question-card").nth(1).dispatchEvent("click");
  await page.waitForTimeout(650);
  assert.equal(
    await page
      .locator(".question-card.active")
      .getAttribute("data-question-id"),
    reversalId,
  );
  assert.equal(await page.locator(".editor-reveal.open").count(), 1);
  await check(1);
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.waitForTimeout(550);
  // Reopening while a close is still in progress must cancel its removal.
  await page.locator(".question-card").first().click();
  await page.waitForTimeout(450);
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.waitForTimeout(60);
  await page.locator(".question-card").last().click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".editor-reveal.open").count(), 1);
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.waitForTimeout(450);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(1024, 700),
  );
  await page.waitForTimeout(450);
  const minimumOrder = await page.evaluate(() => {
    const counts = document
        .querySelector(".stat-counts")
        .getBoundingClientRect(),
      filters = document
        .querySelector(".library-filters")
        .getBoundingClientRect(),
      favorite = document
        .querySelector(".favorite-filter")
        .getBoundingClientRect();
    return (
      counts.right <= filters.left &&
      filters.right <= favorite.left &&
      favorite.right <= innerWidth
    );
  });
  assert.ok(
    minimumOrder,
    "compact filters fit in the stats row at minimum size",
  );
  const minimumRows = await selectors.evaluateAll((elements) =>
    elements.map((e) => e.getBoundingClientRect().top),
  );
  assert.ok(
    minimumRows.every((top) => Math.abs(top - minimumRows[0]) < 1),
    "five selectors share one row at minimum size",
  );
  await check(1);
  await page.screenshot({ path: "test-output/masonry-minimum.png" });
  await editorCycle();
  await check(1);
  // Exercise the existing overlay breakpoint in an isolated test window.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) => w.isVisible());
    w.setMinimumSize(640, 620);
    w.setSize(680, 700);
  });
  await page.waitForTimeout(550);
  assert.ok(
    await page.locator(".workspace").evaluate((e) => e.clientWidth <= 640),
  );
  await page.locator(".question-card").first().focus();
  await page.locator(".question-card").first().press("Enter");
  await page.waitForTimeout(550);
  assert.equal(
    await page.locator(".editor-reveal.open").count(),
    1,
    "keyboard opens overlay",
  );
  const overlay = await page.evaluate(() => {
    const pane = document
        .querySelector(".editor-reveal")
        .getBoundingClientRect(),
      grid = document.querySelector(".masonry-grid").getBoundingClientRect();
    return Math.abs(pane.width - grid.width) < 20;
  });
  assert.ok(overlay, "small viewport uses full-width overlay");
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.waitForTimeout(550);
  await check();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".question-card").first().click();
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click();
  await page.waitForTimeout(50);
  assert.equal(await page.locator(".editor-reveal").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Continuous split, position-only FLIP, content switching, latest click, dynamic heights, top alignment and compact source preview, resize, reversal, persistence and reduced motion: PASS",
  );
} finally {
  await app.close();
}
