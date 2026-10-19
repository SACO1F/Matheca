import { it, expect } from "vitest";
import { validatePaper, answerSpaceMm } from "../src/domain/paper";
import { newCollection } from "../src/shared/types";
it("uses fixed type defaults regardless of difficulty and subquestion count", () => {
  const q = { kind: "选择题", body: "求值", difficulty: "挑战" };
  expect(answerSpaceMm(q)).toBe(0);
  expect(answerSpaceMm({ ...q, kind: "填空题" })).toBe(0);
  expect(answerSpaceMm({ ...q, kind: "计算题", difficulty: "基础" })).toBe(30);
  expect(answerSpaceMm({ ...q, kind: "计算题", difficulty: "进阶" })).toBe(30);
  expect(
    answerSpaceMm({ ...q, kind: "证明题", body: "已知\n（1）求值\n（2）证明" }),
  ).toBe(50);
  expect(
    answerSpaceMm({
      ...q,
      kind: "解答题",
      body: Array.from({ length: 20 }, (_, i) => `（${i + 1}）求值`).join("\n"),
    }),
  ).toBe(50);
});
it("validates and trims the Android document fields independently of storage", () => {
  const c = newCollection("c", "题集");
  expect(
    validatePaper({
      ...c,
      paperTitle: "  标题  ",
      examInstructions: "\u00a0说明\n\u00a0",
    }),
  ).toMatchObject({ paperTitle: "标题", examInstructions: "说明" });
  expect(
    validatePaper({
      ...c,
      paperTitle: "😀".repeat(40),
      examInstructions: "字".repeat(600),
      examMinutes: 999,
      totalScore: 9999,
    }),
  ).toBeDefined();
});
it("uses per-collection writing space including zero and validates layout controls", () => {
  const c = {
    ...newCollection("c", "题集"),
    questionLayout: { q: { answerSpaceMm: 75, pageBreakBefore: true } },
  };
  const q = { id: "q", body: "求值", difficulty: "基础", kind: "解答题" };
  expect(answerSpaceMm(q, c)).toBe(75);
  expect(answerSpaceMm(q)).toBe(50);
  expect(
    answerSpaceMm(q, { ...c, questionLayout: { q: { answerSpaceMm: 0 } } }),
  ).toBe(0);
  expect(validatePaper(c).questionLayout).toEqual(c.questionLayout);
  for (const mm of [-1, 161, 1.5, NaN])
    expect(() =>
      validatePaper({ ...c, questionLayout: { q: { answerSpaceMm: mm } } }),
    ).toThrow();
});
it.each([
  { paperTitle: "😀".repeat(41) },
  { examInstructions: "字".repeat(601) },
  { examMinutes: -1 },
  { examMinutes: 1000 },
  { examMinutes: 1.5 },
  { totalScore: -1 },
  { totalScore: 10000 },
  { totalScore: 2.5 },
])("rejects invalid paper setting %j", (patch) =>
  expect(() =>
    validatePaper({ ...newCollection("c", "题集"), ...patch }),
  ).toThrow(),
);
