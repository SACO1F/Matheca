import type { DesktopAPI } from "./shared/types";
declare global {
  interface Window {
    matheca: DesktopAPI;
    renderEngine: import("./renderer/render-engine").RenderEngine;
  }
  const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
  const MAIN_WINDOW_VITE_NAME: string;
}
declare module "heic-convert" {
  const convert: (input: {
    buffer: Buffer;
    format: "PNG" | "JPEG";
    quality?: number;
  }) => Promise<Buffer>;
  export default convert;
}
export {};
