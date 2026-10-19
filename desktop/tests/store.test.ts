import { it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/main/store";
import {
  restoreArchive,
  exportArchive,
  inspectArchive,
} from "../src/main/archive";
import { newQuestion, newCollection } from "../src/shared/types";
import { fingerprint } from "../src/main/fingerprint";
import type { BackupData } from "../src/domain/backup";
function fixture() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "matheca-store-"));
  const store = new Store(path.join(folder, "library.sqlite"));
  return {
    folder,
    store,
    dispose: () => {
      store.close();
      fs.rmSync(folder, { recursive: true, force: true });
    },
  };
}
function backup(): BackupData {
  return {
    questions: [
      {
        ...newQuestion("q"),
        body: "题干",
        reviewed: true,
        solution: "答案",
        createdAt: "9223372036854775807",
      },
    ],
    collections: [newCollection("c", "题集")],
    items: [{ collectionId: "c", questionId: "q", position: 6 }],
    customKnowledge: [{ group: "函数", name: "自定义图像" }],
    sources: {},
    currentSolutions: ["q"],
    missingSources: 0,
  };
}
it("cleans saved blank manual entries while keeping content and imported entries", () => {
  const f = fixture();
  try {
    f.store.putQuestion(newQuestion("blank-manual"));
    f.store.putQuestion({ ...newQuestion("text"), body: "题干" });
    f.store.putQuestion({ ...newQuestion("formula"), latex: "x^2" });
    f.store.putQuestion({
      ...newQuestion("image"),
      figures: ["data:image/png;base64,abc"],
    });
    f.store.putQuestion({ ...newQuestion("import"), sourceLabel: "识别导入" });
    expect(f.store.cleanupEmptyManualQuestions()).toBe(1);
    expect(
      f.store
        .questions()
        .map((question) => question.id)
        .sort(),
    ).toEqual(["formula", "image", "import", "text"]);
  } finally {
    f.dispose();
  }
});
it("undoes only newly added collection members, preserves ordering and rejects stale additions", () => {
  const f = fixture();
  try {
    for (const id of ["a", "b", "c"]) f.store.putQuestion(newQuestion(id));
    f.store.putCollection(newCollection("paper", "题集"));
    f.store.addQuestions("paper", ["a", "b"]);
    const result = f.store.addQuestionsWithUndo("paper", ["a", "c", "c"]);
    expect(result.count).toBe(1);
    f.store.reorder("paper", ["c", "b", "a"]);
    f.store.undoAddition(result.token!);
    expect(f.store.items().map((i) => i.questionId)).toEqual(["b", "a"]);
    expect(f.store.questions()).toHaveLength(3);
    expect(() => f.store.undoAddition(result.token!)).toThrow();
    expect(f.store.addQuestionsWithUndo("paper", ["a"])).toEqual({ count: 0 });
    const stale = f.store.addQuestionsWithUndo("paper", ["c"]);
    f.store.removeQuestion("paper", "c");
    f.store.addQuestions("paper", ["c"]);
    expect(() => f.store.undoAddition(stale.token!)).toThrow();
  } finally {
    f.dispose();
  }
});
it("round trips per-collection question layout through backup", () => {
  const f = fixture();
  try {
    f.store.putQuestion(newQuestion("q"));
    const c = {
      ...newCollection("c", "排版"),
      questionLayout: { q: { answerSpaceMm: 75, pageBreakBefore: true } },
    };
    f.store.putCollection(c);
    f.store.addQuestions("c", ["q"]);
    const target = path.join(f.folder, "layout.zip");
    return exportArchive(f.store, target)
      .then(() => inspectArchive(target, path.join(f.folder, "staging")))
      .then((data) => {
        expect(data.collections[0].questionLayout).toEqual(c.questionLayout);
      })
      .finally(() => f.dispose());
  } catch (e) {
    f.dispose();
    throw e;
  }
});
it("counts recognized questions from saved pages without duplicating retries or losing deleted results", () => {
  const f = fixture();
  try {
    f.store.putJob({
      id: "import-details",
      type: "import",
      status: "partial",
      message: "",
      createdAt: "1",
      completed: 2,
      total: 3,
    });
    const saved = { complete: true, sourcePath: "", questionIds: ["q1", "q2"] };
    f.store.putPage("import-details", 0, 0, saved);
    f.store.putPage("import-details", 0, 0, saved);
    f.store.putPage("import-details", 0, 1, {
      ...saved,
      questionIds: ["q2", "q3"],
    });
    f.store.putPage("import-details", 1, 0, {
      complete: false,
      sourcePath: "",
      questionIds: ["invalid"],
    });
    expect(
      f.store.importDetails("import-details", ["试卷.pdf", "截图.png"]),
    ).toEqual({
      recognizedCount: 3,
      questionIds: ["q1", "q2", "q3"],
      sourceFiles: [
        { name: "试卷.pdf", recognizedCount: 3, completedPages: 2 },
        { name: "截图.png", recognizedCount: 0, completedPages: 0 },
      ],
    });
    f.store.putPage("import-details", 1, 0, { ...saved, questionIds: ["q4"] });
    expect(
      f.store.importDetails("import-details", ["试卷.pdf", "截图.png"])
        .recognizedCount,
    ).toBe(4);
    expect(
      f.store.importDetails("import-details", []).sourceFiles[0].name,
    ).toBe("文件 1");
    expect(f.store.importDetails("absent", [])).toEqual({
      recognizedCount: 0,
      questionIds: [],
      sourceFiles: [],
    });
  } finally {
    f.dispose();
  }
});
it("SQLite preserves exact Long boundaries and answer/review independence", () => {
  const f = fixture();
  try {
    const q = backup().questions[0];
    q.solutionFingerprint = fingerprint(q);
    f.store.putQuestion(q);
    expect(f.store.questions()[0].createdAt).toBe("9223372036854775807");
    let saved = f.store.saveQuestion({ ...q, latex: "x^2" });
    expect(saved.reviewed).toBe(true);
    expect(saved.solution).toBe("");
    saved = f.store.saveQuestion({ ...saved, body: "新题干" });
    expect(saved.reviewed).toBe(false);
    expect(f.store.saveQuestion(saved, true).reviewed).toBe(true);
  } finally {
    f.dispose();
  }
});
it("restore rebuilds fingerprints, normalizes positions and keeps local IDs", () => {
  const f = fixture();
  try {
    const d = backup(),
      stage = path.join(f.folder, "stage");
    fs.mkdirSync(stage);
    expect(
      restoreArchive(f.store, d, stage, path.join(f.folder, "batch")).questions,
    ).toBe(1);
    expect(f.store.question("q")!.solutionFingerprint).toBe(
      fingerprint(f.store.question("q")!),
    );
    expect(f.store.items()[0].position).toBe(0);
    f.store.saveQuestion({ ...f.store.question("q")!, body: "本机编辑" });
    const again = restoreArchive(
      f.store,
      backup(),
      stage,
      path.join(f.folder, "batch2"),
    );
    expect(again.questions).toBe(0);
    expect(f.store.question("q")!.body).toBe("本机编辑");
    expect(f.store.points()).toHaveLength(1);
    expect(f.store.jobs()).toHaveLength(0);
  } finally {
    f.dispose();
  }
});
it("new collection can reference locally existing question without changing it", () => {
  const f = fixture();
  try {
    f.store.putQuestion({ ...newQuestion("q"), body: "本机" });
    const d = backup();
    restoreArchive(f.store, d, f.folder, path.join(f.folder, "batch"));
    expect(f.store.question("q")!.body).toBe("本机");
    expect(f.store.items()).toHaveLength(1);
  } finally {
    f.dispose();
  }
});
it("copy failure rolls back the entire restore and deletes only new batch", () => {
  const f = fixture();
  try {
    f.store.putQuestion(newQuestion("local"));
    const d = backup();
    d.questions.push(newQuestion("missing"));
    d.sources.missing = "sources/" + "a".repeat(64) + ".png";
    const batch = path.join(f.folder, "batch");
    expect(() => restoreArchive(f.store, d, f.folder, batch)).toThrow();
    expect(f.store.questions().map((q) => q.id)).toEqual(["local"]);
    expect(f.store.collections()).toHaveLength(0);
    expect(f.store.points()).toHaveLength(0);
    expect(fs.existsSync(batch)).toBe(false);
  } finally {
    f.dispose();
  }
});
it("transaction fault rolls back originals, questions, collections and knowledge", () => {
  const f = fixture();
  try {
    f.store.db.exec(
      "CREATE TRIGGER fail_batch BEFORE INSERT ON batches BEGIN SELECT RAISE(ABORT,'injected fault'); END;",
    );
    const batch = path.join(f.folder, "batch");
    expect(() => restoreArchive(f.store, backup(), f.folder, batch)).toThrow(
      "injected",
    );
    expect(f.store.questions()).toHaveLength(0);
    expect(f.store.collections()).toHaveLength(0);
    expect(f.store.items()).toHaveLength(0);
    expect(f.store.points()).toHaveLength(0);
    expect(fs.existsSync(batch)).toBe(false);
  } finally {
    f.dispose();
  }
});
it("export and restore preserve original bytes, order and valid solutions", async () => {
  const f = fixture();
  try {
    const image = path.join(f.folder, "original.png"),
      bytes = Buffer.from("exact original bytes");
    fs.writeFileSync(image, bytes);
    const q = { ...backup().questions[0], sourcePath: image };
    q.solutionFingerprint = fingerprint(q);
    f.store.putQuestion(q);
    f.store.putCollection(newCollection("c", "练习"));
    f.store.addQuestions("c", ["q", "q"]);
    f.store.addPoint({ group: "函数", name: "测试公式" });
    const zip = path.join(f.folder, "out.zip");
    expect(await exportArchive(f.store, zip)).toBe(0);
    const stage = path.join(f.folder, "stage"),
      decoded = await inspectArchive(zip, stage);
    expect(decoded.currentSolutions).toEqual(["q"]);
    expect(decoded.questions[0].createdAt).toBe(q.createdAt);
    expect(
      fs.readFileSync(path.join(stage, path.basename(decoded.sources.q))),
    ).toEqual(bytes);
    expect(decoded.items).toEqual([
      { collectionId: "c", questionId: "q", position: 0 },
    ]);
  } finally {
    f.dispose();
  }
});

