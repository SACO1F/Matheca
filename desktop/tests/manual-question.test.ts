import { describe, expect, it } from "vitest";
import { hasQuestionContent } from "../src/domain/manual-question";
import { newQuestion } from "../src/shared/types";

describe("manual question content", () => {
  it("does not treat defaults, whitespace or metadata as content", () => {
    expect(hasQuestionContent(newQuestion("blank"))).toBe(false);
    expect(
      hasQuestionContent({
        ...newQuestion("metadata"),
        body: " \n ",
        latex: "\t",
        grade: "高一",
        knowledge: "函数",
        favorite: true,
      }),
    ).toBe(false);
  });
  it("keeps text, formulas, images and a user-written title", () => {
    for (const content of [
      { body: "求函数定义域" },
      { latex: "x^2+1" },
      { figures: ["data:image/png;base64,abc"] },
      { title: "自编练习" },
    ]) {
      expect(
        hasQuestionContent({ ...newQuestion("content"), ...content }),
      ).toBe(true);
    }
  });
});
