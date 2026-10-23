import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const output = path.resolve("test-output", "privacy-" + Date.now());
fs.mkdirSync(output, { recursive: true });
const exe = fs
  .readFileSync("releases/latest.txt", "utf8")
  .match(/^EXE: (.+)$/m)[1]
  .trim();
const env = { ...process.env, MATHECA_TEST_DATA: path.join(output, "data") };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: exe, env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("h1").waitFor();
  await page.route(/^https?:/, (route) => route.abort());
  await page.getByRole("button", { name: "设置与备份", exact: true }).click();
  const entry = page.getByRole("button", { name: "隐私政策", exact: true });
  await entry.click();
  const dialog = page.getByRole("dialog", {
    name: "Matheca 隐私政策",
    exact: true,
  });
  await dialog.waitFor();
  assert.equal(await dialog.locator("article section").count(), 9);
  assert.match(await dialog.innerText(), /HTTPS.*题目文字/s);
  assert.match(await dialog.innerText(), /HTTP.*没有 HTTPS/s);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1024, 720),
  );
  for (const theme of ["GRAPHITE", "BLUE", "CLAY", "PLUM"]) {
    await page.evaluate((theme) => window.matheca.setColorTheme(theme), theme);
    await page.waitForFunction(
      (theme) => document.documentElement.dataset.colorTheme === theme,
      theme,
    );
    await page.screenshot({ path: path.join(output, `privacy-${theme}.png`) });
  }
  await dialog.locator("article").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await dialog.getByRole("heading", { name: "政策更新与联系" }).waitFor();
  assert.equal(
    await dialog.evaluate(
      (element) => element.scrollHeight <= element.clientHeight + 1,
    ),
    true,
  );
  await page.screenshot({ path: path.join(output, "privacy-bottom.png") });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(
    await entry.evaluate((element) => element === document.activeElement),
    true,
  );
  await entry.click();
  assert.equal(
    await dialog.locator("article").evaluate((element) => element.scrollTop),
    0,
  );
  await app.evaluate(({ shell }) => {
    globalThis.privacyContact = "";
    shell.openExternal = async (url) => { globalThis.privacyContact = url; };
  });
  await dialog.getByRole("button", { name: "联系维护者" }).click();
  assert.equal(
    await app.evaluate(() => globalThis.privacyContact),
    "https://github.com/SACO1F/Matheca/issues",
  );
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, "RESULT.md"),
    `PASS: packaged EXE; isolated data; policy readable offline; nine sections; compact window and four accents; body scrolls with fixed footer; Escape/close/focus return; contact action.\nEXE: ${exe}\n`,
  );
  console.log("PASS: " + output);
} finally {
  await app.close();
}
