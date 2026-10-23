import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const output = path.resolve("test-output", "question-source-" + Date.now());
fs.mkdirSync(output, { recursive: true });
const exe = fs
  .readFileSync("releases/latest.txt", "utf8")
  .match(/^EXE: (.+)$/m)[1]
  .trim();
const env = { ...process.env, MATHECA_TEST_DATA: path.join(output, "data") };
delete env.ELECTRON_RUN_AS_NODE;
function seedSources(records) {
  // Source labels are immutable through the editor API. Seed imported provenance only in this isolated test database.
  execFileSync(
    process.env.MATHECA_QA_PYTHON ||
      "C:/Users/10052/AppData/Local/Programs/Python/Python312/python.exe",
    [
      "-c",
      `
import json, sqlite3, sys
payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
with sqlite3.connect(payload["file"]) as db:
    for record in payload["records"]:
        row = db.execute("SELECT data FROM questions WHERE id=?", (record["id"],)).fetchone()
        question = json.loads(row[0])
        question["sourceLabel"] = record["label"]
        db.execute("UPDATE questions SET data=? WHERE id=?", (json.dumps(question, ensure_ascii=False), record["id"]))
`,
    ],
    {
      input: JSON.stringify({
        file: path.join(env.MATHECA_TEST_DATA, "library.sqlite"),
        records,
      }),
    },
  );
}

let app;
try {
  app = await electron.launch({ executablePath: exe, env });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("h1").waitFor();
  const labels = await page.evaluate(async () => {
    await window.matheca.examples();
    const state = await window.matheca.state();
    const sample = state.questions[0];
    for (const q of state.questions) await window.matheca.deleteQuestion(q.id);
    const sources = [
      "高一函数专题.pdf · 第 2–3 页",
      "IMG_20261022_101530.jpg · 第 1 页",
      "手动录入",
    ];
    for (const [i, sourceLabel] of sources.entries()) {
      await window.matheca.saveQuestion({
        ...sample,
        id: "source-" + i,
        title: "来源验证" + i,
        body: "已知函数 f(x)=x²，求 f(2) 的值。",
        sourceLabel,
        example: false,
        createdAt: String(i + 1),
      });
    }
    await window.matheca.saveCollection({
      id: "source-c",
      title: "来源验证题集",
      createdAt: "1",
      paperTitle: "",
      examInstructions: "",
      examMinutes: 0,
      totalScore: 0,
    });
    await window.matheca.addQuestions("source-c", ["source-0"]);
    return sources;
  });
  seedSources(labels.map((label, i) => ({ id: "source-" + i, label })));
  await page.reload();
  await page.locator("h1").waitFor();
  const card = (id) =>
    page.locator(`.question-card[data-question-id="${id}"]`).first();
  for (const [i, label] of labels.entries()) {
    await card("source-" + i)
      .locator(".question-source")
      .waitFor();
    assert.equal(
      await card("source-" + i)
        .locator(".question-source")
        .innerText(),
      "来源：" + label,
    );
  }
  await page.screenshot({ path: path.join(output, "library.png") });
  await page.locator('.sidebar button[aria-label="题集"]').click();
  await page
    .locator(".collection-list .collection-card")
    .filter({ hasText: "来源验证题集" })
    .click();
  assert.equal(
    await card("source-0").locator(".question-source").innerText(),
    "来源：" + labels[0],
  );
  await page.screenshot({ path: path.join(output, "collection.png") });
  await page.getByRole("button", { name: "从题库添加", exact: true }).click();
  await page
    .locator('.question-card[data-question-id="source-1"] .question-source')
    .waitFor();
  assert.ok(
    (
      await page
        .locator('.question-card[data-question-id="source-1"] .question-source')
        .allTextContents()
    ).every((s) => s === "来源：" + labels[1]),
  );
  await page.getByRole("button", { name: "完成添加", exact: true }).click();
  await page.locator('.sidebar button[aria-label="题库"]').click();
  await page.getByRole("button", { name: "新建题目", exact: true }).click();
  await page.getByRole("menuitem", { name: "手机联动", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "手机联动", exact: true });
  await dialog.getByRole("tab", { name: "题库交换", exact: true }).click();
  await dialog.locator("summary").filter({ hasText: "选择题目" }).click();
  assert.equal(
    await dialog
      .locator('.question-card[data-question-id="source-0"] .question-source')
      .innerText(),
    "来源：" + labels[0],
  );
  await page.screenshot({ path: path.join(output, "exchange.png") });
  await page.keyboard.press("Escape");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1000, 720),
  );
  const source = card("source-0").locator(".question-source");
  const label = "函数专项复习资料".repeat(20) + ".pdf · 第 2–3 页";
  seedSources([{ id: "source-0", label }]);
  await page.reload();
  await page.waitForFunction(
    (label) =>
      document
        .querySelector('[data-question-id="source-0"] .question-source')
        ?.getAttribute("title") ===
      "来源：" + label,
    label,
  );
  assert.ok(await source.evaluate((e) => e.scrollWidth > e.clientWidth));
  assert.equal(await source.getAttribute("title"), "来源：" + label);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await source.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "compact-long-name.png") });
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, "RESULT.md"),
    `PASS: final portable EXE; isolated data; PDF/image/manual sources in library, collection, picker and exchange; long name tooltip, compact width and no page errors.\nEXE: ${exe}\n`,
  );
  console.log("PASS: " + output);
} finally {
  if (app) await app.close();
}
