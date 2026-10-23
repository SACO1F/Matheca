import { safeStorage } from "electron";
import { Store } from "./store";
import type { Settings, SettingsInput } from "../shared/types";
import { endpoint } from "../domain/vision";
import { trim } from "../domain/math";
import { isColorTheme } from "../shared/color-themes";
export class SettingsService {
  constructor(private store: Store) {}
  read(): Settings {
    const s = this.store;
    const colorTheme = s.getSetting("colorTheme");
    return {
      closeAction: ["quit", "background"].includes(s.getSetting("closeAction"))
        ? (s.getSetting("closeAction") as "quit" | "background")
        : "ask",
      theme: "LIGHT",
      colorTheme: isColorTheme(colorTheme) ? colorTheme : "GRAPHITE",
      address: s.getSetting("address"),
      model: s.getSetting("model"),
      hasApiKey: !!s.getSetting("encryptedKey"),
      autoSolveImports: s.getSetting("autoSolveImports") === "true",
    };
  }
  async save(input: SettingsInput) {
    if (!["SYSTEM", "LIGHT", "DARK"].includes(input.theme))
      throw Error("主题设置无效");
    const address = trim(input.address),
      model = trim(input.model),
      key = trim(input.apiKey ?? "");
    const old = this.read();
    if (address) endpoint(address);
    if (address && !model) throw Error("请填写支持图片输入的模型名");
    if (key && !/^[!-~]+$/.test(key)) throw Error("API Key 格式无效");
    if (
      old.hasApiKey &&
      old.address &&
      address &&
      new URL(endpoint(old.address)).hostname !==
        new URL(endpoint(address)).hostname &&
      !key &&
      !input.clearApiKey
    )
      throw Error("更换服务地址时请重新填写 API Key");
    let encrypted: string | undefined;
    if (key) {
      if (!(await safeStorage.isAsyncEncryptionAvailable()))
        throw Error("Windows 凭据保护不可用，请稍后重试");
      encrypted = Buffer.from(
        await safeStorage.encryptStringAsync(key),
      ).toString("base64");
    }
    this.store.db.transaction(() => {
      if (encrypted) this.store.setSetting("encryptedKey", encrypted);
      else if (input.clearApiKey) this.store.setSetting("encryptedKey", "");
      this.store.setSetting("address", address);
      this.store.setSetting("model", model);
      this.store.setSetting("theme", "LIGHT");
      this.store.setSetting("autoSolveImports", String(input.autoSolveImports));
    })();
  }
  async config() {
    const s = this.read(),
      encrypted = this.store.getSetting("encryptedKey");
    if (!s.address || !s.model || !encrypted)
      throw Error("请先在设置中配置多模态接口");
    let key: string;
    try {
      key = (
        await safeStorage.decryptStringAsync(Buffer.from(encrypted, "base64"))
      ).result;
    } catch {
      throw Error("API Key 无法读取，请重新填写后保存");
    }
    return { endpoint: endpoint(s.address), model: s.model, key };
  }
}
