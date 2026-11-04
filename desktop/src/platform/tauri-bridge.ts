import channels from "../shared/desktop-channels.json";
import type { DesktopAPI, Reply, BackupPreview } from "../shared/types";

type Events =
  "onCloseChoice" | "onChanged" | "onHistoryChanged" | "onBeforeClose";
type Requests = Exclude<keyof DesktopAPI, Events>;
export const requestChannels = channels satisfies Record<Requests, string>;
export interface NativeTransport {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(
    event: string,
    handler: (event: { payload: T }) => void,
  ): Promise<() => void>;
}
export interface RuntimeInfo {
  runtime: "tauri";
  phase: number;
  readOnly: boolean;
  hasLibrary: boolean;
  implemented: string[];
  deferred: string[];
  version: string;
}
export interface LegacyCopyResult {
  questions: number;
  collections: number;
  images: number;
  missingImages: number;
  keyWarning: boolean;
}
export class DesktopCallError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "DesktopCallError";
  }
}

export function createDesktopAPI(
  transport: NativeTransport,
  report: (message: string) => void,
) {
  const disposers = new Set<() => void>();
  let disposed = false;
  let readySent = false;
  const lifecycleListeners = new Set<string>();
  async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
    if (disposed) throw new DesktopCallError("窗口通信已关闭", "DISPOSED");
    let result: Reply<T> & { code?: string };
    try {
      result = await transport.invoke("desktop_call", { channel, args });
    } catch {
      throw new DesktopCallError(
        "无法连接桌面服务，请重新打开 Matheca",
        "TRANSPORT",
      );
    }
    if (!result || typeof result.ok !== "boolean")
      throw new DesktopCallError("桌面服务返回了无效结果", "PROTOCOL");
    if (!result.ok)
      throw new DesktopCallError(
        result.error,
        result.code || "OPERATION_FAILED",
      );
    return result.data;
  }
  function subscribe<T>(
    event: string,
    handler: (value: T) => void | Promise<void>,
  ) {
    let alive = true;
    let unlisten: (() => void) | undefined;
    const stop = () => {
      if (!alive) return;
      alive = false;
      unlisten?.();
      disposers.delete(stop);
      lifecycleListeners.delete(event);
    };
    disposers.add(stop);
    void transport
      .listen<T>(event, ({ payload }) => {
        if (alive && !disposed)
          void Promise.resolve()
            .then(() => handler(payload))
            .catch((e) =>
              report(e instanceof Error ? e.message : "事件处理失败"),
            );
      })
      .then((off) => {
        if (!alive || disposed) {
          off();
          return;
        }
        unlisten = off;
        lifecycleListeners.add(event);
        if (
          !readySent &&
          lifecycleListeners.has("window:close-choice") &&
          lifecycleListeners.has("window:before-close")
        ) {
          readySent = true;
          void transport.invoke("frontend_ready").catch(() => {
            readySent = false;
            report("关闭确认尚未就绪，请重新打开 Matheca");
          });
        }
      })
      .catch(() => {
        stop();
        report("桌面事件订阅失败，请重新打开 Matheca");
      });
    return stop;
  }
  // The complete key set is checked against DesktopAPI above. Runtime calls
  // preserve each method's argument/return contract through the native envelope.
  const requests = Object.fromEntries(
    Object.entries(requestChannels).map(([name, channel]) => [
      name,
      (...args: unknown[]) => call(channel, ...args),
    ]),
  ) as unknown as Pick<DesktopAPI, Requests>;
  let lastCloseRequest = 0;
  const events = {
    onCloseChoice: (fn) => subscribe<boolean>("window:close-choice", fn),
    onChanged: (fn) => subscribe("state:changed", fn),
    onHistoryChanged: (fn) => subscribe("history:changed", fn),
    onBeforeClose: (fn) =>
      subscribe<{ request: number }>(
        "window:before-close",
        async ({ request }) => {
          if (!Number.isSafeInteger(request) || request <= lastCloseRequest)
            return;
          lastCloseRequest = request;
          let saved = false;
          try {
            await fn();
            saved = true;
          } catch (error) {
            if (!(
              error instanceof Error &&
              (error.name === "ManualSaveCancelled" ||
                error.message === "已取消保存")
            ))
              report(error instanceof Error ? error.message : "草稿保存失败");
          }
          await call("window:close-ready", request, saved);
        },
      ),
  } satisfies Pick<DesktopAPI, Events>;
  const api: DesktopAPI = Object.assign(requests, events, {
    recordHistory: (title: string, detail = "") =>
      call<void>("history:record", title, detail),
    historyList: (limit = 100, offset = 0, query = "") =>
      call<Awaited<ReturnType<DesktopAPI["historyList"]>>>(
        "history:list",
        limit,
        offset,
        query,
      ),
    saveQuestion: (
      q: Parameters<DesktopAPI["saveQuestion"]>[0],
      confirm = false,
    ) =>
      call<Awaited<ReturnType<DesktopAPI["saveQuestion"]>>>(
        "question:save",
        q,
        confirm,
      ),
    setManualPromptOpen: (open: boolean) =>
      call<void>("question:manual-prompt", open),
    importDropped: async (files: File[]) => {
      if (!files.length || files.length > 20)
        throw Error("一次最多导入 20 个文件");
      let total = 0;
      for (const file of files) {
        if (!/\.(?:jpg|jpeg|png|webp|heic|heif|pdf|zip)$/i.test(file.name))
          throw Error("请选择图片、PDF 或 Windows 题库 ZIP");
        const zip = /\.zip$/i.test(file.name);
        if (zip && files.length !== 1) throw Error("题库 ZIP 请单独拖入");
        if (file.size > (zip ? 512 : 50) * 1024 * 1024)
          throw Error(zip ? "备份文件超过 512 MB" : "单文件最多 50 MB");
        total += file.size;
        if (!zip && total > 100 * 1024 * 1024)
          throw Error("直接拖入的图片内容超过 100 MB，请分批导入");
      }
      const token = await call<string>(
        "intake:begin",
        files.map(({ name, size }) => ({ name, size })),
      );
      try {
        for (const [index, file] of files.entries()) {
          for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
            const bytes = new Uint8Array(
              await file.slice(offset, offset + 1024 * 1024).arrayBuffer(),
            );
            let binary = "";
            for (let i = 0; i < bytes.length; i += 16384)
              binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
            await call("intake:chunk", token, index, offset, btoa(binary));
          }
        }
        return await call<BackupPreview | void>(
          "intake:commit",
          token,
          files.map((f) => f.name),
        );
      } catch (error) {
        await call("intake:discard", token).catch(() => {});
        throw error;
      }
    },
  });
  subscribe<string>("bridge:error", report);
  const stopDrop = subscribe<{ paths: string[] }>(
    "tauri://drag-drop",
    async (payload) => {
      if (!Array.isArray(payload.paths) || !payload.paths.length) return;
      try {
        const result = await call<BackupPreview | null>(
          "intake:drop",
          payload.paths,
        );
        if (result)
          window.dispatchEvent(
            new CustomEvent("matheca:backup-preview", { detail: result }),
          );
      } catch (error) {
        report(error instanceof Error ? error.message : "拖入文件失败");
      }
    },
  );
  return {
    api: Object.freeze(api),
    dispose() {
      disposed = true;
      stopDrop();
      for (const stop of [...disposers]) stop();
    },
  };
}
