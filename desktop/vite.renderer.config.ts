import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  plugins: [react()],
  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, "index.html"),
        render: path.resolve(__dirname, "render.html"),
        capture: path.resolve(__dirname, "capture.html"),
      },
    },
  },
});
