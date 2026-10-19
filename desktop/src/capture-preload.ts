import { contextBridge, ipcRenderer } from "electron";
import type { CaptureRect } from "./main/screen-capture";
contextBridge.exposeInMainWorld("screenCapture", {
  ready: (): Promise<string> => ipcRenderer.invoke("capture:ready"),
  confirm: (rect: CaptureRect): Promise<void> =>
    ipcRenderer.invoke("capture:confirm", rect),
  cancel: () => ipcRenderer.send("capture:cancel"),
});