it("persists extracted figures through saving and backup inspection", async () => {
  const f = fixture(),
    image = "data:image/png;base64,iVBORw0KGgo=";
  try {
    const q = {
      ...newQuestion("figure-test"),
      body: "有图题目",
      kind: "选择题",
      figures: [image],
      figureWidths: [120],
      figurePlacements: ["A"] as ["A"],
    };
    f.store.saveQuestion(q);
    expect(f.store.question(q.id)?.figures).toEqual([image]);
    expect(f.store.question(q.id)?.figureWidths).toEqual([120]);
    const saved = f.store.saveQuestion(q, true);
    expect(
      f.store.saveQuestion({ ...saved, figureWidths: [60] }).reviewed,
    ).toBe(true);
    expect(() =>
      f.store.saveQuestion({ ...saved, figureWidths: [170] }),
    ).toThrow();
    const archive = path.join(f.folder, "figures.zip");
    await exportArchive(f.store, archive);
    const data = await inspectArchive(archive, path.join(f.folder, "preview"));
    expect(data.questions[0].figures).toEqual([image]);
    expect(data.questions[0].figureWidths).toEqual([60]);
    expect(data.questions[0].figurePlacements).toEqual(["A"]);
    const prior = f.store.question(q.id)!;
    expect(
      f.store.saveQuestion({ ...prior, figurePlacements: ["B"] }).reviewed,
    ).toBe(false);
    f.store.saveQuestion(prior, true);
    const changed = f.store.saveQuestion(
      { ...prior, figurePlacements: ["C"] },
      true,
    );
    expect(f.store.undoReview(changed).figurePlacements).toEqual(["A"]);
  } finally {
    f.store.db.close();
    fs.rmSync(f.folder, { recursive: true, force: true });
  }
});

