import {
  validateFigures,
  validateFigureWidths,
  validateFigurePlacements,
} from "../domain/figures";
import Database from "better-sqlite3";
import { hasQuestionContent } from "../domain/manual-question";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Question,
  Collection,
  CollectionItem,
  KnowledgePoint,
  ImportJob,
  HistoryEntry,
} from "../shared/types";
import { newQuestion } from "../shared/types";
import { edited, normalizeQuestion, validatePoint } from "../domain/catalog";
import { trim } from "../domain/math";
import { fingerprint } from "./fingerprint";
import { validatePaper } from "../domain/paper";
type DeletionSnapshot = { token: string } & (
  | {
      kind: "question";
      question: Question;
      placements: { collectionId: string; order: string[] }[];
    }
  | { kind: "collection"; collection: Collection; order: string[] }
  | { kind: "item"; collectionId: string; questionId: string; order: string[] }
);
export class Store {
  db: Database.Database;
  private deletionUndo?: DeletionSnapshot;
  private additionUndo?: { token: string; collectionId: string; ids: string[] };
  addQuestionsWithUndo(collectionId: string, ids: string[]) {
    const existing = new Set(
      this.items()
        .filter((i) => i.collectionId === collectionId)
        .map((i) => i.questionId),
    );
    const added = [...new Set(ids)].filter(
      (id) => !existing.has(id) && this.question(id),
    );
    const count = this.addQuestions(collectionId, ids);
    if (!count) return { count };
    const token = randomUUID();
    this.additionUndo = { token, collectionId, ids: added };
    return { count, token };
  }
  undoAddition(token: string) {
    const snapshot = this.additionUndo;
    if (!snapshot || snapshot.token !== token)
      throw Error("这次加入已没有可用的撤销记录");
    this.db.transaction(() => {
      const current = this.items()
        .filter((i) => i.collectionId === snapshot.collectionId)
        .map((i) => i.questionId);
      if (!snapshot.ids.every((id) => current.includes(id)))
        throw Error("已选题目已发生变化，无法撤销这次加入");
      for (const id of snapshot.ids)
        this.db
          .prepare("DELETE FROM items WHERE collectionId=? AND questionId=?")
          .run(snapshot.collectionId, id);
      this.reorder(
        snapshot.collectionId,
        current.filter((id) => !snapshot.ids.includes(id)),
      );
    })();
    this.additionUndo = undefined;
  }
  // The toast exposes one recent confirmed edit, kept outside persisted data while its toast is actionable.
  private reviewUndo?: { before: Question; after: Question };
  private reviewFields = [
    "title",
    "body",
    "latex",
    "grade",
    "kind",
    "difficulty",
    "knowledge",
    "figures",
    "figureWidths",
    "figurePlacements",
    "reviewed",
    "favorite",
    "autoSolve",
  ] as const;
  private sameReviewEdit(a: Question, b: Question) {
    return this.reviewFields.every(
      (key) => JSON.stringify(a[key]) === JSON.stringify(b[key]),
    );
  }

