import { groups } from "../domain/catalog";
import type { KnowledgePoint } from "../shared/types";

export function knowledgeOptions(custom: KnowledgePoint[]) {
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
      ].map((value) => ({ value, label: value, group })),
    ),
  ];
}
