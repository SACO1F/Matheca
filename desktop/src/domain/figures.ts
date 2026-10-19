import type { Question } from "../shared/types";
import { normalizeChoiceBody, splitChoices } from "./math";
export const figurePlacementOptions = [
  { value: "stem", label: "题干插图" },
  ...["A", "B", "C", "D"].map((value) => ({ value, label: `选项 ${value}` })),
];
export type FigurePlacement = NonNullable<Question["figurePlacements"]>[number];
export function validateFigurePlacements(
  value: unknown,
  count: number,
): FigurePlacement[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length !== count ||
    value.some((v) => !figurePlacementOptions.some((o) => o.value === v))
  )
    throw Error("图形位置须为题干或 A、B、C、D 选项，且与图形数量一致");
  return value;
}
/** One placement policy for cards, proofreading and both export formats. */
export function questionContent(
  q: Pick<Question, "kind" | "body" | "figures" | "figurePlacements">,
) {
  const placements = (q.figures ?? []).map((_, i) =>
    q.kind === "选择题" ? (q.figurePlacements?.[i] ?? "stem") : "stem",
  );
  const hasOptionFigures = placements.some((p) => p !== "stem");
  const body = q.kind === "选择题" ? normalizeChoiceBody(q.body) : q.body;
  const choice =
    q.kind === "选择题" ? splitChoices(body, hasOptionFigures) : null;
  return {
    stem: choice?.stem ?? body,
    stemFigures: placements.flatMap((p, i) => (p === "stem" ? [i] : [])),
    options: (
      choice?.options ??
      (hasOptionFigures
        ? ["A", "B", "C", "D"].map((label) => ({ label, value: "" }))
        : [])
    ).map((o) => ({
      ...o,
      figures: placements.flatMap((p, i) => (p === o.label ? [i] : [])),
    })),
  };
}
export function validateFigures(value: unknown): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 6 ||
    value.some(
      (image) =>
        typeof image !== "string" ||
        image.length > 2_800_000 ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image),
    )
  )
    throw Error("题目图形无效，每题最多 6 张 PNG 图形");
  if (value.join("").length > 8_000_000) throw Error("题目图形总大小超过限制");
  return value;
}

export function validateFigureWidths(
  value: unknown,
  count: number,
): number[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length !== count ||
    value.some(
      (width) =>
        typeof width !== "number" ||
        !Number.isFinite(width) ||
        (width !== 0 && (width < 20 || width > 160)),
    )
  )
    throw Error("图形宽度须为 20–160 毫米，或使用自动大小");
  return value;
}
/** Match screen and print sizing, preserving aspect ratio and fitting an A4 page. */
export function figureDimensions(
  width: number,
  height: number,
  millimeters: number,
) {
  const scale = Math.min((millimeters * 96) / 25.4 / width, 900 / height);
  return { width: width * scale, height: height * scale };
}