  constructor(public file: string) {
    const existing = fs.existsSync(file) && fs.statSync(file).size > 0;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    try {
      this.db.pragma("foreign_keys = ON");
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("busy_timeout = 10000");
      const version = this.db.pragma("user_version", {
        simple: true,
      }) as number;
      if (version > 1) throw Error("题库版本较新，请更新桌面程序");
      if (version === 0 && existing)
        this.db
          .prepare("VACUUM INTO ?")
          .run(file + ".before-v1-" + Date.now() + ".sqlite");
      if (version === 0)
        this.db.transaction(() => {
          this.db
            .exec(`CREATE TABLE questions(id TEXT PRIMARY KEY,createdAt INTEGER NOT NULL,data TEXT NOT NULL);
        CREATE TABLE collections(id TEXT PRIMARY KEY,createdAt INTEGER NOT NULL,data TEXT NOT NULL);
        CREATE TABLE items(collectionId TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,questionId TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,position INTEGER NOT NULL,PRIMARY KEY(collectionId,questionId));
        CREATE INDEX item_questions ON items(questionId);
        CREATE TABLE knowledge(name TEXT PRIMARY KEY,data TEXT NOT NULL);
        CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE jobs(id TEXT PRIMARY KEY,createdAt INTEGER NOT NULL,data TEXT NOT NULL);
        CREATE TABLE pages(jobId TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,fileOrdinal INTEGER NOT NULL,pageOrdinal INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(jobId,fileOrdinal,pageOrdinal));
        CREATE TABLE batches(id TEXT PRIMARY KEY,path TEXT NOT NULL);
        PRAGMA user_version = 1;`);
        })();
      this.db.exec(`CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL,
      title TEXT NOT NULL, detail TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL
    );`);
    } catch (error) {
      // Failed migrations/unsupported versions must release the database so
      // the user can recover or replace it without restarting the process.
      this.db.close();
      throw error;
    }
  }
  addHistory(entry: Omit<HistoryEntry, "id" | "timestamp">) {
    this.db
      .prepare(
        "INSERT INTO history(timestamp,title,detail,category,status) VALUES(?,?,?,?,?)",
      )
      .run(Date.now(), entry.title, entry.detail, entry.category, entry.status);
  }
  history(limit = 100, offset = 0, query = "") {
    const pattern = "%" + query.replace(/[\\%_]/g, "\\$&") + "%";
    // Hide legacy interface events in both full history and the recent-five query.
    const scope = `(category = 'operation' AND title NOT IN ('保存设置','测试图片接口','继续任务','取消任务','打开导出文档'))
      OR (category = 'interaction' AND title IN ('筛选题库','筛选题集添加面板'))
      OR (category = 'task' AND (title LIKE '%处理完成' OR status IN ('failed','cancelled')))`;
    const where = `WHERE (${scope}) AND (title LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\')`;
    const total = (
      this.db
        .prepare(`SELECT COUNT(*) AS total FROM history ${where}`)
        .get(pattern, pattern) as { total: number }
    ).total;
    const records = this.db
      .prepare(
        `SELECT * FROM history ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .all(pattern, pattern, limit, offset) as HistoryEntry[];
    return { records, total };
  }
  private records<T>(table: string): T[] {
    return (
      this.db
        .prepare(
          `SELECT data FROM ${table} ${table === "knowledge" ? "" : "ORDER BY createdAt DESC"}`,
        )
        .all() as { data: string }[]
    ).map((r) => JSON.parse(r.data) as T);
  }
  questions() {
    return this.records<Question>("questions");
  }
  collections() {
    return this.records<Collection>("collections");
  }
  points() {
    return this.records<KnowledgePoint>("knowledge");
  }
  jobs() {
    return this.records<StoredJob>("jobs");
  }
  importDetails(jobId: string, labels: string[]) {
    const all = new Set<string>();
    const files = labels.map((name) => ({
      name,
      ids: new Set<string>(),
      completedPages: 0,
    }));
    const pages = this.db
      .prepare("SELECT fileOrdinal,data FROM pages WHERE jobId=?")
      .all(jobId) as { fileOrdinal: number; data: string }[];
    for (const row of pages) {
      const page = JSON.parse(row.data) as SavedPage;
      if (!page.complete) continue;
      const file =
        files[row.fileOrdinal] ??
        (files[row.fileOrdinal] = {
          name: `文件 ${row.fileOrdinal + 1}`,
          ids: new Set<string>(),
          completedPages: 0,
        });
      file.completedPages++;
      for (const id of page.questionIds) {
        file.ids.add(id);
        all.add(id);
      }
    }
    return {
      recognizedCount: all.size,
      questionIds: [...all],
      sourceFiles: files
        .filter(Boolean)
        .map(({ name, ids, completedPages }) => ({
          name,
          recognizedCount: ids.size,
          completedPages,
        })),
    };
  }
  items() {
    return this.db
      .prepare("SELECT * FROM items ORDER BY position")
      .all() as CollectionItem[];
  }
  question(id: string) {
    const r = this.db
      .prepare("SELECT data FROM questions WHERE id=?")
      .get(id) as { data: string } | undefined;
    return r ? (JSON.parse(r.data) as Question) : undefined;
  }
  collection(id: string) {
    const r = this.db
      .prepare("SELECT data FROM collections WHERE id=?")
      .get(id) as { data: string } | undefined;
    return r ? (JSON.parse(r.data) as Collection) : undefined;
  }
  putQuestion(q: Question) {
    this.db
      .prepare(
        "INSERT INTO questions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET createdAt=excluded.createdAt,data=excluded.data",
      )
      .run(q.id, BigInt(q.createdAt), JSON.stringify(q));
  }
  cleanupEmptyManualQuestions() {
    const empty = this.questions().filter(
      (question) =>
        question.sourceLabel === "手动录入" && !hasQuestionContent(question),
    );
    this.db.transaction(() => {
      for (const question of empty)
        this.db.prepare("DELETE FROM questions WHERE id=?").run(question.id);
    })();
    return empty.length;
  }
  saveQuestion(draft: Question, confirm = false) {
    const old = this.question(draft.id),
      base = old ?? newQuestion(draft.id);
    let q = normalizeQuestion(
      {
        ...base,
        ...(draft.figures === undefined
          ? {}
          : { figures: validateFigures(draft.figures) }),
        ...Object.fromEntries(
          [
            "title",
            "body",
            "latex",
            "grade",
            "kind",
            "difficulty",
            "knowledge",
            "favorite",
            "autoSolve",
          ].map((k) => [k, draft[k as keyof Question]]),
        ),
      } as Question,
      this.points(),
    );
    q.figureWidths = validateFigureWidths(
      draft.figureWidths ?? base.figureWidths,
      q.figures?.length ?? 0,
    );
    q.figurePlacements = validateFigurePlacements(
      draft.figurePlacements ?? base.figurePlacements,
      q.figures?.length ?? 0,
    );
    if (old) q = edited(old, q, this.points());
    if (fingerprint(base) !== fingerprint(q))
      q = {
        ...q,
        solution: "",
        solutionLatex: "",
        solutionFingerprint: "",
        solutionError: "",
      };
    if (confirm) {
      if (!trim(q.body)) throw Error("请先填写题干，独立公式仅用于校对");
      q.reviewed = true;
    }
    this.putQuestion(q);
    if (confirm) {
      if (!this.sameReviewEdit(base, q))
        this.reviewUndo = { before: base, after: q };
      // An unchanged reconfirmation keeps the original edit snapshot.
    } else if (
      this.reviewUndo?.after.id === q.id &&
      !this.sameReviewEdit(this.reviewUndo.after, q)
    ) {
      this.reviewUndo = undefined;
    }
    return q;
  }
  undoReview(expected: Question) {
    const current = this.question(expected.id),
      snapshot = this.reviewUndo;
    if (!current) throw Error("题目已删除，无法撤销这次修改");
    if (
      !snapshot ||
      snapshot.after.id !== expected.id ||
      !this.sameReviewEdit(current, snapshot.after) ||
      !this.sameReviewEdit(expected, snapshot.after)
    )
      throw Error("题目已更新或没有可撤销的修改");
    const q = { ...snapshot.before };
    // Keep an asynchronous answer only when it belongs to the restored content.
    if (current.solutionFingerprint === fingerprint(q)) {
      q.solution = current.solution;
      q.solutionLatex = current.solutionLatex;
      q.solutionFingerprint = current.solutionFingerprint;
      q.solutionError = current.solutionError;
    }
    this.putQuestion(q);
    this.reviewUndo = undefined;
    return q;
  }
  deleteQuestion(id: string) {
    if (this.additionUndo?.ids.includes(id)) this.additionUndo = undefined;
    const question = this.question(id);
    if (!question) throw Error("题目不存在");
    const token = randomUUID(),
      items = this.items();
    const placements = [
      ...new Set(
        items.filter((i) => i.questionId === id).map((i) => i.collectionId),
      ),
    ].map((collectionId) => ({
      collectionId,
      order: items
        .filter((i) => i.collectionId === collectionId)
        .map((i) => i.questionId),
    }));
    this.db.prepare("DELETE FROM questions WHERE id=?").run(id);
    this.deletionUndo = { token, kind: "question", question, placements };
    return token;
  }
  putCollection(c: Collection) {
    this.db
      .prepare(
        "INSERT INTO collections VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET createdAt=excluded.createdAt,data=excluded.data",
      )
      .run(c.id, BigInt(c.createdAt), JSON.stringify(c));
  }
  saveCollection(c: Collection) {
    if (!trim(c.title) || c.title.length > 200)
      throw Error("题集名称须为 1–200 字");
    c = validatePaper(c);
    const old = this.collection(c.id);
    this.putCollection({
      ...c,
      createdAt: old?.createdAt ?? Date.now().toString(),
      paperTitle: trim(c.paperTitle),
      examInstructions: trim(c.examInstructions),
    });
  }
  deleteCollection(id: string) {
    if (this.additionUndo?.collectionId === id) this.additionUndo = undefined;
    const collection = this.collection(id);
    if (!collection) throw Error("题集不存在");
    const token = randomUUID(),
      order = this.items()
        .filter((i) => i.collectionId === id)
        .map((i) => i.questionId);
    this.db.prepare("DELETE FROM collections WHERE id=?").run(id);
    this.deletionUndo = { token, kind: "collection", collection, order };
    return token;
  }
  private restorePlacement(
    collectionId: string,
    questionId: string,
    order: string[],
  ) {
    if (!this.collection(collectionId) || !this.question(questionId))
      throw Error("题集或题目已不存在，无法恢复关联");
    const current = this.items()
      .filter((i) => i.collectionId === collectionId)
      .map((i) => i.questionId);
    if (current.includes(questionId))
      throw Error("题目已重新加入题集，无需撤销");
    const oldIndex = order.indexOf(questionId);
    const next = order.slice(oldIndex + 1).find((id) => current.includes(id));
    const previous = order
      .slice(0, oldIndex)
      .reverse()
      .find((id) => current.includes(id));
    const index = next
      ? current.indexOf(next)
      : previous
        ? current.indexOf(previous) + 1
        : Math.min(Math.max(0, oldIndex), current.length);
    current.splice(index, 0, questionId);
    this.addQuestions(collectionId, [questionId]);
    this.reorder(collectionId, current);
  }
  undoDeletion(token: string): {
    kind: "question" | "collection" | "item";
    collection?: Collection;
  } {
    const snapshot = this.deletionUndo;
    if (!snapshot || snapshot.token !== token)
      throw Error("这次删除已没有可用的撤销记录");
    const result = this.db.transaction(() => {
      if (snapshot.kind === "question") {
        if (this.question(snapshot.question.id))
          throw Error("同编号题目已存在，无法覆盖恢复");
        this.putQuestion(snapshot.question);
        for (const placement of snapshot.placements) {
          if (this.collection(placement.collectionId))
            this.restorePlacement(
              placement.collectionId,
              snapshot.question.id,
              placement.order,
            );
        }
      } else if (snapshot.kind === "collection") {
        if (this.collection(snapshot.collection.id))
          throw Error("同编号题集已存在，无法覆盖恢复");
        this.putCollection(snapshot.collection);
        this.addQuestions(snapshot.collection.id, snapshot.order);
      } else
        this.restorePlacement(
          snapshot.collectionId,
          snapshot.questionId,
          snapshot.order,
        );
      return {
        kind: snapshot.kind,
        ...(snapshot.kind === "collection"
          ? { collection: snapshot.collection }
          : {}),
      };
    })();
    this.deletionUndo = undefined;
    return result;
  }
  addQuestions(collectionId: string, ids: string[]) {
    if (this.additionUndo?.collectionId === collectionId)
      this.additionUndo = undefined;
    return this.db.transaction(() => {
      if (!this.collection(collectionId)) throw Error("题集不存在");
      let position = Number(
          (
            this.db
              .prepare(
                "SELECT COALESCE(MAX(position),-1)+1 n FROM items WHERE collectionId=?",
              )
              .get(collectionId) as { n: number }
          ).n,
        ),
        count = 0;
      for (const id of [...new Set(ids)])
        if (this.question(id)) {
          const n = this.db
            .prepare("INSERT OR IGNORE INTO items VALUES(?,?,?)")
            .run(collectionId, id, position).changes;
          if (n) {
            count++;
            position++;
          }
        }
      return count;
    })();
  }
  reorder(collectionId: string, ids: string[]) {
    this.db.transaction(() => {
      const existing = this.items()
        .filter((i) => i.collectionId === collectionId)
        .map((i) => i.questionId);
      if (
        ids.length !== existing.length ||
        new Set(ids).size !== ids.length ||
        ids.some((i) => !existing.includes(i))
      )
        throw Error("题集顺序无效");
      ids.forEach((id, pos) =>
        this.db
          .prepare(
            "UPDATE items SET position=? WHERE collectionId=? AND questionId=?",
          )
          .run(pos, collectionId, id),
      );
    })();
  }
  removeQuestion(c: string, q: string) {
    if (
      this.additionUndo?.collectionId === c &&
      this.additionUndo.ids.includes(q)
    )
      this.additionUndo = undefined;
    const order = this.items()
        .filter((i) => i.collectionId === c)
        .map((i) => i.questionId),
      token = randomUUID();
    if (!order.includes(q)) throw Error("此题已不在题集中");
    this.db
      .prepare("DELETE FROM items WHERE collectionId=? AND questionId=?")
      .run(c, q);
    const ids = this.items()
      .filter((i) => i.collectionId === c)
      .map((i) => i.questionId);
    this.reorder(c, ids);
    this.deletionUndo = {
      token,
      kind: "item",
      collectionId: c,
      questionId: q,
      order,
    };
    return token;
  }
  putPoint(p: KnowledgePoint) {
    this.db
      .prepare("INSERT OR IGNORE INTO knowledge VALUES(?,?)")
      .run(p.name, JSON.stringify(p));
  }
  addPoint(p: KnowledgePoint) {
    this.putPoint(validatePoint(p, this.points()));
  }
  getSetting(k: string, fallback = "") {
    return (
      (
        this.db.prepare("SELECT value FROM settings WHERE key=?").get(k) as
          { value: string } | undefined
      )?.value ?? fallback
    );
  }
  setSetting(k: string, v: string) {
    this.db
      .prepare(
        "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(k, v);
  }
  putJob(j: StoredJob) {
    const old = this.job(j.id);
    if (
      (!old || old.status !== j.status) &&
      ["complete", "failed", "cancelled"].includes(j.status)
    ) {
      this.addHistory({
        title: `${j.type === "solution" ? "AI 解题" : "导入识别"}任务：${({ queued: "等待处理", processing: "开始处理", complete: "处理完成", failed: "处理失败", cancelled: "已取消", paused: "已暂停" } as Record<string, string>)[j.status] ?? j.status}`,
        detail: j.id,
        category: "task",
        status:
          j.status === "failed"
            ? "failed"
            : j.status === "cancelled"
              ? "cancelled"
              : "done",
      });
    }
    this.db
      .prepare(
        "INSERT INTO jobs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(j.id, BigInt(j.createdAt), JSON.stringify(j));
  }
  job(id: string) {
    const row = this.db.prepare("SELECT data FROM jobs WHERE id=?").get(id) as
      { data: string } | undefined;
    return row ? (JSON.parse(row.data) as StoredJob) : undefined;
  }
  page(jobId: string, fileOrdinal: number, pageOrdinal: number) {
    const r = this.db
      .prepare(
        "SELECT data FROM pages WHERE jobId=? AND fileOrdinal=? AND pageOrdinal=?",
      )
      .get(jobId, fileOrdinal, pageOrdinal) as { data: string } | undefined;
    return r ? (JSON.parse(r.data) as SavedPage) : undefined;
  }
  putPage(
    jobId: string,
    fileOrdinal: number,
    pageOrdinal: number,
    p: SavedPage,
  ) {
    this.db
      .prepare(
        "INSERT INTO pages VALUES(?,?,?,?) ON CONFLICT(jobId,fileOrdinal,pageOrdinal) DO UPDATE SET data=excluded.data",
      )
      .run(jobId, fileOrdinal, pageOrdinal, JSON.stringify(p));
  }
  seed() {
    if (this.questions().some((q) => q.example)) return;
    this.db.transaction(() => {
      const samples = [
        [
          "函数单调性",
          "已知函数 \\(f(x)=x^2-2x\\)。\n（1）求函数的对称轴；\n（2）求函数在区间 \\([0,3]\\) 上的值域。",
          "高一",
          "基础",
          "函数单调性",
          "解答题",
        ],
        [
          "等差数列",
          "等差数列 \\((a_n)\\) 满足 \\(a_1=2\\)，\\(a_5=14\\)，则 \\(a_{10}\\) 为：\nA. 26\nB. 27\nC. 28\nD. 29",
          "高二",
          "基础",
          "等差数列",
          "选择题",
        ],
        [
          "导数与极值",
          "已知 \\(f(x)=x^3-3x\\)。\n（1）求 \\(f'(x)\\)；\n（2）讨论函数的单调性并求极值。",
          "高二",
          "进阶",
          "导数与极值最值",
          "解答题",
        ],
      ];
      for (const [title, body, grade, difficulty, knowledge, kind] of samples)
        this.putQuestion({
          ...newQuestion(randomUUID()),
          title,
          body,
          grade,
          difficulty,
          knowledge,
          kind,
          example: true,
          reviewed: true,
          sourceLabel: "示例题",
        });
    })();
  }
  close() {
    this.db.close();
  }
}
export interface StoredJob extends ImportJob {
  paths?: string[];
  labels?: string[];
  autoSolve?: boolean;
  runId?: string;
  fingerprint?: string;
}
export interface SavedPage {
  complete: boolean;
  sourcePath: string;
  questionIds: string[];
  error?: string;
}
