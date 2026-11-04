import {
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
  type NativeImage,
} from "electron";
import path from "node:path";
export type CaptureRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
};
export class ScreenCapture {
  private overlays = new Map<
    number,
    { window: BrowserWindow; image: NativeImage }
  >();
  private resolve?: (result: Buffer | null) => void;
  private capturing = false;
  private cancelled = false;
  constructor(private main: BrowserWindow) {
    ipcMain.handle("capture:ready", (event) => {
      const overlay = this.overlays.get(event.sender.id);
      if (!overlay || event.senderFrame !== event.sender.mainFrame)
        throw Error("截图窗口已关闭");
      return overlay.image.toDataURL();
    });
    ipcMain.handle("capture:confirm", (event, value: CaptureRect) => {
      const overlay = this.overlays.get(event.sender.id);
      if (!overlay || event.senderFrame !== event.sender.mainFrame)
        throw Error("截图窗口已关闭");
      const keys = [
        "x",
        "y",
        "width",
        "height",
        "viewportWidth",
        "viewportHeight",
      ] as const;
      if (
        !value ||
        keys.some((k) => !Number.isFinite(value[k])) ||
        value.width < 8 ||
        value.height < 8 ||
        value.x < 0 ||
        value.y < 0 ||
        value.viewportWidth <= 0 ||
        value.viewportHeight <= 0 ||
        value.x + value.width > value.viewportWidth + 1 ||
        value.y + value.height > value.viewportHeight + 1
      )
        throw Error("请框选至少 8 × 8 像素的区域");
      const size = overlay.image.getSize();
      const x = Math.min(
        size.width - 1,
        Math.floor((value.x / value.viewportWidth) * size.width),
      );
      const y = Math.min(
        size.height - 1,
        Math.floor((value.y / value.viewportHeight) * size.height),
      );
      const width = Math.min(
        size.width - x,
        Math.max(
          1,
          Math.round((value.width / value.viewportWidth) * size.width),
        ),
      );
      const height = Math.min(
        size.height - y,
        Math.max(
          1,
          Math.round((value.height / value.viewportHeight) * size.height),
        ),
      );
      const png = overlay.image.crop({ x, y, width, height }).toPNG();
      if (png.length > 50 * 1024 * 1024)
        throw Error("截图超过 50 MB，请缩小选区");
      this.finish(png);
    });
    ipcMain.on("capture:cancel", (event) => {
      if (this.overlays.has(event.sender.id)) this.cancel();
    });
  }
  cancel() {
    this.cancelled = true;
    this.finish(null);
  }
  private finish(result: Buffer | null) {
    const resolve = this.resolve;
    this.resolve = undefined;
    const overlays = [...this.overlays.values()];
    this.overlays.clear();
    overlays.forEach(({ window }) => {
      if (!window.isDestroyed()) window.destroy();
    });
    if (!this.main.isDestroyed()) {
      this.main.show();
      this.main.focus();
    }
    resolve?.(result);
  }
  async capture(): Promise<Buffer | null> {
    if (this.capturing) throw Error("截图正在进行中");
    this.capturing = true;
    this.cancelled = false;
    try {
      this.main.hide();
      await new Promise((resolve) => setTimeout(resolve, 180));
      if (this.cancelled) return null;
      const displays = screen.getAllDisplays();
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: {
          width: Math.max(
            ...displays.map((d) => Math.ceil(d.size.width * d.scaleFactor)),
          ),
          height: Math.max(
            ...displays.map((d) => Math.ceil(d.size.height * d.scaleFactor)),
          ),
        },
      });
      if (this.cancelled) return null;
      const available = displays.flatMap((display, index) => {
        const source =
          sources.find((s) => s.display_id === String(display.id)) ??
          (sources.length === displays.length ? sources[index] : undefined);
        return source && !source.thumbnail.isEmpty()
          ? [{ display, image: source.thumbnail }]
          : [];
      });
      if (!available.length) throw Error("无法读取屏幕图像，请重试截图");
      const result = new Promise<Buffer | null>((resolve) => {
        this.resolve = resolve;
      });
      await Promise.all(
        available.map(async ({ display, image }) => {
          const window = new BrowserWindow({
            ...display.bounds,
            show: false,
            frame: false,
            resizable: false,
            movable: false,
            fullscreen: true,
            skipTaskbar: true,
            alwaysOnTop: true,
            title: "Matheca 截图导入",
            backgroundColor: "#18243a",
            webPreferences: {
              preload: path.join(__dirname, "capture-preload.cjs"),
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
            },
          });
          const senderId = window.webContents.id;
          this.overlays.set(senderId, { window, image });
          window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
          window.webContents.on("will-navigate", (event) =>
            event.preventDefault(),
          );
          window.on("closed", () => {
            if (this.overlays.has(senderId)) this.cancel();
          });
          if (MAIN_WINDOW_VITE_DEV_SERVER_URL)
            await window.loadURL(
              MAIN_WINDOW_VITE_DEV_SERVER_URL + "/capture.html",
            );
          else
            await window.loadFile(
              path.join(
                __dirname,
                `../renderer/${MAIN_WINDOW_VITE_NAME}/capture.html`,
              ),
            );
        }),
      );
      for (const { window } of this.overlays.values()) {
        if (this.resolve && !window.isDestroyed()) {
          window.setAlwaysOnTop(true, "screen-saver");
          window.show();
        }
      }
      return await result;
    } catch (error) {
      this.cancel();
      throw error;
    } finally {
      this.capturing = false;
    }
  }
}
