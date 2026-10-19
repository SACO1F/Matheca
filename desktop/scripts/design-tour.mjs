// Temporary design-tour: captures per-page screenshots for the polish pass.
// Run: node scripts/design-tour.mjs   (writes to test-output/design-tour/)
import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";

const outDir = path.resolve("test-output", "design-tour");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const data = path.resolve("test-output", "tour-" + Date.now());
const env = { ...process.env, MATHECA_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({
  executablePath: path.resolve("node_modules/electron/dist/electron.exe"),
  args: ["--disable-gpu", "--no-sandbox", path.resolve(".vite/build/main.cjs")],
  env,
});

const proc = app.process();
proc.stderr?.on("data", (d) => console.log("APP-STDERR:", String(d).trim()));
proc.on("exit", (code) => console.log("APP-EXIT:", code));

const page = await app.firstWindow();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.waitForFunction(
  () => !!window.matheca && document.querySelector("h1"),
  { timeout: 30000 },
);
await page.evaluate(() => window.matheca.examples());
await page.waitForTimeout(600);

async function shot(name) {
  await page.waitForTimeout(650);
  await page.screenshot({ path: path.join(outDir, name + ".png") });
  console.log("captured", name);
}

async function nav(label) {
  await page.click(`.sidebar button[aria-label="${label}"]`);
  await page.waitForTimeout(450);
}

// 1. 题库: filtered heading should read 共 N 道题目 with no 清除筛选
await shot("01-library");

// 2. 题集 empty state (before seeding): should show CTA button
await nav("题集");
await shot("02-collections-empty");

// 3. seed one collection with questions, open its detail
await page.evaluate(async () => {
  const api = window.matheca;
  const state = await api.state();
  const ids = state.questions.slice(0, 3).map((q) => q.id);
  const c = {
    id: "tour-collection",
    title: "不等式练习",
    createdAt: new Date().toISOString(),
    paperTitle: "不等式小测",
    examInstructions: "",
    examMinutes: 60,
    totalScore: 100,
  };
  await api.saveCollection(c);
  await api.addQuestions(c.id, ids);
});
await nav("题库");
await nav("题集");
await page.getByText("不等式练习", { exact: true }).first().click();
await page.waitForTimeout(700);
await shot("03-collection-detail");

// 4. scroll question list to bottom: FAB must not cover the last card's buttons
await page.evaluate(() => {
  const el = document.querySelector(".collection-question-list");
  if (el) el.scrollTop = el.scrollHeight;
});
await shot("04-collection-detail-bottom");

// 5. tasks empty state should be vertically centered
await nav("任务");
await shot("05-tasks-empty");

// 6. settings: bottom of page must clear the FAB
await nav("设置与备份");
await page.evaluate(() => {
  const el = document.querySelector(".page-scroll");
  if (el) el.scrollTop = el.scrollHeight;
});
await shot("06-settings-bottom");

// 7. library scrolled to bottom: FAB clearance
await nav("题库");
await page.evaluate(() => {
  const el = document.querySelector(".cards");
  if (el) el.scrollTop = el.scrollHeight;
});
await shot("07-library-bottom");

// 8. filtered state: apply 仅收藏 to see 筛选结果 + 清除筛选
await page.evaluate(() => {
  const el = document.querySelector(".cards");
  if (el) el.scrollTop = 0;
});
await page.click(".favorite-filter");
await page.waitForTimeout(500);
await shot("08-library-filtered");

await app.close();
console.log("DONE");
