import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/main/store";
import { exportArchive, restoreArchive } from "../src/main/archive";
import { fileOperationMessage, publishFile } from "../src/main/file-operations";
import { newCollection, newQuestion } from "../src/shared/types";
import type { BackupData } from "../src/domain/backup";
import Database from "better-sqlite3";

const disposers: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dispose of disposers.splice(0)) dispose();
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "matheca-recovery-"));
  const store = new Store(path.join(root, "library.sqlite"));
  disposers.push(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  store.putQuestion({ ...newQuestion("local"), body: "本机内容" });
  const data: BackupData = {
    questions: [{ ...newQuestion("incoming"), body: "导入内容" }],
    collections: [newCollection("paper", "题集")],
    items: [{ questionId: "incoming", collectionId: "paper", position: 0 }],
    customKnowledge: [],
    sources: {},
    currentSolutions: [],
    missingSources: 0,
  };
  return { root, store, data, batch: path.join(root, "restored", "new") };
}
it("never reuses or deletes an existing restore directory", () => {
  const f = fixture();
  fs.mkdirSync(f.batch, { recursive: true });
  fs.writeFileSync(path.join(f.batch, "keep.png"), "committed original");
  expect(() => restoreArchive(f.store, f.data, f.root, f.batch)).toThrow();
  expect(fs.readFileSync(path.join(f.batch, "keep.png"), "utf8")).toBe(
    "committed original",
  );
  expect(f.store.questions()).toHaveLength(1);
});
it("disk-full database failure rolls back all rows, removes new files and allows retry", () => {
  const f = fixture();
  const original = path.join(f.root, "original.png");
  fs.writeFileSync(original, "source bytes");
  f.data.sources.incoming = "sources/original.png";
  const before = structuredClone(f.data);
  const failure = vi
    .spyOn(f.store, "putCollection")
    .mockImplementationOnce(() => {
      throw Object.assign(Error("database full"), { code: "SQLITE_FULL" });
    });
  expect(() => restoreArchive(f.store, f.data, f.root, f.batch)).toThrow(
    "full",
  );
  expect(f.store.questions().map((q) => q.id)).toEqual(["local"]);
  expect(f.store.collections()).toEqual([]);
  expect(f.store.items()).toEqual([]);
  expect(fs.existsSync(f.batch)).toBe(false);
  expect(f.data).toEqual(before);
  failure.mockRestore();
  expect(restoreArchive(f.store, f.data, f.root, f.batch).questions).toBe(1);
  expect(
    fs.readFileSync(f.store.question("incoming")!.sourcePath, "utf8"),
  ).toBe("source bytes");
  expect(f.store.db.pragma("integrity_check", { simple: true })).toBe("ok");
});
it.each(["ENOSPC", "EBUSY"])(
  "failed backup publication (%s) preserves old target and cleans temporary output",
  async (code) => {
    const f = fixture(),
      target = path.join(f.root, "backup.zip");
    fs.writeFileSync(target, "existing backup");
    const real = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (to === target)
        throw Object.assign(Error("injected failure"), { code });
      real(from, to);
    });
    await expect(exportArchive(f.store, target)).rejects.toMatchObject({
      code,
    });
    expect(fs.readFileSync(target, "utf8")).toBe("existing backup");
    expect(
      fs.readdirSync(f.root).filter((name) => name.endsWith(".partial")),
    ).toEqual([]);
  },
);
it("flush failure cannot replace an existing document", () => {
  const f = fixture(),
    partial = path.join(f.root, "document.partial"),
    target = path.join(f.root, "document.pdf");
  fs.writeFileSync(partial, "new document");
  fs.writeFileSync(target, "old document");
  vi.spyOn(fs, "fsyncSync").mockImplementationOnce(() => {
    throw Object.assign(Error("disk full"), { code: "ENOSPC" });
  });
  expect(() => publishFile(partial, target)).toThrow("disk full");
  expect(fs.readFileSync(target, "utf8")).toBe("old document");
});
it("asynchronous ZIP source failure rejects and preserves the previous backup", async () => {
  const f = fixture(),
    source = path.join(f.root, "source.png"),
    target = path.join(f.root, "backup.zip");
  fs.writeFileSync(source, "original");
  fs.writeFileSync(target, "previous backup");
  f.store.putQuestion({
    ...newQuestion("source"),
    body: "含原图",
    sourcePath: source,
  });
  const originalStat = fs.statSync;
  let reads = 0;
  vi.spyOn(fs, "statSync").mockImplementation(((file, options) => {
    const stat = originalStat(file, options);
    if (file === source && ++reads === 2) fs.unlinkSync(source);
    return stat;
  }) as typeof fs.statSync);
  await expect(exportArchive(f.store, target)).rejects.toThrow();
  expect(fs.readFileSync(target, "utf8")).toBe("previous backup");
  expect(
    fs.readdirSync(f.root).filter((name) => name.endsWith(".partial")),
  ).toEqual([]);
});
it("failed schema migration keeps a readable protective copy and releases its connection", () => {
  const f = fixture(),
    legacyPath = path.join(f.root, "legacy.sqlite");
  const legacy = new Database(legacyPath);
  legacy.exec(
    "CREATE TABLE questions(id TEXT PRIMARY KEY, data TEXT); INSERT INTO questions VALUES('old','retained'); PRAGMA user_version=0;",
  );
  legacy.close();
  expect(() => new Store(legacyPath)).toThrow();
  const backup = fs
    .readdirSync(f.root)
    .find((name) => name.startsWith("legacy.sqlite.before-v1-"));
  expect(backup).toBeTruthy();
  for (const file of [legacyPath, path.join(f.root, backup!)]) {
    const db = new Database(file);
    expect(
      db.prepare("SELECT data FROM questions WHERE id='old'").get(),
    ).toEqual({ data: "retained" });
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    db.close();
  }
  fs.renameSync(legacyPath, legacyPath + ".recovered");
});
it("file publication replaces complete content and removes the temporary name", () => {
  const f = fixture(),
    partial = path.join(f.root, "complete.partial"),
    target = path.join(f.root, "complete.pdf");
  fs.writeFileSync(partial, "complete document");
  fs.writeFileSync(target, "old");
  publishFile(partial, target);
  expect(fs.readFileSync(target, "utf8")).toBe("complete document");
  expect(fs.existsSync(partial)).toBe(false);
});
it.each(["SQLITE_FULL", "ENOSPC", "EBUSY", "EACCES", "EPERM"])(
  "explains recoverable %s failures",
  (code) => {
    expect(
      fileOperationMessage(Object.assign(Error("native details"), { code })),
    ).toMatch(/重试/);
    expect(
      fileOperationMessage(Object.assign(Error("native details"), { code })),
    ).not.toContain("native details");
  },
);
