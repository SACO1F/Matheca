import {
  validateFigures,
  validateFigureWidths,
  validateFigurePlacements,
} from "./figures";
import { parse, stringify, isLosslessNumber } from "lossless-json";
import type {
  Question,
  Collection,
  CollectionItem,
  KnowledgePoint,
} from "../shared/types";
import { newQuestion } from "../shared/types";
import { trim } from "./math";
import { validatePoint } from "./catalog";
import { validatePaper } from "./paper";
export const limits = {
  archive: 512 * 1024 * 1024,
  manifest: 32 * 1024 * 1024,
  image: 50 * 1024 * 1024,
  questions: 20000,
  collections: 5000,
  items: 100000,
  points: 5000,
};
export const sourceEntry = (s: string) =>
  /^sources\/[0-9a-f]{64}\.(?:jpg|jpeg|png|webp|heic|heif|img)$/.test(s);
export interface BackupData {
  questions: Question[];
  collections: Collection[];
  items: CollectionItem[];
  customKnowledge: KnowledgePoint[];
  sources: Record<string, string>;
  currentSolutions: string[];
  missingSources: number;
}
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v) || isLosslessNumber(v))
    throw Error("备份记录无效");
  return v as Record<string, unknown>;
}
function str(o: Record<string, unknown>, k: string) {
  if (typeof o[k] !== "string") throw Error(`备份字段 ${k} 无效`);
  return o[k] as string;
}
function bool(o: Record<string, unknown>, k: string) {
  if (typeof o[k] !== "boolean") throw Error(`备份字段 ${k} 无效`);
  return o[k] as boolean;
}
function long(o: Record<string, unknown>, k: string) {
  const v = o[k];
  if (!isLosslessNumber(v) || !/^-?(?:0|[1-9]\d*)$/.test(v.value))
    throw Error(`备份字段 ${k} 无效`);
  const n = BigInt(v.value);
  if (n < -(1n << 63n) || n >= 1n << 63n) throw Error(`备份字段 ${k} 超出范围`);
  return n.toString();
}
function int(o: Record<string, unknown>, k: string) {
  const n = BigInt(long(o, k));
  if (n < -2147483648n || n > 2147483647n)
    throw Error(`备份字段 ${k} 超出范围`);
  return Number(n);
}
function array(o: Record<string, unknown>, k: string, max: number) {
  const v = o[k];
  if (!Array.isArray(v) || v.length > max)
    throw Error(`备份字段 ${k} 数量无效`);
  return v.map(object);
}
export function references(
  data: Pick<BackupData, "questions" | "collections" | "items">,
) {
  const { questions, collections, items } = data;
  if (
    questions.length > limits.questions ||
    collections.length > limits.collections ||
    items.length > limits.items
  )
    throw Error("题库备份的数据条目过多");
  const qs = new Set(questions.map((q) => q.id)),
    cs = new Set(collections.map((c) => c.id));
  if (qs.size !== questions.length || cs.size !== collections.length)
    throw Error("题库备份中有重复编号");
  if (
    [...qs, ...cs].some(
      (id) =>
        !trim(id) || id.length > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(id),
    )
  )
    throw Error("题库备份中的编号无效");
  const pairs = new Set<string>(),
    positions = new Set<string>();
  for (const c of collections)
    if (c.questionLayout !== undefined) validatePaper(c);
  for (const i of items) {
    if (
      !qs.has(i.questionId) ||
      !cs.has(i.collectionId) ||
      !Number.isInteger(i.position) ||
      i.position < 0
    )
      throw Error("题集关联数据不完整");
    const p = stringify([i.collectionId, i.questionId])!,
      pos = stringify([i.collectionId, i.position])!;
    if (pairs.has(p) || positions.has(pos))
      throw Error("题集包含重复题目或排序数据无效");
    pairs.add(p);
    positions.add(pos);
  }
}
export function decodeBackup(text: string): BackupData {
  const root = object(parse(text));
  if (
    !["MathecaLibraryBackup", "MathectorLibraryBackup"].includes(
      str(root, "format"),
    )
  )
    throw Error("请选择 Matheca 题库备份");
  if (int(root, "version") !== 1) throw Error("此备份版本暂不支持");
  const sources: Record<string, string> = Object.create(null),
    currentSolutions: string[] = [];
  const questions = array(root, "questions", limits.questions).map((o) => {
    const q = newQuestion(str(o, "id"));
    for (const k of [
      "title",
      "body",
      "latex",
      "grade",
      "kind",
      "difficulty",
      "knowledge",
      "sourceLabel",
      "solution",
      "solutionLatex",
      "solutionError",
    ] as const)
      q[k] = str(o, k);
    for (const k of ["reviewed", "favorite", "example", "autoSolve"] as const)
      q[k] = bool(o, k);
    q.figures = validateFigures(o.figures);
    q.figurePlacements = validateFigurePlacements(
      o.figurePlacements,
      q.figures.length,
    );
    q.figureWidths = validateFigureWidths(
      Array.isArray(o.figureWidths)
        ? o.figureWidths.map((v) => (isLosslessNumber(v) ? Number(v.value) : v))
        : o.figureWidths,
      q.figures.length,
    );
    q.createdAt = long(o, "createdAt");
    const entry = str(o, "sourceEntry");
    if (trim(entry) && !sourceEntry(entry)) throw Error("备份中的原图路径无效");
    if (trim(entry)) sources[q.id] = entry;
    if (bool(o, "solutionCurrent")) currentSolutions.push(q.id);
    return q;
  });
  const collections = array(root, "collections", limits.collections).map(
    (o) => ({
      id: str(o, "id"),
      title: str(o, "title"),
      createdAt: long(o, "createdAt"),
      paperTitle: str(o, "paperTitle"),
      examInstructions: str(o, "examInstructions"),
      examMinutes: int(o, "examMinutes"),
      totalScore: int(o, "totalScore"),
      ...(o.questionLayout === undefined
        ? {}
        : {
            questionLayout: Object.fromEntries(
              Object.entries(object(o.questionLayout)).map(([id, raw]) => {
                const layout = object(raw);
                return [
                  id,
                  {
                    ...(layout.answerSpaceMm === undefined
                      ? {}
                      : { answerSpaceMm: int(layout, "answerSpaceMm") }),
                    ...(layout.pageBreakBefore === undefined
                      ? {}
                      : { pageBreakBefore: bool(layout, "pageBreakBefore") }),
                  },
                ];
              }),
            ),
          }),
    }),
  );
  const items = array(root, "items", limits.items).map((o) => ({
    collectionId: str(o, "collectionId"),
    questionId: str(o, "questionId"),
    position: int(o, "position"),
  }));
  const customKnowledge: KnowledgePoint[] = [];
  for (const o of array(root, "customKnowledge", limits.points))
    customKnowledge.push(
      validatePoint(
        { group: str(o, "group"), name: str(o, "name") },
        customKnowledge,
      ),
    );
  const missingSources = int(root, "missingSources");
  if (missingSources < 0 || missingSources > questions.length)
    throw Error("备份中的原图统计无效");
  const data = {
    questions,
    collections,
    items,
    customKnowledge,
    sources,
    currentSolutions,
    missingSources,
  };
  references(data);
  return data;
}
export function encodeBackup(data: BackupData): string {
  references(data);
  if (data.customKnowledge.length > limits.points) throw Error("知识点过多");
  const root = {
    format: "MathecaLibraryBackup",
    version: 1,
    createdAt: BigInt(Date.now()),
    appVersion: "desktop-0.1.0",
    questions: data.questions.map((q) => {
      const { sourcePath, solutionFingerprint, ...record } = q;
      return {
        ...record,
        createdAt: BigInt(q.createdAt),
        sourceEntry: data.sources[q.id] ?? "",
        solutionCurrent: data.currentSolutions.includes(q.id),
      };
    }),
    collections: data.collections.map((c) => ({
      ...c,
      createdAt: BigInt(c.createdAt),
    })),
    items: data.items,
    customKnowledge: data.customKnowledge,
    missingSources: data.missingSources,
  };
  const text = stringify(root)!;
  if (new TextEncoder().encode(text).length > limits.manifest)
    throw Error("题库文字数据超过 32 MB");
  return text;
}
