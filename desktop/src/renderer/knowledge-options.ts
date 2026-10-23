import { decodeKnowledge, groups } from "../domain/catalog";
import type { KnowledgePoint, Question } from "../shared/types";

// Omit questions when assigning metadata; supply the whole library for filters.
export function knowledgeOptions(
  custom: KnowledgePoint[],
  questions?: Pick<Question, "knowledge">[],
) {
  const used =
    questions === undefined
      ? undefined
      : new Set(
          questions.flatMap((question) =>
            decodeKnowledge(question.knowledge, custom),
          ),
        );
  return [
    { value: "", label: "全部知识点" },
    ...Object.entries(groups).flatMap(([group, points]) =>
      [
        ...new Set([
          ...points,
          ...custom
            .filter((point) => point.group === group)
            .map((point) => point.name),
        ]),
      ]
        .filter((value) => !used || used.has(value))
        .map((value) => ({ value, label: value, group })),
    ),
  ];
}
