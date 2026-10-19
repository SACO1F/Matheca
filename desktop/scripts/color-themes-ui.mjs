import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const output = path.resolve("test-output", `color-themes-${Date.now()}`);
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
}
const nav = (name) =>
  page.locator(".sidebar").getByRole("button", { name, exact: true }).click();
const luminance = (rgb) =>
  rgb
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const color = (value) =>
  value.startsWith("#")
    ? value
        .slice(1)
        .match(/../g)
        .map((v) => parseInt(v, 16))
    : value
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number);
const ratio = (a, b) => {
  const x = luminance(color(a)),
    y = luminance(color(b));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const evidence = [];
try {
  await launch();
  await page.evaluate(() => window.matheca.examples());
  await nav("设置与备份");
  assert.ok(
    await page.getByRole("radio", { name: "石墨", exact: true }).isChecked(),
  );
  const before = await page
    .evaluate(() => window.matheca.state())
    .then((s) => s.settings);
  await page
    .getByRole("textbox", { name: "接口地址", exact: true })
    .fill("https://draft.example/v1");
  for (const [id, name] of [
    ["GRAPHITE", "石墨"],
    ["BLUE", "雾蓝"],
    ["CLAY", "陶土"],
    ["PLUM", "梅紫"],
  ]) {
    const radio = page.getByRole("radio", { name, exact: true });
    await radio.click();
    await page.waitForFunction(
      (id) => document.documentElement.dataset.colorTheme === id,
      id,
    );
    await page.waitForFunction(
      () => !document.querySelector(".theme-option input:disabled"),
    );
    assert.equal(
      await page
        .getByRole("textbox", { name: "接口地址", exact: true })
        .inputValue(),
      "https://draft.example/v1",
    );
    const stored = (await page.evaluate(() => window.matheca.state())).settings;
    assert.equal(stored.address, before.address);
    assert.equal(stored.model, before.model);
    assert.equal(stored.hasApiKey, before.hasApiKey);
    const tokens = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return Object.fromEntries(
        [
          "--blue",
          "--primary-hover",
          "--accent-soft",
          "--accent-ink",
          "--focus",
          "--text",
          "--success-ink",
          "--warning-ink",
        ].map((k) => [k, s.getPropertyValue(k).trim()]),
      );
    });
    await page.mouse.move(700, 80);
    await page.waitForFunction((hex) => {
      const rgb = hex
        .slice(1)
        .match(/../g)
        .map((value) => parseInt(value, 16));
      return (
        getComputedStyle(document.querySelector(".fab")).backgroundColor ===
        `rgb(${rgb.join(", ")})`
      );
    }, tokens["--blue"]);
    assert.ok(ratio(tokens["--blue"], "#ffffff") >= 4.5);
    assert.ok(ratio(tokens["--primary-hover"], "#ffffff") >= 4.5);
    assert.ok(ratio(tokens["--accent-ink"], tokens["--accent-soft"]) >= 4.5);
    assert.ok(ratio(tokens["--text"], tokens["--accent-soft"]) >= 4.5);
    assert.ok(ratio(tokens["--focus"], "#ffffff") >= 3);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 940),
    );
    await radio.focus();
    assert.ok(await radio.evaluate((el) => document.activeElement === el));
    await page.screenshot({
      path: path.join(output, `${id}-settings-wide.png`),
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1024, 700),
    );
    await page.screenshot({
      path: path.join(output, `${id}-settings-compact.png`),
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 940),
    );
    await nav("题库");
    await page.mouse.move(700, 80);
    await page.waitForTimeout(350);
    const primary = await page
      .locator(".fab")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.ok(ratio(primary, "#ffffff") >= 4.5);
    await page.screenshot({ path: path.join(output, `${id}-library.png`) });
    evidence.push({
      id,
      name,
      primaryContrast: ratio(tokens["--blue"], "#ffffff"),
      selectionContrast: ratio(tokens["--accent-ink"], tokens["--accent-soft"]),
      success: tokens["--success-ink"],
      warning: tokens["--warning-ink"],
    });
    await nav("设置与备份");
  }
  assert.equal(new Set(evidence.map((x) => x.success)).size, 1);
  assert.equal(new Set(evidence.map((x) => x.warning)).size, 1);
  await page.getByRole("radio", { name: "梅紫", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(
    () => document.documentElement.dataset.colorTheme === "CLAY",
  );
  await page.evaluate(() =>
    window.matheca.saveSettings({
      theme: "LIGHT",
      address: "",
      model: "",
      autoSolveImports: false,
    }),
  );
  assert.equal(
    (await page.evaluate(() => window.matheca.state())).settings.colorTheme,
    "CLAY",
  );
  assert.match(
    await page.evaluate(async () => {
      try {
        await window.matheca.setColorTheme("invalid");
        return "";
      } catch (e) {
        return e.message;
      }
    }),
    /主题色设置无效/,
  );
  await app.close();
  app = undefined;
  await launch();
  await page.waitForFunction(
    () => document.documentElement.dataset.colorTheme === "CLAY",
  );
  await nav("设置与备份");
  assert.ok(
    await page.getByRole("radio", { name: "陶土", exact: true }).isChecked(),
  );
  await page.getByRole("radio", { name: "石墨", exact: true }).click();
  await page.waitForFunction(
    () => document.documentElement.dataset.colorTheme === "GRAPHITE",
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, "EVIDENCE.md"),
    "# 主题验收\n\n四套主题在1440×940、1024×700设置页及题库的截图。选择即时持久化；未保存接口草稿不丢失，不写入接口配置；保存接口不重置颜色；方向键切换、非法值拒绝、重启记忆、恢复石墨通过。\n\n" +
      evidence
        .map(
          (x) =>
            `- ${x.name}: 主按钮白字 ${x.primaryContrast.toFixed(2)}:1，选中色文字 ${x.selectionContrast.toFixed(2)}:1。`,
        )
        .join("\n"),
  );
  console.log(
    "PASS: four palettes, computed contrast, keyboard, settings isolation, persistence after restart, invalid values and reset. " +
      output,
  );
} finally {
  await app?.close();
}
