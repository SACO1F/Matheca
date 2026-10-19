import { it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store, type StoredJob } from "../src/main/store";
import { describeOperation } from "../src/main/history";
import { newQuestion, newCollection } from "../src/shared/types";
function fixture() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "matheca-history-"));
  const file = path.join(folder, "library.sqlite");
  const store = new Store(file);
  return {
    store,
    file,
    dispose: () => {
      store.close();
      fs.rmSync(folder, { recursive: true, force: true });
    },
  };
}
it("persists history independently of deleted questions and collections", () => {
  const f = fixture();
  try {
    f.store.saveQuestion({
      ...newQuestion("q"),
      title: "测试题",
      body: "题干",
    });
    f.store.addHistory({
      title: "删除题目",
      detail: "测试题",
      category: "operation",
      status: "done",
    });
    f.store.deleteQuestion("q");
    const other = new Store(f.file);
    try {
      expect(other.history().records[0].detail).toBe("测试题");
    } finally {
      other.close();
    }
  } finally {
    f.dispose();
  }
});
it("paginates all history newest first and searches literal SQL wildcards", () => {
  const f = fixture();
  try {
    for (let index = 0; index < 125; index++)
      f.store.addHistory({
        title: "步骤 " + index,
        detail: index === 124 ? "100%_完成" : "",
        category: "operation",
        status: "done",
      });
    expect(f.store.history(5).records.map((entry) => entry.title)).toEqual(
      [124, 123, 122, 121, 120].map((n) => "步骤 " + n),
    );
    expect(f.store.history(100, 100).records).toHaveLength(25);
    expect(f.store.history().total).toBe(125);
    expect(f.store.history(100, 0, "%_").total).toBe(1);
  } finally {
    f.dispose();
  }
});
it("adds history to existing v1 databases without touching question data", () => {
  const f = fixture();
  try {
    f.store.saveQuestion({ ...newQuestion("q"), body: "保留内容" });
    f.store.db.exec("DROP TABLE history");
    const other = new Store(f.file);
    try {
      expect(other.question("q")?.body).toBe("保留内容");
      expect(other.history().total).toBe(0);
    } finally {
      other.close();
    }
  } finally {
    f.dispose();
  }
});
it("audit descriptions retain entity names before deletion and omit credentials", () => {
  const f = fixture();
  try {
    f.store.saveQuestion({
      ...newQuestion("q"),
      title: "函数题",
      body: "内容",
    });
    f.store.saveCollection(newCollection("c", "期末卷"));
    expect(
      describeOperation(f.store, "question:save", [
        { id: "q", favorite: true },
        true,
      ])?.title,
    ).toBe("确认题目已校对");
    expect(describeOperation(f.store, "question:delete", ["q"])?.detail).toBe(
      "函数题",
    );
    expect(
      describeOperation(f.store, "collection:remove", ["c", "q"])?.detail,
    ).toContain("期末卷 · 函数题");
    expect(
      describeOperation(f.store, "settings:save", [
        { apiKey: "secret-token", address: "private-address" },
      ]),
    ).toBeUndefined();
    expect(describeOperation(f.store, "history:list", [])).toBeUndefined();
  } finally {
    f.dispose();
  }
});
it("records task state transitions once, without logging every progress update", () => {
  const f = fixture();
  try {
    const job = {
      id: "j",
      type: "solution",
      status: "processing",
      createdAt: "1",
      completed: 0,
      total: 3,
      message: "",
      paths: [],
      labels: [],
      autoSolve: false,
    } as StoredJob;
    f.store.putJob(job);
    f.store.putJob({ ...job, completed: 1 });
    f.store.putJob({
      ...job,
      status: "failed",
      message: "secret upstream payload",
    });
    expect(f.store.history().total).toBe(1);
    expect(f.store.history().records[0].status).toBe("failed");
    expect(JSON.stringify(f.store.history())).not.toContain(
      "secret upstream payload",
    );
  } finally {
    f.dispose();
  }
});
it("hides legacy interface noise in counts, pagination, searches and recent five", () => {
  const f = fixture();
  try {
    f.store.addHistory({
      title: "保存题目",
      detail: "函数题",
      category: "operation",
      status: "done",
    });
    f.store.addHistory({
      title: "筛选题库",
      detail: "年级：高一",
      category: "interaction",
      status: "done",
    });
    for (const title of [
      "进入题库",
      "进入历史记录",
      "点击：关闭题目校对",
      "选中题目",
      "编辑：题干与小题",
    ])
      f.store.addHistory({
        title,
        detail: "",
        category: "interaction",
        status: "done",
      });
    f.store.addHistory({
      title: "打开应用",
      detail: "",
      category: "application",
      status: "done",
    });
    f.store.addHistory({
      title: "保存设置",
      detail: "",
      category: "operation",
      status: "done",
    });
    expect(f.store.history().total).toBe(2);
    expect(f.store.history(5).records.map((entry) => entry.title)).toEqual([
      "筛选题库",
      "保存题目",
    ]);
    expect(f.store.history(100, 0, "进入").total).toBe(0);
    expect(
      (
        f.store.db.prepare("SELECT COUNT(*) AS total FROM history").get() as {
          total: number;
        }
      ).total,
    ).toBe(9);
  } finally {
    f.dispose();
  }
});
