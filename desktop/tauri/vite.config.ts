import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    target: "esnext",
    outDir: "tauri-dist",
    emptyOutDir: true,
    rollupOptions: {
      input: [
        path.resolve(__dirname, "../tauri.html"),
        path.resolve(__dirname, "../tauri-worker.html"),
        path.resolve(__dirname, "../tauri-capture.html"),
      ],
    },
  },
});
