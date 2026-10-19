import type { Collection, Question } from "../shared/types";
import { trim } from "./math";
/** Millimetres of writing space after a question, shared by PDF and Word. */
export function answerSpaceMm(
  q: Pick<Question, "kind" | "body" | "difficulty"> & { id?: string },
  collection?: Collection,
): number {
  const custom = q.id
    ? collection?.questionLayout?.[q.id]?.answerSpaceMm
    : undefined;
  if (custom !== undefined) return custom;
  if (q.kind === "选择题" || q.kind === "填空题") return 0;
  return q.kind === "计算题" ? 30 : 50;
}
export function validatePaper(collection: Collection): Collection {
  const c = {
    ...collection,
    paperTitle: trim(collection.paperTitle),
    examInstructions: trim(collection.examInstructions),
  };
  if (c.paperTitle.length > 80) throw Error("试卷主标题最多 80 字");
  if (c.questionLayout !== undefined) {
    if (
      !c.questionLayout ||
      typeof c.questionLayout !== "object" ||
      Array.isArray(c.questionLayout) ||
      Object.keys(c.questionLayout).length > 100000
    )
      throw Error("题目排版设置无效");
    for (const [id, layout] of Object.entries(c.questionLayout)) {
      if (
        !id ||
        id.length > 200 ||
        !layout ||
        typeof layout !== "object" ||
        Array.isArray(layout)
      )
        throw Error("题目排版设置无效");
      if (
        layout.answerSpaceMm !== undefined &&
        (!Number.isInteger(layout.answerSpaceMm) ||
          layout.answerSpaceMm < 0 ||
          layout.answerSpaceMm > 160)
      )
        throw Error("解答空间应为 0–160mm，留空使用自动排布");
      if (
        layout.pageBreakBefore !== undefined &&
        typeof layout.pageBreakBefore !== "boolean"
      )
        throw Error("题目分页设置无效");
    }
  }
  if (c.examInstructions.length > 600) throw Error("考试说明最多 600 字");
  if (
    !Number.isInteger(c.examMinutes) ||
    c.examMinutes < 0 ||
    c.examMinutes > 999
  )
    throw Error("考试时间应为 1–999 分钟，留空不显示");
  if (
    !Number.isInteger(c.totalScore) ||
    c.totalScore < 0 ||
    c.totalScore > 9999
  )
    throw Error("满分应为 1–9999 分，留空不显示");
  return c;
}
