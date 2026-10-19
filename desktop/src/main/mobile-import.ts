import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import {
  randomBytes,
  randomUUID,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import QRCode from "qrcode";
import phonePage from "./phone-page.html?raw";
import type { MobileImportState } from "../shared/types";

const MAX_FILE = 50 * 1024 * 1024;
const MAX_TOTAL = 200 * 1024 * 1024;
const EXTENSIONS = [".png", ".jpg", ".webp", ".heic"];
const UUID = /^[a-f0-9-]{36}$/i;
type StoredPhoto = {
  id: string;
  name: string;
  size: number;
  ext: string;
  uploadId: string;
};
class ClientError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function photoExtension(header: Buffer): string {
  if (
    header
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    header.toString("ascii", 12, 16) === "IHDR"
  )
    return ".png";
  if (header[0] === 255 && header[1] === 216 && header[2] === 255)
    return ".jpg";
  if (
    header.toString("ascii", 0, 4) === "RIFF" &&
    header.toString("ascii", 8, 12) === "WEBP"
  )
    return ".webp";
  if (
    header.toString("ascii", 4, 8) === "ftyp" &&
    /heic|heix|hevc|hevx|mif1|msf1/.test(header.toString("ascii", 8, 48))
  )
    return ".heic";
  throw new ClientError("请选择 JPEG、PNG、WebP 或 HEIC 照片");
}

/** A user-started, bearer-paired LAN inbox. It never exposes app IPC or disk paths. */
export class MobileImport {
  private files: StoredPhoto[] = [];
  private server?: http.Server;
  private timer?: ReturnType<typeof setTimeout>;
  private uploads = new Set<Promise<void>>();
  private inFlightIds = new Set<string>();
  private token = "";
  private sessionId = randomUUID();
  private urls: string[] = [];
  private qrCodes: string[] = [];
  private expiresAt = 0;
  private connected = false;
  private importing = false;
  private imported = 0;
  private status: "receiving" | "closed" | "expired" = "closed";
  private allowedHosts = new Set<string>();
  private loadError = false;
  private starting?: Promise<MobileImportState>;

  constructor(
    private folder: string,
    private intake: (files: string[]) => Promise<void>,
    private isImported: (name: string) => boolean = () => false,
    private lifetime = 15 * 60 * 1000,
    private bindAddress = "0.0.0.0",
  ) {
    fs.mkdirSync(folder, { recursive: true });
    for (const name of fs.readdirSync(folder)) {
      if (/^[a-f0-9-]{36}\.part$/i.test(name))
        fs.rmSync(path.join(folder, name), { force: true });
    }
    const manifest = path.join(folder, "manifest.json");
    if (fs.existsSync(manifest)) {
      try {
        const saved: unknown = JSON.parse(fs.readFileSync(manifest, "utf8"));
        if (!Array.isArray(saved) || saved.length > 20) throw Error();
        for (const value of saved) {
          if (
            !value ||
            !UUID.test(value.id) ||
            !EXTENSIONS.includes(value.ext) ||
            typeof value.name !== "string" ||
            value.name.length > 150 ||
            !Number.isSafeInteger(value.size) ||
            value.size < 1 ||
            value.size > MAX_FILE ||
            !/^[a-f0-9]{16,64}$/i.test(value.uploadId)
          )
            throw Error();
          const file = this.filePath(value);
          if (
            fs.existsSync(file) &&
            !this.isImported(path.basename(file)) &&
            fs.statSync(file).size === value.size
          )
            this.files.push(value);
        }
      } catch {
        this.files = [];
        this.loadError = true;
      }
    }
  }
  private filePath(photo: StoredPhoto) {
    return path.join(this.folder, photo.id + photo.ext);
  }
  private persist() {
    const temp = path.join(this.folder, "manifest.tmp");
    fs.writeFileSync(temp, JSON.stringify(this.files), { mode: 0o600 });
    fs.renameSync(temp, path.join(this.folder, "manifest.json"));
  }
  state(): MobileImportState {
    return {
      sessionId: this.sessionId,
      status: this.importing ? "importing" : this.status,
      urls: this.urls,
      qrCodes: this.qrCodes,
      expiresAt: this.expiresAt,
      connected: this.connected,
      imported: this.imported,
      files: this.files.map((photo) => ({
        id: photo.id,
        name: photo.name,
        size: photo.size,
        preview: `matheca-asset://mobile/${this.sessionId}/${photo.id}`,
      })),
    };
  }
  image(session: string, id: string) {
    const photo =
      session === this.sessionId && this.files.find((file) => file.id === id);
    return photo ? this.filePath(photo) : undefined;
  }
  start(): Promise<MobileImportState> {
    if (this.starting) return this.starting;
    if (this.loadError)
      return Promise.reject(
        Error(
          "手机接收记录无法读取，原始照片仍保留在本机，请先备份后联系维护者处理",
        ),
      );
    if (this.status === "receiving") return Promise.resolve(this.state());
    this.starting = this.open().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }
  private async open() {
    await this.closeServer();
    this.token = randomBytes(32).toString("hex");
    this.sessionId = randomUUID();
    this.connected = false;
    const server = http.createServer((req, res) => {
      const task = this.route(req, res).catch((error) => {
        if (!res.destroyed && !res.headersSent)
          this.json(res, error instanceof ClientError ? error.status : 500, {
            error:
              error instanceof ClientError
                ? error.message
                : "接收失败，请重试；照片尚未提交识别",
          });
        else if (!res.destroyed) res.destroy();
      });
      this.uploads.add(task);
      void task.finally(() => this.uploads.delete(task));
    });
    server.requestTimeout = 90000;
    server.headersTimeout = 15000;
    server.maxConnections = 12;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, this.bindAddress, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    this.server = server;
    const port = (server.address() as { port: number }).port;
    const addresses = [
      ...new Set(
        Object.values(os.networkInterfaces()).flatMap((items) =>
          (items || [])
            .filter(
              (item) =>
                item.family === "IPv4" &&
                !item.internal &&
                !item.address.startsWith("169.254."),
            )
            .map((item) => item.address),
        ),
      ),
    ];
    this.allowedHosts = new Set(
      [...addresses, "127.0.0.1", "localhost"].map(
        (address) => `${address}:${port}`,
      ),
    );
    this.urls = (addresses.length ? addresses : ["127.0.0.1"]).map(
      (address) => `http://${address}:${port}/#pair=${this.token}`,
    );
    try {
      this.qrCodes = await Promise.all(
        this.urls.map((url) =>
          QRCode.toDataURL(url, {
            margin: 2,
            width: 260,
            errorCorrectionLevel: "M",
          }),
        ),
      );
    } catch (error) {
      await this.closeServer();
      throw error;
    }
    this.expiresAt = Date.now() + this.lifetime;
    this.status = "receiving";
    this.timer = setTimeout(() => {
      void this.pause(true);
    }, this.lifetime);
    this.timer.unref();
    return this.state();
  }
  async pause(expired = false) {
    if (this.starting) await this.starting.catch(() => {});
    await this.closeServer(expired);
  }
  private async closeServer(expired = false) {
    clearTimeout(this.timer);
    this.status = expired ? "expired" : "closed";
    this.token = "";
    const server = this.server;
    this.server = undefined;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await Promise.allSettled([...this.uploads]);
    }
  }
  remove(id: string) {
    if (this.importing || this.inFlightIds.size)
      throw Error("正在接收或提交照片，请稍后再移除");
    const photo = this.files.find((file) => file.id === id);
    if (!photo) throw Error("照片不存在");
    const old = this.files;
    this.files = this.files.filter((file) => file.id !== id);
    try {
      this.persist();
    } catch (error) {
      this.files = old;
      throw error;
    }
    fs.rmSync(this.filePath(photo), { force: true });
    return this.state();
  }
  async confirm() {
    if (this.importing || this.inFlightIds.size)
      throw Error("照片正在传输，请等待接收完成");
    if (!this.files.length) throw Error("请先用手机发送照片");
    this.importing = true;
    const snapshot = [...this.files];
    try {
      await this.intake(snapshot.map((file) => this.filePath(file)));
      this.files = [];
      this.imported += snapshot.length;
      // Jobs copies and commits before returning; startup also checks its labels
      // to avoid re-importing a completed batch after an interrupted cleanup.
      this.persist();
      for (const photo of snapshot)
        fs.rmSync(this.filePath(photo), { force: true });
      return snapshot.length;
    } finally {
      this.importing = false;
    }
  }
  private json(res: http.ServerResponse, status: number, value: unknown) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(value));
  }
  private async route(req: http.IncomingMessage, res: http.ServerResponse) {
    const host = req.headers.host || "";
    if (!this.allowedHosts.has(host))
      throw new ClientError("连接地址无效", 403);
    if (req.headers.origin && req.headers.origin !== `http://${host}`)
      throw new ClientError("请从扫码页面发送照片", 403);
    const url = new URL(req.url || "/", `http://${host}`);
    if (req.method === "GET" && url.pathname === "/") {
      // HTML parsers normalize CRLF before CSP hashes are checked.
      const script = (
        phonePage.match(/<script>([\s\S]*?)<\/script>/)?.[1] || ""
      ).replace(/\r\n?/g, "\n");
      const hash = createHash("sha256").update(script).digest("base64");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
      });
      res.end(phonePage);
      return;
    }
    const supplied = req.headers.authorization?.replace(/^Bearer /, "") || "";
    if (
      this.status !== "receiving" ||
      Date.now() >= this.expiresAt ||
      !/^[a-f0-9]{64}$/.test(supplied) ||
      !this.token ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(this.token))
    )
      throw new ClientError(
        "连接已失效，请在电脑重新打开手机拍照导入并扫码",
        401,
      );
    this.connected = true;
    if (req.method === "GET" && url.pathname === "/api/state") {
      this.json(res, 200, {
        expiresAt: this.expiresAt,
        importing: this.importing,
        imported: this.imported,
        files: this.files.map(({ id, name, size }) => ({ id, name, size })),
      });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/photo/")) {
      const photo = this.files.find(
        (file) => file.id === url.pathname.slice(11),
      );
      if (!photo) throw new ClientError("照片不存在", 404);
      res.writeHead(200, {
        "Content-Type":
          {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".webp": "image/webp",
            ".heic": "image/heic",
          }[photo.ext] || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      await pipeline(fs.createReadStream(this.filePath(photo)), res);
      return;
    }
    if (req.method !== "POST" || url.pathname !== "/api/upload")
      throw new ClientError("请求不存在", 404);
    if (this.importing)
      throw new ClientError("电脑正在提交识别，请稍后发送", 409);
    const uploadId = req.headers["x-upload-id"];
    if (typeof uploadId !== "string" || !/^[a-f0-9]{16,64}$/i.test(uploadId))
      throw new ClientError("上传编号无效");
    const previous = this.files.find((photo) => photo.uploadId === uploadId);
    if (previous) {
      req.resume();
      this.json(res, 200, { id: previous.id });
      return;
    }
    if (this.inFlightIds.has(uploadId) || this.inFlightIds.size >= 2)
      throw new ClientError("有照片正在发送，请稍后重试", 409);
    if (this.files.length + this.inFlightIds.size >= 20)
      throw new ClientError("每批最多 20 张，请先在电脑开始识别", 413);
    const size = Number(req.headers["content-length"]);
    const used = this.files.reduce((sum, photo) => sum + photo.size, 0);
    if (
      req.headers["content-type"] !== "application/octet-stream" ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > MAX_FILE ||
      used + size > MAX_TOTAL
    )
      throw new ClientError("单张最多 50 MB，每批合计最多 200 MB", 413);
    let name: string;
    try {
      name = decodeURIComponent(
        String(req.headers["x-file-name"] || "手机照片"),
      );
    } catch {
      throw new ClientError("照片名称无效");
    }
    name =
      name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").slice(0, 150) ||
      "手机照片";
    const photoId = randomUUID();
    const uploadSession = this.sessionId;
    const temp = path.join(this.folder, `${photoId}.part`);
    this.inFlightIds.add(uploadId);
    let received = 0,
      header = Buffer.alloc(0),
      target: string | undefined;
    try {
      const limiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length;
          if (received > size || received > MAX_FILE) {
            callback(new ClientError("照片超过大小限制", 413));
            return;
          }
          if (header.length < 64)
            header = Buffer.concat([
              header,
              chunk.subarray(0, 64 - header.length),
            ]);
          callback(null, chunk);
        },
      });
      await pipeline(
        req,
        limiter,
        fs.createWriteStream(temp, { flags: "wx", mode: 0o600 }),
      );
      if (
        received !== size ||
        this.status !== "receiving" ||
        uploadSession !== this.sessionId
      )
        throw new ClientError("上传未完成，请重新发送");
      if (
        this.files.reduce((sum, photo) => sum + photo.size, 0) + received >
        MAX_TOTAL
      )
        throw new ClientError("这批照片合计超过 200 MB", 413);
      const photo: StoredPhoto = {
        id: photoId,
        name,
        size: received,
        ext: photoExtension(header),
        uploadId,
      };
      target = this.filePath(photo);
      fs.renameSync(temp, target);
      this.files.push(photo);
      try {
        this.persist();
      } catch (error) {
        this.files = this.files.filter((file) => file.id !== photoId);
        throw error;
      }
      this.json(res, 201, { id: photoId });
      target = undefined;
    } finally {
      this.inFlightIds.delete(uploadId);
      fs.rmSync(temp, { force: true });
      if (target) fs.rmSync(target, { force: true });
    }
  }
}
