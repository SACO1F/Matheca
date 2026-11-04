import type { CaptureRect } from "../electron/main/screen-capture";
const native = (
  window as unknown as {
    __TAURI__: {
      core: { invoke<T>(command: string, args?: object): Promise<T> };
    };
  }
).__TAURI__.core;
window.screenCapture = {
  ready: () => native.invoke<string>("capture_ready"),
  loaded: () => native.invoke<void>("capture_loaded"),
  confirm: (rect: CaptureRect) =>
    native.invoke<void>("capture_confirm", { rect }),
  cancel: () => {
    void native.invoke("capture_cancel").catch(() => {});
  },
};
await import("./renderer/capture");
