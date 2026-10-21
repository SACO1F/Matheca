import { expect, it } from "vitest";
import {
  inventory,
  framed,
  validateInventory,
} from "../src/main/exchange-inventory";
import { newQuestion } from "../src/shared/types";
import type { BackupData } from "../src/domain/backup";
import { createHash } from "node:crypto";
const data = (): BackupData => ({
  questions: [
    {
      ...newQuestion("q"),
      id: "q",
      title: "函数 </ 中文 😀",
      createdAt: "9007199254740993",
    },
  ],
  collections: [
    {
      id: "c",
      title: "题集",
      createdAt: "1",
      paperTitle: "",
      examInstructions: "",
      examMinutes: 90,
      totalScore: 100,
    },
  ],
  items: [{ collectionId: "c", questionId: "q", position: 0 }],
  sources: {},
  customKnowledge: [],
  currentSolutions: [],
  missingSources: 0,
});
it("frames Unicode and JSON edge cases identically to the Android protocol", () => {
  expect(framed({ b: 20, a: "中文</😀" })).toBe("{s1:as12:中文</😀s1:bd20;}");
  expect(
    createHash("sha256")
      .update(framed({ b: 20, a: "中文</😀" }))
      .digest("hex"),
  ).toBe("d4ca5fbc38a62c90525ea01f9f2b916998794c183bae91c5a0bcd97c3e191aaa");
});
it("hashes content and layout while ignoring paths, source extension and array order", () => {
  const a = data();
  const first = inventory(a);
  a.questions[0].sourcePath = "C:/private/file.jpg";
  expect(inventory(a)).toEqual(first);
  a.questions[0].body = "modified";
  expect(inventory(a).questions.q).not.toBe(first.questions.q);
  expect(inventory(a).collections.c).toBe(first.collections.c);
  a.collections[0].questionLayout = {
    q: { answerSpaceMm: 60, pageBreakBefore: true },
  };
  expect(inventory(a).collections.c).not.toBe(first.collections.c);
});
it("does not round int64 dates or skip knowledge changes and rejects oversized/bad summaries", () => {
  const a = data(),
    first = inventory(a);
  a.questions[0].createdAt = "9007199254740992";
  expect(inventory(a).questions.q).not.toBe(first.questions.q);
  a.customKnowledge.push({ group: "章节", name: "函数" });
  expect(inventory(a).collections.c).not.toBe(first.collections.c);
  expect(() =>
    validateInventory({ version: 1, questions: { q: "bad" }, collections: {} }),
  ).toThrow();
  expect(() =>
    validateInventory({ version: 2, questions: {}, collections: {} }),
  ).toThrow();
  expect(validateInventory(first)).toEqual(first);
});
