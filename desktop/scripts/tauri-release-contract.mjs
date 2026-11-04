import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const manifestName = "PORTABLE_FILES.sha256";
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export function filesIn(root, relative = "") {
  return fs
    .readdirSync(path.join(root, relative), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .flatMap((entry) => {
      const name = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw Error(`便携目录不能包含链接：${name}`);
      if (entry.isDirectory()) return filesIn(root, name);
      if (!entry.isFile()) throw Error(`不是普通运行文件：${name}`);
      return [name];
    });
}
export function writeManifest(root) {
  const lines = filesIn(root)
    .filter((name) => name !== manifestName)
    .map(
      (name) => `${sha256(fs.readFileSync(path.join(root, name)))}  ${name}`,
    );
  fs.writeFileSync(path.join(root, manifestName), lines.join("\n") + "\n");
}
function requireX64(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ")
    throw Error(`不是 Windows PE 文件：${file}`);
  const offset = bytes.readUInt32LE(0x3c);
  if (
    offset + 6 > bytes.length ||
    bytes.toString("ascii", offset, offset + 4) !== "PE\0\0" ||
    bytes.readUInt16LE(offset + 4) !== 0x8664
  )
    throw Error(`运行文件不是 Windows x64：${file}`);
}
export function verifyPortable(root) {
  const files = filesIn(root);
  for (const name of [
    "Matheca.exe",
    "heif.dll",
    "libde265.dll",
    "msvcp140.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
  ]) {
    if (!files.includes(name)) throw Error(`缺少运行文件：${name}`);
    requireX64(path.join(root, name));
  }
  for (const name of [
    "README.md",
    "NATIVE_RUNTIME.md",
    "RUST_DEPENDENCIES.txt",
    "THIRD_PARTY_NOTICES.txt",
    "Cargo.lock",
    manifestName,
  ])
    if (!files.includes(name)) throw Error(`缺少交付文件：${name}`);
  for (const group of ["licenses/native/", "licenses/rust/"])
    if (!files.some((name) => name.startsWith(group)))
      throw Error(`缺少许可目录：${group}`);
  for (const name of files)
    if (
      /(^|\/)(node_modules|webview-profile|intake|mobile-inbox|backups)(\/|$)|\.(sqlite(?:-wal|-shm)?|pdb|map|node)$|(^|\/)(node\.exe|electron\.exe|app\.asar|icudtl\.dat|WebView2Loader\.dll)$/i.test(
        name,
      )
    )
      throw Error(`发布目录混入开发、题库或其他运行时文件：${name}`);
  const entries = new Map();
  for (const line of fs
    .readFileSync(path.join(root, manifestName), "utf8")
    .trimEnd()
    .split("\n")) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line.replace(/\r$/, ""));
    if (
      !match ||
      entries.has(match[2]) ||
      !files.includes(match[2]) ||
      match[2] === manifestName
    )
      throw Error("便携文件清单无效");
    entries.set(match[2], match[1]);
  }
  if (entries.size !== files.length - 1) throw Error("目录文件数量与清单不同");
  for (const [name, hash] of entries)
    if (sha256(fs.readFileSync(path.join(root, name))) !== hash)
      throw Error(`运行资源校验失败：${name}`);
  return {
    files: files.length,
    bytes: files.reduce(
      (sum, name) => sum + fs.statSync(path.join(root, name)).size,
      0,
    ),
    entries,
  };
}