it("undoes the confirmed edit including figures and metadata, restoring prior reviewed state", () => {
  const f = fixture();
  try {
    const before = f.store.saveQuestion(
      {
        ...newQuestion("review-undo"),
        body: "原题干",
        grade: "高一",
        figures: ["data:image/png;base64,iVBORw0KGgo="],
        figureWidths: [80],
      },
      true,
    );
    const saved = f.store.saveQuestion(
      { ...before, body: "新题干", grade: "高二", figureWidths: [120] },
      true,
    );
    const undone = f.store.undoReview(saved);
    expect(undone.body).toBe("原题干");
    expect(undone.grade).toBe("高一");
    expect(undone.figureWidths).toEqual([80]);
    expect(undone.reviewed).toBe(true);
    expect(() => f.store.undoReview(saved)).toThrow();
    const next = f.store.saveQuestion({ ...undone, body: "下一次修改" }, true);
    f.store.saveQuestion(next, true);
    expect(f.store.undoReview(next).body).toBe("原题干");
  } finally {
    f.dispose();
  }
});
it("refuses stale/deleted undo, and retains compatible asynchronous solutions", () => {
  const f = fixture();
  try {
    const before = f.store.saveQuestion({
      ...newQuestion("review-undo"),
      body: "原题干",
    });
    const saved = f.store.saveQuestion({ ...before, figureWidths: [] }, true);
    f.store.putQuestion({
      ...saved,
      solution: "兼容的解题结果",
      solutionFingerprint: fingerprint(saved),
    });
    expect(f.store.undoReview(saved).solution).toBe("兼容的解题结果");
    const next = f.store.saveQuestion({ ...before, body: "新题干" }, true);
    f.store.saveQuestion({ ...next, body: "后续编辑" });
    expect(() => f.store.undoReview(next)).toThrow();
    const latest = f.store.saveQuestion({ ...next, body: "另一次修改" }, true);
    expect(() => f.store.undoReview(next)).toThrow();
    f.store.deleteQuestion(latest.id);
    expect(() => f.store.undoReview(latest)).toThrow();
  } finally {
    f.dispose();
  }
});

