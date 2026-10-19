import { BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";
import type { Question, Collection } from "../shared/types";
import type { RenderEngine } from "../renderer/render-engine";
import { work } from "./workers";
export class RenderHost {
  window: BrowserWindow;
  constructor() {
    this.window = new BrowserWindow({
      show: false,
      width: 3200,
      height: 3200,
      backgroundColor: "#ffffff",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.window.webContents.on("will-navigate", (e) => e.preventDefault());
  }
  async load() {
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL)
      await this.window.loadURL(
        MAIN_WINDOW_VITE_DEV_SERVER_URL + "/render.html",
      );
    else
      await this.window.loadFile(
        path.join(
          __dirname,
          `../renderer/${MAIN_WINDOW_VITE_NAME}/render.html`,
        ),
      );
    await this.window.webContents.executeJavaScript(
      'new Promise((resolve,reject)=>{const start=Date.now();const id=setInterval(()=>{if(window.renderEngine){clearInterval(id);resolve(true)}else if(Date.now()-start>15000){clearInterval(id);reject(new Error("本地渲染资源未加载"))}},30)})',
    );
    return this;
  }
  call<K extends keyof RenderEngine>(
    method: K,
    ...args: Parameters<RenderEngine[K]>
  ): ReturnType<RenderEngine[K]> {
    return this.window.webContents.executeJavaScript(
      `window.renderEngine.${method}(...${JSON.stringify(args)})`,
    ) as ReturnType<RenderEngine[K]>;
  }
  async image(file: string) {
    const ext = path.extname(file).toLowerCase();
    let data: string;
    if ([".heic", ".heif"].includes(ext))
      data = "data:image/png;base64," + (await work<string>("heic", { file }));
    else
      data = `data:image/${ext === ".jpg" ? "jpeg" : ext.slice(1) || "png"};base64,${fs.readFileSync(file).toString("base64")}`;
    return this.call("image", data);
  }
  async prepare(q: Question[], c: Collection) {
    return this.call("prepare", q, c);
  }
  close() {
    if (!this.window.isDestroyed()) this.window.destroy();
  }
}
