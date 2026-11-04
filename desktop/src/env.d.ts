import type { DesktopAPI } from "./shared/types";
declare global {
  interface Window {
    matheca: DesktopAPI;
    mathecaRuntime?: import("./platform/tauri-bridge").RuntimeInfo;
    mathecaWindow?: {
      minimize(): Promise<void>;
      toggleMaximize(): Promise<void>;
      isMaximized(): Promise<boolean>;
      close(): Promise<void>;
      onResized(callback: () => void): Promise<() => void>;
    };
    mathecaMigration?: {
      chooseLegacyCopy(): Promise<
        import("./platform/tauri-bridge").LegacyCopyResult | null
      >;
    };
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
