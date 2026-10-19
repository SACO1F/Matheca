import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { WindowsZIP } from "./scripts/windows-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { generateNotices } from "./scripts/notices";
import fs from "node:fs";
import path from "node:path";
const config: ForgeConfig = {
  hooks: {
    generateAssets: async () => {
      generateNotices(process.cwd());
      for (const folder of ["cmaps", "standard_fonts", "wasm"])
        fs.cpSync(
          path.join("node_modules/pdfjs-dist", folder),
          path.join("public/pdfjs", folder),
          { recursive: true },
        );
    },
  },
  packagerConfig: {
    ignore: (file) =>
      file !== "" &&
      !/^\/(?:\.vite(?:\/|$)|node_modules(?:\/|$)|assets(?:\/|$)|docs(?:\/|$)|package\.json$|README\.md$|THIRD_PARTY_NOTICES\.txt$)/.test(
        file,
      ),
    asar: { unpack: "**/*.node" },
    executableName: "Matheca",
    icon: "assets/icon.ico",
    ...(process.env.MATHECA_ELECTRON_ZIP_DIR
      ? { electronZipDir: process.env.MATHECA_ELECTRON_ZIP_DIR }
      : {}),
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: "Matheca",
      authors: "SACO1F",
      description: "Matheca 数学题库",
      setupIcon: "assets/icon.ico",
    }),
    new WindowsZIP({}),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/main/worker.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
        {
          entry: "src/capture-preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
    }),
  ],
};
export default config;
