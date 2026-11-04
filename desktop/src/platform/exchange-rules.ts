// Pure data rules shared by the isolated Tauri worker; no native or network access.
import type { BackupData } from "../domain/backup";
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
const sha = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
export function framed(v: any): string {
  if (v === null || v === undefined) return "n";
  if (typeof v === "string")
    return `s${new TextEncoder().encode(v).length}:${v}`;
  if (typeof v === "boolean") return v ? "t" : "f";
  if (typeof v === "number") return `d${v};`;
  if (Array.isArray(v)) return "[" + v.map(framed).join("") + "]";
  return (
    "{" +
    Object.keys(v)
      .sort()
      .map((k) => framed(k) + framed(v[k]))
      .join("") +
    "}"
  );
}
const portableQ = (
  q: BackupData["questions"][number],
  sourceHash: string,
  current: boolean,
) => {
  const { sourcePath: _p, solutionFingerprint: _f, ...record } = q;
  return canonical({
    ...record,
    figures: q.figures || [],
    figureWidths: q.figureWidths || (q.figures || []).map(() => 0),
    figurePlacements: q.figurePlacements || (q.figures || []).map(() => "stem"),
    sourceHash,
    solutionCurrent: current,
  });
};
const portableC = (
  c: BackupData["collections"][number],
  items: BackupData["items"],
) =>
  canonical({
    ...c,
    questionLayout: c.questionLayout || {},
    order: items
      .filter((i) => i.collectionId === c.id)
      .sort((a, b) => a.position - b.position)
      .map((i) => i.questionId),
  });
const sourceHash = (d: BackupData, id: string) =>
  (d.sources[id] || "").split("/").pop()!.split(".")[0];
export async function exchangePlan(
  local: BackupData,
  incoming: BackupData,
  policy: "keep" | "replace" | "copy" = "keep",
) {
  const details: any[] = [];
  const lq = new Map(local.questions.map((q) => [q.id, q]));
  const lc = new Map(local.collections.map((c) => [c.id, c]));
  for (const q of incoming.questions) {
    const l = lq.get(q.id);
    details.push({
      kind: "question",
      id: q.id,
      title: q.title,
      status: !l
        ? "new"
        : portableQ(
              l,
              sourceHash(local, l.id),
              local.currentSolutions.includes(l.id),
            ) ===
            portableQ(
              q,
              sourceHash(incoming, q.id),
              incoming.currentSolutions.includes(q.id),
            )
          ? "same"
          : "conflict",
    });
  }
  for (const c of incoming.collections) {
    const l = lc.get(c.id);
    details.push({
      kind: "collection",
      id: c.id,
      title: c.title,
      status: !l
        ? "new"
        : portableC(l, local.items) === portableC(c, incoming.items)
          ? "same"
          : "conflict",
    });
  }
  const conflictQ = new Set(
    details
      .filter((d) => d.kind === "question" && d.status === "conflict")
      .map((d) => d.id),
  );
  const conflictC = new Set(
    details
      .filter((d) => d.kind === "collection" && d.status === "conflict")
      .map((d) => d.id),
  );
  const qmap = new Map(
    await Promise.all(
      incoming.questions.map(
        async (q) =>
          [
            q.id,
            policy === "copy" && conflictQ.has(q.id)
              ? "exchange-" +
                (
                  await sha(
                    portableQ(
                      q,
                      incoming.sources[q.id] || "",
                      incoming.currentSolutions.includes(q.id),
                    ),
                  )
                ).slice(0, 40)
              : q.id,
          ] as const,
      ),
    ),
  );
  const cmap = new Map(
    await Promise.all(
      incoming.collections.map(
        async (c) =>
          [
            c.id,
            policy === "copy" &&
            (conflictC.has(c.id) ||
              incoming.items.some(
                (i) =>
                  i.collectionId === c.id &&
                  qmap.get(i.questionId) !== i.questionId,
              ))
              ? "exchange-" +
                (await sha(portableC(c, incoming.items))).slice(0, 40)
              : c.id,
          ] as const,
      ),
    ),
  );
  return {
    details,
    data: {
      ...incoming,
      questions: incoming.questions.map((q) => ({ ...q, id: qmap.get(q.id)! })),
      collections: incoming.collections.map((c) => ({
        ...c,
        id: cmap.get(c.id)!,
        ...(c.questionLayout
          ? {
              questionLayout: Object.fromEntries(
                Object.entries(c.questionLayout).map(([qid, layout]) => [
                  qmap.get(qid) || qid,
                  layout,
                ]),
              ),
            }
          : {}),
      })),
      items: incoming.items.map((i) => ({
        ...i,
        questionId: qmap.get(i.questionId)!,
        collectionId: cmap.get(i.collectionId)!,
      })),
      sources: Object.fromEntries(
        Object.entries(incoming.sources).map(([id, entry]) => [
          qmap.get(id)!,
          entry,
        ]),
      ),
      currentSolutions: incoming.currentSolutions.map((id) => qmap.get(id)!),
    },
  };
}
export async function exchangeInventory(data: BackupData) {
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
  const fields =
    "id title body latex grade kind difficulty knowledge sourceLabel reviewed favorite example autoSolve solution solutionLatex solutionError".split(
      " ",
    );
  return {
    version: 1,
    questions: Object.fromEntries(
      await Promise.all(
        data.questions.map(async (q) => [
          q.id,
          await sha(
            framed({
              ...Object.fromEntries(fields.map((k) => [k, (q as any)[k]])),
              createdAt: String(q.createdAt),
              sourceHash: sourceHash(data, q.id),
              solutionCurrent: data.currentSolutions.includes(q.id),
              figures: q.figures || [],
              figureWidths: q.figureWidths || (q.figures || []).map(() => 0),
              figurePlacements:
                q.figurePlacements || (q.figures || []).map(() => "stem"),
              points,
            }),
          ),
        ]),
      ),
    ),
    collections: Object.fromEntries(
      await Promise.all(
        data.collections.map(async (c) => [
          c.id,
          await sha(
            framed({
              ...c,
              createdAt: String(c.createdAt),
              questionLayout: c.questionLayout || {},
              order: data.items
                .filter((i) => i.collectionId === c.id)
                .sort((a, b) => a.position - b.position)
                .map((i) => i.questionId),
              points,
            }),
          ),
        ]),
      ),
    ),
  };
}
