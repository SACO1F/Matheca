import type { Question } from "../shared/types";

/** Metadata defaults do not make an otherwise blank manually entered question. */
export function hasQuestionContent(question: Question): boolean {
  return (
    [
      question.body,
      question.latex,
      question.solution,
      question.solutionLatex,
      question.title === "新题目" ? "" : question.title,
      question.sourcePath,
    ].some((value) => !!value?.trim()) ||
    !!question.figures?.some((value) => !!value?.trim())
  );
}
