import fs from "node:fs";
import path from "node:path";
import {
  randomBytes,
  createHash,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
type Device = { id: string; name: string; hash: string; pairedAt: number };
export class PairedDevices {
  private file: string;
  private data: { serverId: string; port: number; devices: Device[] };
  private loadError?: string;
  constructor(folder: string) {
    this.file = path.join(folder, "paired-devices.json");
    this.data = { serverId: randomUUID(), port: 0, devices: [] };
    try {
      if (fs.existsSync(this.file) && fs.statSync(this.file).size > 65536)
        throw Error("记录过大");
      this.data = fs.existsSync(this.file)
        ? JSON.parse(fs.readFileSync(this.file, "utf8"))
        : { serverId: randomUUID(), port: 0, devices: [] };
      if (
        !/^[a-f0-9-]{36}$/.test(this.data.serverId) ||
        !Number.isInteger(this.data.port) ||
        this.data.port < 0 ||
        this.data.port > 65535 ||
        !Array.isArray(this.data.devices) ||
        this.data.devices.length > 10 ||
        this.data.devices.some(
          (d) =>
            !/^[a-f0-9]{32}$/.test(d.id) ||
            !/^[a-f0-9]{64}$/.test(d.hash) ||
            typeof d.name !== "string" ||
            !Number.isFinite(d.pairedAt),
        )
      )
        throw Error("已配对设备记录损坏，请保留文件后联系维护者");
      this.save();
    } catch {
      this.data = { serverId: randomUUID(), port: 0, devices: [] };
      this.loadError =
        "已配对设备记录无法读取，题库不受影响；请保留 paired-devices.json 后联系维护者";
    }
  }
  check() {
    if (this.loadError) throw Error(this.loadError);
  }
  private save() {
    this.check();
    fs.writeFileSync(this.file + ".tmp", JSON.stringify(this.data), {
      mode: 0o600,
    });
    fs.renameSync(this.file + ".tmp", this.file);
  }
  get serverId() {
    return this.data.serverId;
  }
  get port() {
    return this.data.port;
  }
  setPort(port: number) {
    const before = this.data.port;
    this.data.port = port;
    try {
      this.save();
    } catch (e) {
      this.data.port = before;
      throw e;
    }
  }
  list() {
    return this.data.devices.map(({ hash: _hash, ...d }) => ({ ...d }));
  }
  matches(id: string, token: string) {
    const d = this.data.devices.find((d) => d.id === id);
    return (
      !!d &&
      /^[a-f0-9]{64}$/.test(token) &&
      timingSafeEqual(
        Buffer.from(d.hash),
        Buffer.from(createHash("sha256").update(token).digest("hex")),
      )
    );
  }
  remember(id: string, name: string) {
    if (
      !this.data.devices.some((d) => d.id === id) &&
      this.data.devices.length >= 10
    )
      throw Error("最多记住 10 台手机，请先移除旧设备");
    const token = randomBytes(32).toString("hex"),
      before = this.data.devices;
    this.data.devices = [
      ...before.filter((d) => d.id !== id),
      {
        id,
        name:
          name.replace(/[\u0000-\u001f]/g, "").slice(0, 60) || "Android 手机",
        hash: createHash("sha256").update(token).digest("hex"),
        pairedAt: Date.now(),
      },
    ];
    try {
      this.save();
    } catch (e) {
      this.data.devices = before;
      throw e;
    }
    return token;
  }
  forget(id: string) {
    const before = this.data.devices;
    this.data.devices = before.filter((d) => d.id !== id);
    try {
      this.save();
    } catch (e) {
      this.data.devices = before;
      throw e;
    }
  }
}
