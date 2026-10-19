import { _electron as electron } from "playwright";
import path from "node:path";
import assert from "node:assert/strict";
const phase = process.argv[2],
  executablePath = process.argv[3];
const env = {
  ...process.env,
  MATHECA_TEST_DATA: path.resolve("test-output/upgrade-appdata"),
};
delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({ executablePath, env });
try {
  const page = await application.firstWindow();
  await page.waitForFunction(
    () => !!window.matheca && document.querySelector("h1"),
  );
  if (phase === "seed") {
    await page.evaluate(async () => {
      await window.matheca.examples();
      const state = await window.matheca.state();
      const question = {
        ...state.questions[0],
        id: "upgrade-probe",
        body: "更新保留：中文 😀，公式 \\(x^2=1\\)。",
        title: "升级验证",
        favorite: true,
        autoSolve: false,
      };
      await window.matheca.saveQuestion(question, true);
      await window.matheca.saveCollection({
        id: "upgrade-paper",
        title: "升级题集",
        createdAt: Date.now().toString(),
        paperTitle: "升级文档设置",
        examInstructions: "更新后应保留",
        examMinutes: 60,
        totalScore: 120,
      });
      await window.matheca.addQuestions("upgrade-paper", [
        question.id,
        state.questions[0].id,
      ]);
      await window.matheca.addKnowledge({
        group: "函数",
        name: "升级自定义知识点",
      });
      await window.matheca.saveSettings({
        address: "https://upgrade-test.invalid/v1",
        model: "test-model",
        apiKey: "upgrade-test-key",
        theme: "DARK",
        autoSolveImports: false,
      });
    });
  } else {
    const state = await page.evaluate(() => window.matheca.state());
    assert.equal(state.questions.length, 4);
    assert.equal(
      state.questions.find((q) => q.id === "upgrade-probe").body,
      "更新保留：中文 😀，公式 \\(x^2=1\\)。",
    );
    assert.equal(
      state.questions.find((q) => q.id === "upgrade-probe").favorite,
      true,
    );
    assert.equal(
      state.collections.find((c) => c.id === "upgrade-paper").examMinutes,
      60,
    );
    assert.deepEqual(
      state.items
        .filter((i) => i.collectionId === "upgrade-paper")
        .map((i) => i.questionId)[0],
      "upgrade-probe",
    );
    assert.equal(state.customKnowledge[0].name, "升级自定义知识点");
    assert.equal(state.settings.theme, "LIGHT");
    assert.equal(state.settings.hasApiKey, true);
    assert.ok(!JSON.stringify(state).includes("upgrade-test-key"));
    await page.screenshot({
      path: path.resolve("test-output/installed-upgrade.png"),
    });
  }
  const closed = application.waitForEvent("close");
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .close(),
  );
  await closed;
  console.log("PASS installer upgrade " + phase);
} finally {
  await application.close();
}
