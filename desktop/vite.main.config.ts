import { defineConfig } from "vite";
import { builtinModules } from "node:module";
import pkg from "./package.json";
export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        "electron",
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
        ...Object.keys(pkg.dependencies),
      ],
    },
  },
});
