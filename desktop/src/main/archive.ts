import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import yauzl from "yauzl";
import yazl from "yazl";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import {
  decodeBackup,
  encodeBackup,
  limits,
  sourceEntry,
  type BackupData,
} from "../domain/backup";
import { fingerprint } from "./fingerprint";
import { Store } from "./store";
import { publishFile } from "./file-operations";
import type { RestoreResult } from "../shared/types";
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc = (data: Buffer, value = 0xffffffff) => {
  for (const b of data) value = crcTable[(value ^ b) & 255] ^ (value >>> 8);
  return value;
};
export async function inspectArchive(
  file: string,
  staging: string,
): Promise<BackupData> {
  if (fs.statSync(file).size > limits.archive)
    throw Error("备份文件超过 512 MB");
  fs.mkdirSync(staging, { recursive: true });
  const entries = new Set<string>();
  let total = 0,
    manifest = "";
  await new Promise<void>((resolve, reject) =>
    yauzl.open(
      file,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) return reject(Error("无法读取 ZIP 备份"));
        const fail = (e: unknown) => {
          zip.close();
          reject(e instanceof Error ? e : Error("备份读取失败"));
        };
        zip.on("error", fail);
        zip.on("end", () => resolve());
        zip.on("entry", (entry: yauzl.Entry) => {
          const name = entry.fileName,
            max = name === "manifest.json" ? limits.manifest : limits.image;
          if (
            entries.has(name) ||
            !(name === "manifest.json" || sourceEntry(name)) ||
            entry.uncompressedSize > max ||
            entry.generalPurposeBitFlag & 1
          )
            return fail(Error("ZIP 条目重复、路径无效或超过限制"));
          entries.add(name);
          total += entry.uncompressedSize;
          if (total > limits.archive)
            return fail(Error("备份解压内容超过 512 MB"));
          zip.openReadStream(entry, async (err, stream) => {
            if (err || !stream) return fail(Error("备份条目读取失败"));
            let length = 0,
              sum = 0xffffffff;
            const chunks: Buffer[] = [];
            const hash = createHash("sha256");
            const target =
              name === "manifest.json"
                ? null
                : path.join(staging, path.basename(name));
            let fd: number | undefined;
            try {
              if (target) fd = fs.openSync(target, "wx");
              for await (const raw of stream) {
                const chunk = Buffer.from(raw);
                length += chunk.length;
                if (length > max || length > entry.uncompressedSize)
                  throw Error("备份条目长度无效");
                sum = crc(chunk, sum);
                hash.update(chunk);
                if (fd !== undefined) fs.writeSync(fd, chunk);
                else chunks.push(chunk);
              }
              if (fd !== undefined) {
                fs.closeSync(fd);
                fd = undefined;
              }
              if (
                length !== entry.uncompressedSize ||
                (sum ^ 0xffffffff) >>> 0 !== entry.crc32
              )
                throw Error("备份 CRC 校验失败");
              if (name === "manifest.json")
                manifest = new TextDecoder("utf-8", { fatal: true }).decode(
                  Buffer.concat(chunks),
                );
              else if (hash.digest("hex") !== path.basename(name).split(".")[0])
                throw Error("原图哈希校验失败");
              zip.readEntry();
            } catch (e) {
              if (fd !== undefined) fs.closeSync(fd);
              fail(e);
            }
          });
        });
        zip.readEntry();
      },
    ),
  );
  if (!manifest) throw Error("备份缺少清单");
  const data = decodeBackup(manifest),
    expected = new Set(["manifest.json", ...Object.values(data.sources)]);
  if (
    expected.size !== entries.size ||
    [...expected].some((e) => !entries.has(e))
  )
    throw Error("备份缺少原图或包含额外文件");
  return data;
}
export async function exportArchive(
  store: Store,
  target: string,
  selection?: { questionIds: string[]; collectionIds: string[] },
): Promise<number> {
  const snapshot = store.db.transaction(() => ({
    questions: store.questions(),
    collections: store.collections(),
    items: store.items(),
    customKnowledge: store.points(),
  }))();
  if (selection) {
    const cs = new Set(selection.collectionIds);
    const qs = new Set([
      ...selection.questionIds,
      ...snapshot.items
        .filter((i) => cs.has(i.collectionId))
        .map((i) => i.questionId),
    ]);
    if (
      [...cs].some((id) => !snapshot.collections.some((c) => c.id === id)) ||
      [...qs].some((id) => !snapshot.questions.some((q) => q.id === id))
    )
      throw Error("所选题目或题集已变化，请重新选择");
    snapshot.questions = snapshot.questions.filter((q) => qs.has(q.id));
    snapshot.collections = snapshot.collections.filter((c) => cs.has(c.id));
    snapshot.items = snapshot.items.filter((i) => cs.has(i.collectionId));
  }
  const questions = snapshot.questions,
    sources: Record<string, string> = Object.create(null),
    files = new Map<string, string>(),
    currentSolutions: string[] = [];
  let missingSources = 0;
  for (const q of questions) {
    if (q.solution && q.solutionFingerprint === fingerprint(q))
      currentSolutions.push(q.id);
    if (!q.sourcePath) continue;
    if (!fs.existsSync(q.sourcePath)) {
      missingSources++;
      continue;
    }
    if (fs.statSync(q.sourcePath).size > limits.image)
      throw Error("原图超过 50 MB");
    const hash = createHash("sha256");
    for await (const chunk of fs.createReadStream(q.sourcePath))
      hash.update(chunk);
    let ext = path.extname(q.sourcePath).slice(1).toLowerCase();
    if (!["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(ext))
      ext = "img";
    const entry = `sources/${hash.digest("hex")}.${ext}`;
    sources[q.id] = entry;
    files.set(entry, q.sourcePath);
  }
  const data: BackupData = {
    questions,
    collections: snapshot.collections,
    items: snapshot.items,
    customKnowledge: snapshot.customKnowledge,
    sources,
    currentSolutions,
    missingSources,
  };
  const text = encodeBackup(data);
  const total =
    Buffer.byteLength(text) +
    [...files.values()].reduce((n, f) => n + fs.statSync(f).size, 0);
  if (total > limits.archive) throw Error("备份内容超过 512 MB");
  const zip = new yazl.ZipFile();
  // yazl reports source-file failures on ZipFile, not just its output stream.
  // Forward them into pipeline so a disappearing/locked source cannot crash
  // the worker or leave an unresolved export with an open partial file.
  zip.on("error", (error) => (zip.outputStream as Readable).destroy(error));
  zip.addBuffer(Buffer.from(text), "manifest.json");
  for (const [entry, file] of files) zip.addFile(file, entry);
  zip.end();
  const partial = target + "." + randomUUID() + ".partial";
  try {
    await pipeline(zip.outputStream, fs.createWriteStream(partial));
    if (fs.statSync(partial).size > limits.archive)
      throw Error("备份超过 512 MB");
    publishFile(partial, target);
  } catch (e) {
    fs.rmSync(partial, { force: true });
    throw e;
  }
  return missingSources;
}
export function restoreArchive(
  store: Store,
  data: BackupData,
  staging: string,
  batch: string,
  replace = false,
): RestoreResult {
  // This operation owns exactly one fresh directory. Never reuse and then
  // remove an existing committed batch when a later restore step fails.
  fs.mkdirSync(path.dirname(batch), { recursive: true });
  fs.mkdirSync(batch);
  let knowledgePoints = 0,
    questions: typeof data.questions = [],
    collections: typeof data.collections = [];
  try {
    store.db.transaction(() => {
      const localQ = new Set(store.questions().map((q) => q.id)),
        localC = new Set(store.collections().map((c) => c.id));
      questions = data.questions
        .filter((q) => replace || !localQ.has(q.id))
        .map((q) => ({ ...q }));
      collections = data.collections.filter(
        (c) => replace || !localC.has(c.id),
      );
      const newC = new Set(collections.map((c) => c.id));
      for (const q of questions) {
        const entry = data.sources[q.id];
        if (entry) {
          q.sourcePath = path.join(batch, path.basename(entry));
          if (!fs.existsSync(q.sourcePath))
            fs.copyFileSync(
              path.join(staging, path.basename(entry)),
              q.sourcePath,
            );
        }
        q.solutionFingerprint = data.currentSolutions.includes(q.id)
          ? fingerprint(q)
          : "";
        store.putQuestion(q);
      }
      for (const c of collections) {
        if (replace)
          store.db.prepare("DELETE FROM items WHERE collectionId=?").run(c.id);
        store.putCollection(c);
      }
      const positions = new Map<string, number>();
      for (const i of [...data.items]
        .filter((i) => newC.has(i.collectionId))
        .sort((a, b) => a.position - b.position)) {
        const position = positions.get(i.collectionId) ?? 0;
        store.db
          .prepare("INSERT INTO items VALUES(?,?,?)")
          .run(i.collectionId, i.questionId, position);
        positions.set(i.collectionId, position + 1);
      }
      const names = new Set(store.points().map((p) => p.name));
      for (const p of data.customKnowledge)
        if (!names.has(p.name)) {
          store.putPoint(p);
          names.add(p.name);
          knowledgePoints++;
        }
      store.db
        .prepare("INSERT INTO batches VALUES(?,?)")
        .run(path.basename(batch), batch);
    })();
  } catch (e) {
    fs.rmSync(batch, { recursive: true, force: true });
    throw e;
  }
  return {
    questions: questions.length,
    collections: collections.length,
    skippedQuestions: data.questions.length - questions.length,
    skippedCollections: data.collections.length - collections.length,
    knowledgePoints,
  };
}
