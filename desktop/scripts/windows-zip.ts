import { MakerBase, type MakerOptions } from "@electron-forge/maker-base";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";
// Avoid cross-zip's removed fs.rmdir(recursive) and dependence on a shell ZIP command.
export class WindowsZIP extends MakerBase<Record<string, never>> {
  name = "zip";
  defaultPlatforms: ["win32"] = ["win32"];
  isSupportedOnCurrentPlatform() {
    return true;
  }
  async make({ dir, makeDir, packageJSON, targetArch }: MakerOptions) {
    const target = path.resolve(
      makeDir,
      "zip",
      "win32",
      targetArch,
      `Matheca-win32-${targetArch}-${packageJSON.version}.zip`,
    );
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const zip = new yazl.ZipFile();
    const add = (folder: string) => {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) add(file);
        else if (entry.isFile())
          zip.addFile(file, path.relative(dir, file).split(path.sep).join("/"));
        else throw Error("解压发行包不支持符号链接");
      }
    };
    add(dir);
    zip.end();
    await pipeline(zip.outputStream, fs.createWriteStream(target));
    return [target];
  }
}
