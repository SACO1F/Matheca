import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DesktopAPI, Reply, BackupPreview } from "./shared/types";
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as Reply<T>;
  if (!r.ok) throw Error(r.error);
  return r.data;
}
const api: DesktopAPI = {
  mobileStart: () => call("mobile:start"),
  mobileStatus: () => call("mobile:status"),
  mobilePause: () => call("mobile:pause"),
  mobileRemove: (id) => call("mobile:remove", id),
  mobileConfirm: () => call("mobile:confirm"),
  historyList: (limit = 100, offset = 0, query = "") =>
    call("history:list", limit, offset, query),
  recordHistory: (title, detail = "") => call("history:record", title, detail),
  onHistoryChanged: (fn) => {
    const listener = () => fn();
    ipcRenderer.on("history:changed", listener);
    return () => ipcRenderer.removeListener("history:changed", listener);
  },
  state: () => call("library:state"),
  saveQuestion: (q, c) => call("question:save", q, !!c),
  undoDeletion: (token) => call("deletion:undo", token),
  undoReview: (q) => call("question:undo-review", q),
  deleteQuestion: (id) => call("question:delete", id),
  cropFigure: (id, rect) => call("question:crop", id, rect),
  examples: () => call("library:examples"),
  saveCollection: (c) => call("collection:save", c),
  deleteCollection: (id) => call("collection:delete", id),
  addQuestions: (id, ids) => call("collection:add", id, ids),
  addQuestionsWithUndo: (id, ids) => call("collection:add-undoable", id, ids),
  undoAddition: (token) => call("collection:undo-addition", token),
  reorder: (id, ids) => call("collection:reorder", id, ids),
  removeQuestion: (c, q) => call("collection:remove", c, q),
  addKnowledge: (p) => call("knowledge:add", p),
  saveSettings: (s) => call("settings:save", s),
  setColorTheme: (theme) => call("settings:color-theme", theme),
  setManualPromptOpen: (open) => call("question:manual-prompt", open),
  testVision: () => call("settings:test"),
  chooseImport: () => call("intake:choose"),
  captureImport: () => call("intake:capture"),
  importDropped: async (files) => {
    if (!files.length || files.length > 20)
      throw Error("一次最多导入 20 个文件");
    const payload: (string | { name: string; bytes: Uint8Array })[] = [];
    let memorySize = 0;
    for (const file of files) {
      if (!/\.(?:jpg|jpeg|png|webp|heic|heif|pdf|zip)$/i.test(file.name))
        throw Error("请选择图片、PDF 或 Windows 题库 ZIP");
      const isZip = /\.zip$/i.test(file.name);
      if (isZip && files.length !== 1) throw Error("题库 ZIP 请单独拖入");
      if (file.size > (isZip ? 512 : 50) * 1024 * 1024)
        throw Error(isZip ? "备份文件超过 512 MB" : "单文件最多 50 MB");
      const filePath = webUtils.getPathForFile(file);
      if (filePath) payload.push(filePath);
      else {
        memorySize += file.size;
        if (memorySize > 100 * 1024 * 1024)
          throw Error(
            "直接拖入的图片内容超过 100 MB，请分批导入或先保存到本机",
          );
        payload.push({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        });
      }
    }
    return call<BackupPreview | void>("intake:drop", payload);
  },
  pasteImage: () => call("intake:paste"),
  resumeJob: (id) => call("job:resume", id),
  cancelJob: (id) => call("job:cancel", id),
  solveQuestion: (id) => call("question:solve", id),
  inspectBackup: () => call("backup:inspect"),
  restoreBackup: (t) => call("backup:restore", t),
  dismissBackup: (t) => call("backup:dismiss", t),
  exportBackup: () => call("backup:export"),
  exportCollection: (id, f) => call("collection:export", id, f),
  previewCollection: (id) => call("collection:preview", id),
  openExport: (p) => call("export:open", p),
  openGuideLink: (key) => call("guide:open", key),
  copyGuideValue: (key) => call("guide:copy", key),
  onChanged: (fn) => {
    const listener = () => fn();
    ipcRenderer.on("state:changed", listener);
    return () => ipcRenderer.removeListener("state:changed", listener);
  },
  onBeforeClose: (fn) => {
    const listener = async () => {
      try {
        await fn();
        ipcRenderer.send("window:close-ready", true);
      } catch (error) {
        ipcRenderer.send(
          "window:close-ready",
          error instanceof Error &&
            (error.name === "ManualSaveCancelled" ||
              error.message === "已取消保存")
            ? "cancelled"
            : false,
        );
      }
    };
    ipcRenderer.on("window:before-close", listener);
    return () => ipcRenderer.removeListener("window:before-close", listener);
  },
};
contextBridge.exposeInMainWorld("matheca", api);
