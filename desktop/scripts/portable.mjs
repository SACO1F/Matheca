import { api } from "@electron-forge/core";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
).version;
const timestamp = new Intl.DateTimeFormat("sv-SE", {
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
// Each build gets a new directory, so a running previous release stays intact.
const outDir = path.join(
  root,
  "releases",
  `v${version}`,
  `${timestamp}-${Date.now()}`,
);
const results = await api.make({
  interactive: true,
  dir: root,
  platform: "win32",
  arch: "x64",
  overrideTargets: ["zip"],
  outDir,
});
const executable = path.join(outDir, "Matheca-win32-x64", "Matheca.exe");
const archive = results
  .flatMap((result) => result.artifacts)
  .find((file) => file.endsWith(".zip"));
if (!fs.existsSync(executable) || !archive || !fs.existsSync(archive)) {
  throw new Error(
    "Portable build did not produce both the application EXE and ZIP.",
  );
}
const sums =
  [executable, archive]
    .map(
      (file) =>
        `${createHash("sha256").update(fs.readFileSync(file)).digest("hex")}  ${path.relative(outDir, file).split(path.sep).join("/")}`,
    )
    .join("\n") + "\n";
fs.writeFileSync(path.join(outDir, "SHA256SUMS.txt"), sums);
const delivery = `EXE: ${executable}\nZIP: ${archive}\nSHA256: ${path.join(outDir, "SHA256SUMS.txt")}\n`;
fs.writeFileSync(path.join(root, "releases", "latest.txt"), delivery);
console.log(delivery);
