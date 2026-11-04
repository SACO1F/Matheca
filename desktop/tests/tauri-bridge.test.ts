import { describe, it, expect, vi } from "vitest";
import {
  createDesktopAPI,
  requestChannels,
  type NativeTransport,
} from "../src/platform/tauri-bridge";

function fixture(delayed = false) {
  const handlers = new Map<string, (event: { payload: any }) => void>();
  const stops: string[] = [];
  const pending: (() => void)[] = [];
  const invoke = vi.fn(
    async (command: string, _args?: Record<string, unknown>) =>
      command === "frontend_ready" ? undefined : { ok: true, data: null },
  );
  const transport: NativeTransport = {
    invoke: invoke as NativeTransport["invoke"],
    listen: (event, handler) =>
      new Promise((resolve) => {
        const register = () => {
          handlers.set(event, handler);
          resolve(() => {
            handlers.delete(event);
            stops.push(event);
          });
        };
        if (delayed) pending.push(register);
        else register();
      }),
  };
  const report = vi.fn();
  return {
    invoke,
    report,
    handlers,
    stops,
    pending,
    ...createDesktopAPI(transport, report),
  };
}
const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
describe("Tauri DesktopAPI", () => {
  it("covers 57 methods and preserves request defaults", async () => {
    const f = fixture();
    expect(Object.keys(f.api)).toHaveLength(57);
    expect(Object.keys(requestChannels)).toHaveLength(53);
    await f.api.historyList();
    expect(f.invoke).toHaveBeenCalledWith("desktop_call", {
      channel: "history:list",
      args: [100, 0, ""],
    });
    await f.api.saveQuestion({ id: "test" } as any);
    expect(f.invoke).toHaveBeenLastCalledWith("desktop_call", {
      channel: "question:save",
      args: [{ id: "test" }, false],
    });
    f.dispose();
  });
  it("propagates deferred-operation errors and hides internal transport failures", async () => {
    const f = fixture();
    f.invoke.mockResolvedValue({
      ok: false,
      error: "导出尚未开放",
      code: "NOT_IMPLEMENTED",
    } as any);
    await expect(f.api.exportCollection("paper", "pdf")).rejects.toMatchObject({
      message: "导出尚未开放",
      code: "NOT_IMPLEMENTED",
    });
    f.invoke.mockRejectedValue(Error("internal details"));
    await expect(f.api.state()).rejects.toMatchObject({ code: "TRANSPORT" });
    f.dispose();
  });
  it("unsubscribes when registration finishes after React cleanup", async () => {
    const f = fixture(true);
    const changed = vi.fn();
    f.api.onChanged(changed)();
    f.pending.forEach((fn) => fn());
    await tick();
    expect(f.stops).toContain("state:changed");
    expect(f.handlers.has("state:changed")).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    f.dispose();
  });
  it("marks ready after both close listeners are installed", async () => {
    const f = fixture();
    f.api.onCloseChoice(() => {});
    await tick();
    expect(f.invoke).not.toHaveBeenCalledWith("frontend_ready");
    f.api.onBeforeClose(async () => {});
    await tick();
    expect(f.invoke).toHaveBeenCalledWith("frontend_ready");
    f.dispose();
  });
  it("acknowledges each close once and keeps the window on save cancellation", async () => {
    const f = fixture();
    const save = vi.fn(async () => {});
    f.api.onBeforeClose(save);
    await tick();
    f.handlers.get("window:before-close")!({ payload: { request: 1 } });
    f.handlers.get("window:before-close")!({ payload: { request: 1 } });
    await tick();
    expect(save).toHaveBeenCalledTimes(1);
    expect(f.invoke).toHaveBeenCalledWith("desktop_call", {
      channel: "window:close-ready",
      args: [1, true],
    });
    save.mockRejectedValue(
      Object.assign(Error("已取消保存"), { name: "ManualSaveCancelled" }),
    );
    f.handlers.get("window:before-close")!({ payload: { request: 2 } });
    await tick();
    expect(f.invoke).toHaveBeenCalledWith("desktop_call", {
      channel: "window:close-ready",
      args: [2, false],
    });
    expect(f.report).not.toHaveBeenCalled();
    f.dispose();
  });
  it("streams browser drops in bounded chunks and commits only after all chunks", async () => {
    const f = fixture();
    f.invoke.mockImplementation(
      async (_cmd, args: any) =>
        ({
          ok: true,
          data: args?.channel === "intake:begin" ? "upload-token" : null,
        }) as any,
    );
    const bytes = new Uint8Array(1024 * 1024 + 5);
    bytes[bytes.length - 1] = 123;
    const file = new File([bytes], "test.png", { type: "image/png" });
    await f.api.importDropped([file]);
    const calls = f.invoke.mock.calls.map((c) => c[1] as any).filter(Boolean);
    expect(calls.map((c) => c.channel)).toEqual([
      "intake:begin",
      "intake:chunk",
      "intake:chunk",
      "intake:commit",
    ]);
    expect(calls[1].args[2]).toBe(0);
    expect(calls[2].args[2]).toBe(1024 * 1024);
    expect(atob(calls[2].args[3]).charCodeAt(4)).toBe(123);
    f.dispose();
    await expect(f.api.state()).rejects.toMatchObject({ code: "DISPOSED" });
  });
  it("discards staged contents when a chunk fails and defers ZIP restore", async () => {
    const f = fixture();
    f.invoke.mockImplementation(async (_cmd, args: any) =>
      args?.channel === "intake:chunk"
        ? { ok: false, error: "空间不足", code: "OPERATION_FAILED" }
        : ({ ok: true, data: "token" } as any),
    );
    await expect(
      f.api.importDropped([new File(["small"], "test.png")]),
    ).rejects.toThrow("空间不足");
    expect(f.invoke).toHaveBeenLastCalledWith("desktop_call", {
      channel: "intake:discard",
      args: ["token"],
    });
    await expect(
      f.api.importDropped([new File(["zip"], "test.zip")]),
    ).rejects.toThrow("空间不足");
    f.dispose();
  });
});
