import { createHash } from "node:crypto";
import type { BackupData } from "../domain/backup";
export type ExchangeInventory = {
  version: 1;
  questions: Record<string, string>;
  collections: Record<string, string>;
};
// UTF-8 length framing avoids differences between JavaScript and Android JSON escaping.
export function framed(v: unknown): string {
  if (v === null || v === undefined) return "n";
  if (typeof v === "string") return `s${Buffer.byteLength(v)}:${v}`;
  if (typeof v === "boolean") return v ? "t" : "f";
  if (typeof v === "number") return `d${v};`;
  if (Array.isArray(v)) return "[" + v.map(framed).join("") + "]";
  const o = v as Record<string, unknown>;
  return (
    "{" +
    Object.keys(o)
      .sort()
      .map((k) => framed(k) + framed(o[k]))
      .join("") +
    "}"
  );
}
const digest = (v: unknown) =>
  createHash("sha256").update(framed(v)).digest("hex");
const fields =
  "id title body latex grade kind difficulty knowledge sourceLabel reviewed favorite example autoSolve solution solutionLatex solutionError".split(
    " ",
  );
export function inventory(data: BackupData): ExchangeInventory {
  const points = [...data.customKnowledge].sort((a, b) =>
    a.group < b.group
      ? -1
      : a.group > b.group
        ? 1
        : a.name < b.name
          ? -1
          : a.name > b.name
            ? 1
            : 0,
  );
  return {
    version: 1,
    questions: Object.fromEntries(
      data.questions.map((q) => [
        q.id,
        digest({
          ...Object.fromEntries(fields.map((k) => [k, q[k as keyof typeof q]])),
          createdAt: String(q.createdAt),
          sourceHash: (data.sources[q.id] || "")
            .split("/")
            .pop()!
            .split(".")[0],
          solutionCurrent: data.currentSolutions.includes(q.id),
          figures: q.figures || [],
          figureWidths: q.figureWidths || (q.figures || []).map(() => 0),
          figurePlacements:
            q.figurePlacements || (q.figures || []).map(() => "stem"),
          points,
        }),
      ]),
    ),
    collections: Object.fromEntries(
      data.collections.map((c) => [
        c.id,
        digest({
          ...c,
          createdAt: String(c.createdAt),
          questionLayout: c.questionLayout || {},
          order: data.items
            .filter((i) => i.collectionId === c.id)
            .sort((a, b) => a.position - b.position)
            .map((i) => i.questionId),
          points,
        }),
      ]),
    ),
  };
}
export function validateInventory(raw: unknown): ExchangeInventory {
  const o = raw as ExchangeInventory;
  if (!o || o.version !== 1) throw Error("请更新手机与电脑后重试增量交换");
  for (const [map, max] of [
    [o.questions, 20000],
    [o.collections, 5000],
  ] as const) {
    if (
      !map ||
      typeof map !== "object" ||
      Array.isArray(map) ||
      Object.keys(map).length > max ||
      Object.entries(map).some(
        ([id, value]) =>
          !id || id.length > 200 || !/^[a-f0-9]{64}$/.test(value),
      )
    )
      throw Error("资料摘要无效");
  }
  return o;
}
