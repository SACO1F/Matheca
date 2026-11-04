import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";
import { writeManifest, verifyPortable } from "./tauri-release-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const name of ["cmaps", "standard_fonts", "wasm"])
  fs.cpSync(
    path.join(root, "node_modules/pdfjs-dist", name),
    path.join(root, "public/pdfjs", name),
    { recursive: true },
  );
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error(`${command} exited ${code}`)),
    );
  });
}
await run(process.execPath, [
  "node_modules/vite/bin/vite.js",
  "build",
  "--config",
  "tauri/vite.config.ts",
]);
const targetDir =
  process.env.MATHECA_CARGO_TARGET_DIR || path.join(root, "tauri/native/target");
await run("cargo", [
  "build",
  "--locked",
  ...(process.env.MATHECA_CARGO_OFFLINE === "1" ? ["--offline"] : []),
  "--release",
  "--manifest-path",
  "tauri/native/Cargo.toml",
  "--target-dir",
  targetDir,
]);
const stamp = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
})
  .format(new Date())
  .replace(/[ :]/g, "-");
const out = path.join(
  root,
  "releases/tauri/v0.1.0",
  `${stamp}-${Date.now()}`,
);
const portable = path.join(out, "Matheca-win32-x64");
fs.mkdirSync(portable, { recursive: true });
const executable = path.join(portable, "Matheca.exe");
fs.copyFileSync(path.join(targetDir, "release/matheca.exe"), executable);
const native = process.env.MATHECA_HEIF_BIN || path.join(root, "tauri/runtime/windows-x64");
if (!native)
  throw Error(
    "Set MATHECA_HEIF_BIN to the validated Windows x64 libheif 1.23.2 bundle directory",
  );
const nativeHashes = {
  "heif.dll":
    "75cdb3f8856b6798f1329ce149e9e2d4ffc73f3ea802cdf722d1d037eae0c6a6",
  "libde265.dll":
    "55ac9c3f531459a2a60f889e0832665b004e99255e1674ee93bdc0651f9483a5",
};
for (const name of [
  "heif.dll",
  "libde265.dll",
  "msvcp140.dll",
  "vcruntime140.dll",
  "vcruntime140_1.dll",
]) {
  const source = path.join(native, name);
  const hash = createHash("sha256")
    .update(fs.readFileSync(source))
    .digest("hex");
  if (nativeHashes[name] && nativeHashes[name] !== hash)
    throw Error(`Native runtime hash mismatch: ${name}`);
  fs.copyFileSync(source, path.join(portable, name));
}
fs.cpSync(
  path.join(root, "tauri/runtime/licenses"),
  path.join(portable, "licenses/native"),
  { recursive: true },
);
fs.copyFileSync(
  path.join(root, "docs/NATIVE_RUNTIME.md"),
  path.join(portable, "NATIVE_RUNTIME.md"),
);
const metadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--offline",
      "--locked",
      "--format-version",
      "1",
      "--manifest-path",
      "tauri/native/Cargo.toml",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  ),
);
const rustNotices = [];
for (const pkg of metadata.packages
  .filter((p) => p.source)
  .sort((a, b) => (a.name + a.version).localeCompare(b.name + b.version))) {
  const dir = path.dirname(pkg.manifest_path);
  rustNotices.push(
    `${pkg.name} ${pkg.version}\nLicense: ${pkg.license || pkg.license_file || "see source"}\nSource: ${pkg.repository || pkg.source}\n`,
  );
  const target = path.join(
    portable,
    "licenses/rust",
    `${pkg.name}-${pkg.version}`,
  );
  for (const name of fs
    .readdirSync(dir)
    .filter((n) => /^(LICENSE|LICENCE|COPYING|NOTICE)([.-]|$)/i.test(n))) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isFile()) {
      fs.mkdirSync(target, { recursive: true });
      fs.copyFileSync(file, path.join(target, name));
    }
  }
}
fs.writeFileSync(
  path.join(portable, "RUST_DEPENDENCIES.txt"),
  rustNotices.join("\n"),
);
fs.copyFileSync(
  path.join(root, "docs/TAURI_PREVIEW.md"),
  path.join(portable, "README.md"),
);
const sharedNotices = fs.readFileSync(
  path.join(root, "THIRD_PARTY_NOTICES.txt"),
  "utf8",
);
fs.writeFileSync(
  path.join(portable, "THIRD_PARTY_NOTICES.txt"),
  "Matheca Tauri Windows third-party notices\n" +
    "React, KaTeX/fonts and PDF.js are embedded locally. Native and Rust licenses are in licenses/.\n" +
    "This package uses the system WebView2 and includes no Electron or Node runtime.\n" +
    "The following shared source-project notices are retained in full; some entries apply only to the Electron fallback or build tools.\n\n" +
    sharedNotices.slice(
      sharedNotices.indexOf(
        "========================================================================",
      ),
    ),
);
fs.copyFileSync(
  path.join(root, "tauri/native/Cargo.lock"),
  path.join(portable, "Cargo.lock"),
);
writeManifest(portable);
const checked = verifyPortable(portable);
console.log(`Portable resources verified: ${checked.files} files`);
const zip = new yazl.ZipFile();
function addDirectory(folder, relative = "") {
  for (const name of fs.readdirSync(folder)) {
    const file = path.join(folder, name);
    const entry = path.posix.join(relative, name);
    if (fs.statSync(file).isDirectory()) addDirectory(file, entry);
    else zip.addFile(file, `Matheca-win32-x64/${entry}`);
  }
}
addDirectory(portable);
const archive = path.join(out, "Matheca-Tauri-win32-x64.zip");
const completed = pipeline(
  zip.outputStream,
  fs.createWriteStream(archive, { flags: "wx" }),
);
zip.end();
await completed;
fs.writeFileSync(
  path.join(out, "SHA256SUMS.txt"),
  [executable, archive]
    .map(
      (file) =>
        `${createHash("sha256").update(fs.readFileSync(file)).digest("hex")}  ${path.relative(out, file).split(path.sep).join("/")}`,
    )
    .join("\n") + "\n",
);
const delivery = `EXE: ${executable}\nZIP: ${archive}\nSHA256: ${path.join(out, "SHA256SUMS.txt")}\n`;
fs.writeFileSync(path.join(root, "releases/latest-tauri.txt"), delivery);
console.log(delivery);
