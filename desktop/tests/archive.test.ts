import { it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import yazl from "yazl";
import { inspectArchive } from "../src/main/archive";
import { encodeBackup, type BackupData } from "../src/domain/backup";
import { newQuestion, newCollection } from "../src/shared/types";
async function fixture(entries: Record<string, Buffer>) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "matheca-test-"));
  const file = path.join(folder, "backup.zip");
  const zip = new yazl.ZipFile();
  for (const [name, bytes] of Object.entries(entries))
    zip.addBuffer(bytes, name);
  zip.end();
  await pipeline(zip.outputStream, fs.createWriteStream(file));
  return { file, folder };
}
it("rejects duplicate ZIP entry names", async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "matheca-duplicate-")),
    file = path.join(folder, "backup.zip");
  try {
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from(encodeBackup(data)), "manifest.json");
    zip.addBuffer(Buffer.from(encodeBackup(data)), "manifest.json");
    zip.end();
    await pipeline(zip.outputStream, fs.createWriteStream(file));
    await expect(
      inspectArchive(file, path.join(folder, "images")),
    ).rejects.toThrow("重复");
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
it("rejects parent traversal before extracting a ZIP entry", async () => {
  const { file, folder } = await fixture({
    "manifest.json": Buffer.from(encodeBackup(data)),
  });
  try {
    const bytes = fs.readFileSync(file),
      from = Buffer.from("manifest.json"),
      to = Buffer.from("../secret.txt");
    for (
      let offset = bytes.indexOf(from);
      offset >= 0;
      offset = bytes.indexOf(from, offset + to.length)
    )
      to.copy(bytes, offset);
    fs.writeFileSync(file, bytes);
    await expect(
      inspectArchive(file, path.join(folder, "images")),
    ).rejects.toThrow();
    expect(fs.existsSync(path.join(folder, "secret.txt"))).toBe(false);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
const data: BackupData = {
  questions: [newQuestion("q")],
  collections: [newCollection("c", "题集")],
  items: [{ collectionId: "c", questionId: "q", position: 0 }],
  customKnowledge: [],
  sources: {},
  currentSolutions: [],
  missingSources: 0,
};
it("validates image hashes and accepts exact ZIP v1 entries", async () => {
  const bytes = Buffer.from("original bytes"),
    entry = `sources/${createHash("sha256").update(bytes).digest("hex")}.png`,
    d = { ...data, sources: { q: entry } };
  const { file, folder } = await fixture({
    "manifest.json": Buffer.from(encodeBackup(d)),
    [entry]: bytes,
  });
  try {
    const result = await inspectArchive(file, path.join(folder, "images"));
    expect(result.sources.q).toBe(entry);
    expect(
      fs.readFileSync(path.join(folder, "images", path.basename(entry))),
    ).toEqual(bytes);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
it("rejects extra ZIP files without importing data", async () => {
  const { file, folder } = await fixture({
    "manifest.json": Buffer.from(encodeBackup(data)),
    "extra.txt": Buffer.from("bad"),
  });
  try {
    await expect(
      inspectArchive(file, path.join(folder, "images")),
    ).rejects.toThrow();
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
it("rejects wrong source hash", async () => {
  const entry = "sources/" + "0".repeat(64) + ".jpg";
  const { file, folder } = await fixture({
    "manifest.json": Buffer.from(
      encodeBackup({ ...data, sources: { q: entry } }),
    ),
    [entry]: Buffer.from("bad"),
  });
  try {
    await expect(
      inspectArchive(file, path.join(folder, "images")),
    ).rejects.toThrow("哈希");
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
it("rejects missing referenced image", async () => {
  const { file, folder } = await fixture({
    "manifest.json": Buffer.from(
      encodeBackup({
        ...data,
        sources: { q: "sources/" + "1".repeat(64) + ".png" },
      }),
    ),
  });
  try {
    await expect(
      inspectArchive(file, path.join(folder, "images")),
    ).rejects.toThrow("原图");
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
it("rejects CRC corruption even when deflate is valid", async () => {
  const { file, folder } = await fixture({
    "manifest.json": Buffer.from(encodeBackup(data)),
  });
  try {
    const bytes = fs.readFileSync(file),
      start = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(1, start + 16);
    fs.writeFileSync(file, bytes);
    await expect(
      inspectArchive(file, path.join(folder, "images")),
    ).rejects.toThrow("CRC");
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
