import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import yauzl from "yauzl";
import { createHash } from "node:crypto";
import {
  manifestName,
  sha256,
  verifyPortable,
} from "./tauri-release-contract.mjs";

const args = process.argv.slice(2);
const index = args.indexOf("--exe");
const exe = path.resolve(
  index < 0
    ? fs
        .readFileSync("releases/latest-tauri.txt", "utf8")
        .match(/^EXE: (.+)$/m)[1]
        .trim()
    : args[index + 1],
);
const root = path.dirname(exe);
const result = verifyPortable(root);
const release = path.dirname(root);
const archive = path.join(release, "Matheca-Tauri-win32-x64.zip");
const expected = new Map(result.entries);
expected.set(
  manifestName,
  sha256(fs.readFileSync(path.join(root, manifestName))),
);
if (fs.existsSync(archive)) {
  const seen = new Set();
  await new Promise((resolve, reject) =>
    yauzl.open(
      archive,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error) return reject(error);
        const fail = (error) => {
          zip.close();
          reject(error);
        };
        zip.on("error", fail);
        zip.on("end", () => {
          try {
            assert.equal(seen.size, expected.size, "ZIP file set differs");
            resolve();
          } catch (error) {
            reject(error);
          }
        });
        zip.on("entry", (entry) => {
          try {
            const prefix = "Matheca-win32-x64/";
            assert.ok(entry.fileName.startsWith(prefix), "Unexpected ZIP root");
            const name = entry.fileName.slice(prefix.length);
            assert.ok(
              expected.has(name) && !seen.has(name),
              "Unexpected/duplicate ZIP entry: " + name,
            );
            assert.equal(
              entry.uncompressedSize,
              fs.statSync(path.join(root, name)).size,
            );
            seen.add(name);
            zip.openReadStream(entry, (error, stream) => {
              if (error) return fail(error);
              const digest = createHash("sha256");
              stream.on("data", (bytes) => digest.update(bytes));
              stream.on("error", fail);
              stream.on("end", () => {
                try {
                  assert.equal(
                    digest.digest("hex"),
                    expected.get(name),
                    `ZIP bytes differ: ${name}`,
                  );
                  zip.readEntry();
                } catch (error) {
                  fail(error);
                }
              });
            });
          } catch (error) {
            fail(error);
          }
        });
        zip.readEntry();
      },
    ),
  );
}
// Verify failures without touching the release: isolate a complete disposable copy.
const output = path.resolve(
  "test-output",
  `tauri-phase9-release-${Date.now()}`,
);
fs.mkdirSync(output, { recursive: true });
const copy = path.join(output, "tamper-fixture");
fs.cpSync(root, copy, { recursive: true });
fs.appendFileSync(path.join(copy, "heif.dll"), Buffer.from("synthetic tamper"));
assert.throws(() => verifyPortable(copy), /校验失败/);
fs.copyFileSync(path.join(root, "heif.dll"), path.join(copy, "heif.dll"));
fs.renameSync(
  path.join(copy, "vcruntime140.dll"),
  path.join(copy, "vcruntime140.dll.missing"),
);
assert.throws(() => verifyPortable(copy), /缺少运行文件/);
fs.renameSync(
  path.join(copy, "vcruntime140.dll.missing"),
  path.join(copy, "vcruntime140.dll"),
);
fs.writeFileSync(
  path.join(copy, "library.sqlite"),
  "synthetic forbidden database",
);
assert.throws(() => verifyPortable(copy), /混入/);
fs.writeFileSync(
  path.join(output, "REPORT.md"),
  `# Phase 9 portable resource audit\n\nEXE: ${exe}\nEXE SHA256: ${sha256(fs.readFileSync(exe))}\n\n- PASS: ${result.files} files match complete SHA256 inventory\n- PASS: EXE and five native DLLs are Windows x64 PE\n- PASS: runtime resources, native/Rust licenses and usage documentation present\n- PASS: no bundled Node/Electron runtime, development output or library data\n- PASS: isolated resource tamper, missing DLL and database injection are rejected\n- ${fs.existsSync(archive) ? "PASS: every ZIP entry exactly matches the portable directory" : "NOTE: no adjacent ZIP in this extracted test directory; original ZIP audit must run separately"}\n\nComplete directory: ${(result.bytes / 1024 / 1024).toFixed(2)} MiB.\n`,
);
console.log(
  `PASS portable resource audit: ${result.files} files, ${(result.bytes / 1024 / 1024).toFixed(2)} MiB. Evidence: ${output}`,
);
