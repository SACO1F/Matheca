import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { inspectArchive, exportArchive, restoreArchive } from "./archive";
import { Store } from "./store";
import { type BackupData } from "../domain/backup";
import type {
  ExchangeInbox,
  ExchangePreview,
  ExchangePolicy,
  ExchangeSelection,
  Question,
  Collection,
} from "../shared/types";
import { fingerprint } from "./fingerprint";
import { inventory, type ExchangeInventory } from "./exchange-inventory";

const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
export function portableQuestion(
  q: Question,
  sourceHash: string,
  current: boolean,
) {
  const { sourcePath: _path, solutionFingerprint: _fp, ...record } = q;
  return canonical({
    ...record,
    figures: q.figures || [],
    figureWidths: q.figureWidths || (q.figures || []).map(() => 0),
    figurePlacements: q.figurePlacements || (q.figures || []).map(() => "stem"),
    sourceHash,
    solutionCurrent: current,
  });
}
const portableCollection = (c: Collection, items: BackupData["items"]) =>
  canonical({
    ...c,
    questionLayout: c.questionLayout || {},
    order: items
      .filter((i) => i.collectionId === c.id)
      .sort((a, b) => a.position - b.position)
      .map((i) => i.questionId),
  });
export class LibraryExchange {
  private inbox: ExchangeInbox[] = [];
  private previews = new Map<
    string,
    {
      data: BackupData;
      local: string;
      folder: string;
      details: ExchangePreview["details"];
    }
  >();
  private applying = false;
  constructor(
    private folder: string,
    private store: Store,
    private changed: () => void,
  ) {
    fs.mkdirSync(folder, { recursive: true });
    const manifest = path.join(folder, "inbox.json");
    if (fs.existsSync(manifest)) {
      const saved: ExchangeInbox[] = JSON.parse(
        fs.readFileSync(manifest, "utf8"),
      );
      if (
        !Array.isArray(saved) ||
        saved.length > 20 ||
        saved.some(
          (i) =>
            !/^[a-f0-9-]{36}$/.test(i.id) ||
            typeof i.name !== "string" ||
            !["received", "imported"].includes(i.status),
        )
      )
        throw Error("资料接收记录无法读取，请保留数据后联系维护者");
      this.inbox = saved.filter(
        (i) => i.status === "imported" || fs.existsSync(this.file(i.id)),
      );
    }
  }
  private file(id: string) {
    return path.join(this.folder, id + ".zip");
  }
  private persist() {
    const temp = path.join(this.folder, "inbox.tmp");
    fs.writeFileSync(temp, JSON.stringify(this.inbox));
    fs.renameSync(temp, path.join(this.folder, "inbox.json"));
  }
  list() {
    return this.inbox.map((i) => ({ ...i }));
  }
  receipt(id: string) {
    return (
      this.inbox.find((i) => i.id === id) ||
      (this.store.getSetting("exchange:" + id)
        ? {
            id,
            name: "已接收资料",
            size: 0,
            status: "imported" as const,
            receivedAt: 0,
          }
        : undefined)
    );
  }
  async receive(id: string, name: string, size: number, temp: string) {
    if (this.receipt(id)) return;
    if (this.inbox.filter((i) => i.status === "received").length >= 10)
      throw Error("待处理资料已达 10 份，请先在电脑接收或移除");
    const staging = path.join(this.folder, "check-" + randomUUID());
    try {
      await inspectArchive(temp, staging);
      fs.renameSync(temp, this.file(id));
      const before = this.inbox;
      this.inbox = [
        ...this.inbox.filter((i) => i.status !== "imported").slice(-9),
        ...this.inbox.filter((i) => i.status === "imported").slice(-9),
        { id, name, size, status: "received", receivedAt: Date.now() },
      ];
      try {
        this.persist();
      } catch (error) {
        this.inbox = before;
        fs.renameSync(this.file(id), temp);
        throw error;
      }
      this.changed();
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
  private localVersion() {
    return hash(
      canonical({
        questions: this.store.questions().map((q) => ({
          ...q,
          sourceStat:
            q.sourcePath && fs.existsSync(q.sourcePath)
              ? [
                  fs.statSync(q.sourcePath).size,
                  fs.statSync(q.sourcePath).mtimeMs,
                ]
              : null,
        })),
        collections: this.store.collections(),
        items: this.store.items(),
        points: this.store.points(),
      }),
    );
  }
  async inspect(id: string): Promise<ExchangePreview> {
    if (this.applying) throw Error("正在接收资料，请稍后");
    const inbox = this.receipt(id);
    if (!inbox || inbox.status !== "received") throw Error("待接收资料不存在");
    const old = this.previews.get(id);
    if (old) fs.rmSync(old.folder, { recursive: true, force: true });
    const folder = path.join(this.folder, "preview-" + randomUUID());
    try {
      const data = await inspectArchive(this.file(id), folder);
      const version = this.localVersion();
      const localQuestions = new Map(
        this.store.questions().map((q) => [q.id, q]),
      );
      const details: ExchangePreview["details"] = [];
      for (const q of data.questions) {
        const local = localQuestions.get(q.id);
        let same = false;
        if (local) {
          let source = "";
          if (local.sourcePath && fs.existsSync(local.sourcePath)) {
            const digest = createHash("sha256");
            for await (const chunk of fs.createReadStream(local.sourcePath))
              digest.update(chunk);
            source = digest.digest("hex");
          }
          same =
            portableQuestion(
              local,
              source,
              !!local.solution &&
                local.solutionFingerprint === fingerprint(local),
            ) ===
            portableQuestion(
              q,
              data.sources[q.id]?.split("/")[1].split(".")[0] || "",
              data.currentSolutions.includes(q.id),
            );
        }
        details.push({
          kind: "question",
          id: q.id,
          title: q.title,
          status: !local ? "new" : same ? "same" : "conflict",
        });
      }
      for (const c of data.collections) {
        const local = this.store.collection(c.id);
        details.push({
          kind: "collection",
          id: c.id,
          title: c.title,
          status: !local
            ? "new"
            : portableCollection(local, this.store.items()) ===
                portableCollection(c, data.items)
              ? "same"
              : "conflict",
        });
      }
      if (version !== this.localVersion())
        throw Error("本机题库已变化，请重新预览");
      this.previews.set(id, { data, folder, local: version, details });
      return {
        id,
        questions: data.questions.length,
        collections: data.collections.length,
        missingImages: data.missingSources,
        added: details.filter((i) => i.status === "new").length,
        repeated: details.filter((i) => i.status === "same").length,
        conflicts: details.filter((i) => i.status === "conflict").length,
        details,
      };
    } catch (error) {
      fs.rmSync(folder, { recursive: true, force: true });
      throw error;
    }
  }
  apply(id: string, policy: ExchangePolicy) {
    if (this.applying) throw Error("正在接收资料，请稍后");
    if (!["keep", "replace", "copy"].includes(policy))
      throw Error("冲突处理方式无效");
    const preview = this.previews.get(id),
      incoming = this.receipt(id);
    if (!preview || !incoming || incoming.status !== "received")
      throw Error("请先预览待接收资料");
    if (preview.local !== this.localVersion())
      throw Error("本机题库已变化，请重新预览后确认");
    this.applying = true;
    try {
      const source = preview.data;
      // Copy IDs derive from the received package: retrying the same package never creates another copy.
      const conflictQ = new Set(
        preview.details
          .filter((i) => i.kind === "question" && i.status === "conflict")
          .map((i) => i.id),
      );
      const conflictC = new Set(
        preview.details
          .filter((i) => i.kind === "collection" && i.status === "conflict")
          .map((i) => i.id),
      );
      const qmap = new Map(
        source.questions.map((q) => [
          q.id,
          policy === "copy" && conflictQ.has(q.id)
            ? "exchange-" +
              hash(
                portableQuestion(
                  q,
                  source.sources[q.id] || "",
                  source.currentSolutions.includes(q.id),
                ),
              ).slice(0, 40)
            : q.id,
        ]),
      );
      const cmap = new Map(
        source.collections.map((c) => [
          c.id,
          policy === "copy" &&
          (conflictC.has(c.id) ||
            source.items.some(
              (i) =>
                i.collectionId === c.id &&
                qmap.get(i.questionId) !== i.questionId,
            ))
            ? "exchange-" +
              hash(portableCollection(c, source.items)).slice(0, 40)
            : c.id,
        ]),
      );
      const data: BackupData = {
        ...source,
        questions: source.questions.map((q) => ({ ...q, id: qmap.get(q.id)! })),
        collections: source.collections.map((c) => ({
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
        items: source.items.map((i) => ({
          ...i,
          questionId: qmap.get(i.questionId)!,
          collectionId: cmap.get(i.collectionId)!,
        })),
        sources: Object.fromEntries(
          Object.entries(source.sources).map(([qid, entry]) => [
            qmap.get(qid)!,
            entry,
          ]),
        ),
        currentSolutions: source.currentSolutions.map((qid) => qmap.get(qid)!),
      };
      const batch = path.join(this.folder, "committed", randomUUID());
      // The receipt and imported records commit together; a crash cannot repeat a replacement.
      try {
        this.store.db.transaction(() => {
          if (
            this.store.db
              .prepare("SELECT value FROM settings WHERE key=?")
              .get("exchange:" + id)
          )
            return;
          restoreArchive(
            this.store,
            data,
            preview.folder,
            batch,
            policy === "replace",
          );
          this.store.setSetting("exchange:" + id, "done");
        })();
      } catch (error) {
        fs.rmSync(batch, { recursive: true, force: true });
        throw error;
      }
      incoming.status = "imported";
      this.persist();
      fs.rmSync(this.file(id), { force: true });
      this.previews.delete(id);
      fs.rmSync(preview.folder, { recursive: true, force: true });
      this.changed();
    } finally {
      this.applying = false;
    }
  }
  discard(id: string) {
    if (this.applying) throw Error("正在接收资料，请稍后");
    const old = this.inbox;
    this.inbox = this.inbox.filter((i) => i.id !== id);
    try {
      this.persist();
    } catch (error) {
      this.inbox = old;
      throw error;
    }
    fs.rmSync(this.file(id), { force: true });
    const preview = this.previews.get(id);
    if (preview) fs.rmSync(preview.folder, { recursive: true, force: true });
    this.previews.delete(id);
  }
  async export(target: string, selection: ExchangeSelection) {
    await exportArchive(this.store, target, selection);
  }
  async inventory(): Promise<ExchangeInventory> {
    const data: BackupData = {
      questions: this.store.questions(),
      collections: this.store.collections(),
      items: this.store.items(),
      customKnowledge: this.store.points(),
      sources: Object.create(null),
      currentSolutions: [],
      missingSources: 0,
    };
    for (const q of data.questions) {
      if (q.solution && q.solutionFingerprint === fingerprint(q))
        data.currentSolutions.push(q.id);
      if (q.sourcePath && fs.existsSync(q.sourcePath)) {
        const h = createHash("sha256");
        for await (const chunk of fs.createReadStream(q.sourcePath))
          h.update(chunk);
        data.sources[q.id] = "sources/" + h.digest("hex") + ".img";
      }
    }
    return inventory(data);
  }
  async delta(
    selection: ExchangeSelection,
    remote: ExchangeInventory,
  ): Promise<ExchangeSelection> {
    const local = await this.inventory(),
      cs = new Set(selection.collectionIds);
    const qs = new Set([
      ...selection.questionIds,
      ...this.store
        .items()
        .filter((i) => cs.has(i.collectionId))
        .map((i) => i.questionId),
    ]);
    if (
      [...qs].some((id) => !local.questions[id]) ||
      [...cs].some((id) => !local.collections[id])
    )
      throw Error("所选资料已变化，请重新选择");
    return {
      questionIds: [...qs].filter(
        (id) => local.questions[id] !== remote.questions[id],
      ),
      collectionIds: [...cs].filter(
        (id) => local.collections[id] !== remote.collections[id],
      ),
    };
  }
}
