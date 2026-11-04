import {
  createDesktopAPI,
  type NativeTransport,
  type RuntimeInfo,
  type LegacyCopyResult,
} from "./platform/tauri-bridge";

async function start() {
  const native = (
    window as unknown as {
      __TAURI__: {
        core: Pick<NativeTransport, "invoke">;
        event: Pick<NativeTransport, "listen">;
        window: { getCurrentWindow(): NonNullable<Window["mathecaWindow"]> };
      };
    }
  ).__TAURI__;
  if (!native) throw Error("请通过 Matheca 桌面程序打开此页面");
  const runtime = await native.core.invoke<RuntimeInfo>("bootstrap");
  const bridge = createDesktopAPI(
    { invoke: native.core.invoke, listen: native.event.listen },
    (message) => {
      window.dispatchEvent(
        new CustomEvent("matheca:bridge-error", { detail: message }),
      );
    },
  );
  window.matheca = bridge.api;
  window.mathecaWindow = native.window.getCurrentWindow();
  window.mathecaRuntime = runtime;
  window.mathecaMigration = {
    chooseLegacyCopy: () =>
      native.core.invoke<LegacyCopyResult | null>("choose_legacy_copy"),
  };
  window.addEventListener("beforeunload", () => bridge.dispose(), {
    once: true,
  });
  await import("./renderer/main");
}
void start().catch((error) => {
  const root = document.getElementById("root")!;
  root.replaceChildren();
  const heading = document.createElement("h1");
  heading.textContent = "Matheca 启动失败";
  const detail = document.createElement("p");
  detail.textContent =
    error instanceof Error ? error.message : "请重新打开应用";
  const retry = document.createElement("button");
  retry.textContent = "重新加载";
  retry.onclick = () => location.reload();
  root.append(heading, detail, retry);
});