it("undoes library deletion with figures and original placements in multiple collections", () => {
  const f = fixture();
  try {
    const qs = ["a", "b", "c"].map((id) =>
      f.store.saveQuestion(
        {
          ...newQuestion(id),
          body: id,
          figures: ["data:image/png;base64,iVBORw0KGgo="],
          figureWidths: [80],
        },
        true,
      ),
    );
    for (const id of ["one", "two"]) {
      f.store.saveCollection(newCollection(id, id));
      f.store.addQuestions(
        id,
        qs.map((q) => q.id),
      );
    }
    const token = f.store.deleteQuestion("b");
    expect(f.store.question("b")).toBeUndefined();
    f.store.undoDeletion(token);
    expect(f.store.question("b")).toEqual(qs[1]);
    for (const id of ["one", "two"])
      expect(
        f.store
          .items()
          .filter((i) => i.collectionId === id)
          .map((i) => i.questionId),
      ).toEqual(["a", "b", "c"]);
    expect(() => f.store.undoDeletion(token)).toThrow();
  } finally {
    f.dispose();
  }
});
it("undoes collection deletion with paper settings and ordered items", () => {
  const f = fixture();
  try {
    for (const id of ["a", "b"]) {
      f.store.saveQuestion({ ...newQuestion(id), body: id });
    }
    const c = {
      ...newCollection("one", "原题集"),
      examMinutes: 90,
      totalScore: 150,
      examInstructions: "考试说明",
    };
    f.store.saveCollection(c);
    f.store.addQuestions(c.id, ["b", "a"]);
    const before = f.store.collection(c.id);
    const token = f.store.deleteCollection(c.id);
    f.store.undoDeletion(token);
    expect(f.store.collection(c.id)).toEqual(before);
    expect(f.store.items().map((i) => i.questionId)).toEqual(["b", "a"]);
    expect(f.store.questions()).toHaveLength(2);
  } finally {
    f.dispose();
  }
});
it("restores removed items without losing later additions and refuses stale/conflicting undo", () => {
  const f = fixture();
  try {
    for (const id of ["a", "b", "c", "d"]) {
      f.store.saveQuestion({ ...newQuestion(id), body: id });
    }
    f.store.saveCollection(newCollection("one", "题集"));
    f.store.addQuestions("one", ["a", "b", "c"]);
    const token = f.store.removeQuestion("one", "b");
    f.store.addQuestions("one", ["d"]);
    f.store.undoDeletion(token);
    expect(f.store.items().map((i) => i.questionId)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    const first = f.store.deleteQuestion("a"),
      latest = f.store.deleteQuestion("b");
    expect(() => f.store.undoDeletion(first)).toThrow();
    f.store.saveQuestion({ ...newQuestion("b"), body: "新建的同编号题" });
    expect(() => f.store.undoDeletion(latest)).toThrow();
    expect(f.store.question("b")?.body).toBe("新建的同编号题");
  } finally {
    f.dispose();
  }
});
