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
import { LibraryExchange } from "./library-exchange";
import { PairedDevices } from "./paired-devices";
import {
  validateInventory,
  type ExchangeInventory,
} from "./exchange-inventory";
import phonePage from "./phone-page.html?raw";
import type {
  MobileImportState,
  MobileTransfer,
  ImportJob,
} from "../shared/types";

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
  private devices: PairedDevices;
  private remoteInventory?: { data: ExchangeInventory; at: number };
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
  private pairing?: { id: string; code: string; approved: boolean };
  private rejected = new Set<string>();
  private receipts = new Map<string, string>();
  private batches: { id: string; photos: number }[] = [];
  private transfers: (MobileTransfer & { file: string })[] = [];
  private sharing = false;
  private sessionUploads = 0;

  constructor(
    private folder: string,
    private intake: (files: string[]) => Promise<string | void>,
    private isImported: (name: string) => boolean = () => false,
    private lifetime = 15 * 60 * 1000,
    private bindAddress = "0.0.0.0",
    private getJobs: () => ImportJob[] = () => [],
    private exchange?: LibraryExchange,
  ) {
    fs.mkdirSync(folder, { recursive: true });
    this.devices = new PairedDevices(folder);
    for (const name of fs.readdirSync(folder)) {
      if (/^[a-f0-9-]{36}\.part$/i.test(name))
        fs.rmSync(path.join(folder, name), { force: true });
    }
    const manifest = path.join(folder, "manifest.json");
    if (fs.existsSync(manifest)) {
      try {
        const raw = JSON.parse(fs.readFileSync(manifest, "utf8"));
        const saved: unknown = Array.isArray(raw) ? raw : raw.files;
        if (!Array.isArray(raw) && Array.isArray(raw.receipts)) {
          if (
            raw.receipts.length > 5000 ||
            raw.receipts.some(
              (v: unknown) =>
                !Array.isArray(v) ||
                v.length !== 2 ||
                typeof v[0] !== "string" ||
                !/^[a-f0-9]{16,64}$/i.test(v[0]) ||
                typeof v[1] !== "string" ||
                !UUID.test(v[1]),
            )
          )
            throw Error("上传回执无效");
          this.receipts = new Map(raw.receipts);
        }
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
    fs.writeFileSync(
      temp,
      JSON.stringify({
        files: this.files,
        receipts: [...this.receipts].slice(-5000),
      }),
      { mode: 0o600 },
    );
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
      pairing: this.pairing ? { ...this.pairing } : undefined,
      transfers: this.transfers.map(({ file: _file, ...transfer }) => ({
        ...transfer,
      })),
      tasks: this.taskStates(),
      libraries: this.exchange?.list() || [],
      pairedDevices: this.devices.list(),
      inventoryReady:
        !!this.remoteInventory && Date.now() - this.remoteInventory.at < 30000,
      files: this.files.map((photo) => ({
        id: photo.id,
        name: photo.name,
        size: photo.size,
        preview: `matheca-asset://mobile/${this.sessionId}/${photo.id}`,
      })),
    };
  }
  private taskStates() {
    const jobs = this.getJobs();
    return this.batches.map((batch) => {
      const job = jobs.find((item) => item.id === batch.id);
      return {
        id: batch.id,
        photos: batch.photos,
        status: job?.status || "unavailable",
        completed: job?.completed || 0,
        total: job?.total || batch.photos,
      };
    });
  }
  approve(id: string) {
    if (
      this.status !== "receiving" ||
      Date.now() >= this.expiresAt ||
      this.pairing?.id !== id
    )
      throw Error("连接请求已失效，请重新扫码");
    this.pairing.approved = true;
    return this.state();
  }
  reject(id: string) {
    if (this.pairing?.id !== id) throw Error("连接请求已失效");
    this.rejected.add(id);
    this.pairing = undefined;
    this.connected = false;
    return this.state();
  }
  async share(source: string, library = false) {
    if (this.sharing) throw Error("正在准备文件，请稍后再试");
    if (this.status !== "receiving" || Date.now() >= this.expiresAt)
      throw Error("请先开启手机联动");
    if (this.transfers.length >= 10)
      throw Error("本次连接最多发送 10 份文件，请结束后重新开启");
    const ext = path.extname(source).toLowerCase();
    if (!(library ? [".zip"] : [".pdf", ".docx"]).includes(ext))
      throw Error("仅支持 PDF 或 Word 文档");
    const session = this.sessionId,
      id = randomUUID();
    const dir = path.join(this.folder, "outgoing");
    const file = path.join(dir, id + ext);
    this.sharing = true;
    try {
      const stat = await fs.promises.stat(source);
      if (
        !stat.isFile() ||
        stat.size < 1 ||
        stat.size > (library ? 512 : 100) * 1024 * 1024
      )
        throw Error("文件为空或超过 100 MB，请重新导出或缩小题集");
      fs.mkdirSync(dir, { recursive: true });
      await fs.promises.copyFile(source, file, fs.constants.COPYFILE_EXCL);
      const size = fs.statSync(file).size;
      if (
        session !== this.sessionId ||
        this.status !== "receiving" ||
        Date.now() >= this.expiresAt
      )
        throw Error("连接已结束，请重新开启后发送");
      if (!size || size > (library ? 512 : 100) * 1024 * 1024)
        throw Error("文件大小已变化，请重新导出");
      this.transfers.push({
        id,
        name: path.basename(source),
        size,
        status: "ready",
        file,
      });
      return this.state();
    } catch (error) {
      fs.rmSync(file, { force: true });
      throw error;
    } finally {
      this.sharing = false;
    }
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
  forgetDevice(id: string) {
    this.devices.forget(id);
    if (this.pairing?.id === id) {
      this.rejected.add(id);
      this.pairing = undefined;
      this.connected = false;
      this.remoteInventory = undefined;
    }
    return this.state();
  }
  async delta(selection: import("../shared/types").ExchangeSelection) {
    if (
      !this.exchange ||
      !this.pairing?.approved ||
      !this.remoteInventory ||
      Date.now() - this.remoteInventory.at >= 30000
    )
      throw Error("请先在手机点击“检查连接”更新资料摘要，再发送变更");
    return this.exchange.delta(selection, this.remoteInventory.data);
  }
  private async open() {
    this.devices.check();
    await this.closeServer();
    this.token = randomBytes(32).toString("hex");
    this.sessionId = randomUUID();
    this.connected = false;
    this.pairing = undefined;
    this.remoteInventory = undefined;
    this.rejected.clear();
    this.sessionUploads = 0;
    this.batches = [];
    this.imported = 0;
    this.transfers = [];
    const outgoing = path.join(this.folder, "outgoing");
    fs.mkdirSync(outgoing, { recursive: true });
    for (const name of fs.readdirSync(outgoing))
      if (/^[a-f0-9-]{36}\.(pdf|docx|zip)$/.test(name))
        fs.rmSync(path.join(outgoing, name), { force: true });
    const server = http.createServer((req, res) => {
      const task = this.route(req, res).catch((error) => {
        if (!res.destroyed && !res.headersSent)
          this.json(res, error instanceof ClientError ? error.status : 500, {
            error:
              error instanceof ClientError
                ? error.message
                : "处理失败，请重试；识别任务以电脑显示为准",
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
      const onError = (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE" && this.devices.port)
          server.listen(0, this.bindAddress);
        else reject(error);
      };
      server.on("error", onError);
      server.listen(this.devices.port, this.bindAddress, () => {
        server.removeListener("error", onError);
        resolve();
      });
    });
    this.server = server;
    const port = (server.address() as { port: number }).port;
    try {
      this.devices.setPort(port);
    } catch (error) {
      server.close();
      throw error;
    }
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
    this.pairing = undefined;
    this.connected = false;
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
      const jobId = await this.intake(
        snapshot.map((file) => this.filePath(file)),
      );
      if (jobId) this.batches.push({ id: jobId, photos: snapshot.length });
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
    const device = req.headers["x-device-id"];
    const remembered =
      typeof device === "string" && this.devices.matches(device, supplied);
    if (
      this.status !== "receiving" ||
      Date.now() >= this.expiresAt ||
      !/^[a-f0-9]{64}$/.test(supplied) ||
      !this.token ||
      (!remembered &&
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(this.token)))
    )
      throw new ClientError(
        "连接已失效，请在电脑重新打开手机拍照导入并扫码",
        401,
      );
    if (typeof device !== "string" || !/^[a-f0-9]{32}$/.test(device))
      throw new ClientError("请重新扫码连接", 403);
    if (this.rejected.has(device))
      throw new ClientError("电脑已拒绝连接，请重新开启联动后扫码", 403);
    if (!this.pairing)
      this.pairing = {
        id: device,
        code: device.slice(-6).toUpperCase(),
        approved: remembered,
      };
    if (this.pairing.id !== device)
      throw new ClientError("已有手机正在连接，请先在电脑结束连接", 409);
    this.connected = true;
    if (!this.pairing.approved) {
      if (req.method !== "GET" || url.pathname !== "/api/state")
        throw new ClientError("请先在电脑确认连接", 403);
      this.json(res, 200, {
        approved: false,
        code: this.pairing.code,
        expiresAt: this.expiresAt,
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      this.json(res, 200, {
        approved: true,
        serverId: this.devices.serverId,
        remembered: this.devices.list().some((d) => d.id === device),
        inventoryVersion: 1,
        code: this.pairing.code,
        tasks: this.taskStates(),
        libraries: this.exchange?.list() || [],
        transfers: this.state().transfers,
        receipts: [...this.receipts].map(([uploadId, id]) => ({
          uploadId,
          id,
        })),
        expiresAt: this.expiresAt,
        importing: this.importing,
        imported: this.imported,
        files: this.files.map(({ id, name, size, uploadId }) => ({
          id,
          name,
          size,
          uploadId,
        })),
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/trust") {
      const credential = this.devices.remember(
        device,
        decodeURIComponent(
          String(req.headers["x-device-name"] || "Android 手机"),
        ),
      );
      this.json(res, 200, { serverId: this.devices.serverId, credential });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/inventory") {
      if (!this.exchange)
        throw new ClientError("请更新电脑后使用增量交换", 404);
      this.json(res, 200, await this.exchange.inventory());
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/inventory") {
      const session = this.sessionId;
      let bytes = 0;
      const chunks: Buffer[] = [];
      for await (const raw of req) {
        const chunk = Buffer.from(raw);
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) throw new ClientError("资料摘要过大", 413);
        chunks.push(chunk);
      }
      try {
        const data = validateInventory(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
        );
        if (
          this.status !== "receiving" ||
          !this.pairing?.approved ||
          this.pairing.id !== device ||
          session !== this.sessionId ||
          Date.now() >= this.expiresAt
        )
          throw Error("连接已结束");
        this.remoteInventory = { data, at: Date.now() };
      } catch {
        throw new ClientError("资料摘要无效或连接已结束，请重新检查连接");
      }
      this.json(res, 200, { received: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/library") {
      if (!this.exchange)
        throw new ClientError("当前版本尚未开放题库交换", 404);
      const id = req.headers["x-upload-id"],
        size = Number(req.headers["content-length"]);
      if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
        throw new ClientError("资料编号无效");
      if (this.exchange.receipt(id)) {
        req.resume();
        this.json(res, 200, { id, received: true });
        return;
      }
      if (this.inFlightIds.size)
        throw new ClientError("正在接收其他资料，请稍后重试", 409);
      if (
        !Number.isSafeInteger(size) ||
        size < 1 ||
        size > 512 * 1024 * 1024 ||
        req.headers["content-type"] !== "application/zip"
      )
        throw new ClientError("题库 ZIP 最多 512 MB", 413);
      const session = this.sessionId,
        temp = path.join(this.folder, randomUUID() + ".part");
      let bytes = 0;
      this.inFlightIds.add(id);
      try {
        await pipeline(
          req,
          new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              bytes += chunk.length;
              callback(bytes > size ? Error("资料超过申报大小") : null, chunk);
            },
          }),
          fs.createWriteStream(temp, { flags: "wx", mode: 0o600 }),
        );
        if (
          bytes !== size ||
          session !== this.sessionId ||
          this.status !== "receiving" ||
          !this.pairing?.approved ||
          this.pairing.id !== device ||
          Date.now() >= this.expiresAt
        )
          throw new ClientError("资料传输未完成，请重新连接后重试");
        await this.exchange.receive(
          id,
          `手机 ${this.pairing.code} 题库资料.zip`,
          bytes,
          temp,
        );
        this.json(res, 201, { id, received: true });
      } finally {
        this.inFlightIds.delete(id);
        fs.rmSync(temp, { force: true });
      }
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/download/")) {
      const transfer = this.transfers.find(
        (item) => item.id === url.pathname.slice(14),
      );
      if (!transfer) throw new ClientError("文件不存在或连接已结束", 404);
      if (transfer.status === "downloading")
        throw new ClientError("文件正在传输，请稍后重试", 409);
      transfer.status = "downloading";
      try {
        const stat = await fs.promises.stat(transfer.file);
        res.writeHead(200, {
          "Content-Type": transfer.file.endsWith(".zip")
            ? "application/zip"
            : transfer.file.endsWith(".pdf")
              ? "application/pdf"
              : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Length": stat.size,
          "Content-Disposition": `attachment; filename="Matheca${path.extname(transfer.file)}"; filename*=UTF-8''${encodeURIComponent(transfer.name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16))}`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        await pipeline(fs.createReadStream(transfer.file), res);
        transfer.status = "transferred";
      } catch (error) {
        transfer.status = "failed";
        throw error;
      }
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
    const receipt = this.receipts.get(uploadId);
    if (receipt) {
      req.resume();
      this.json(res, 200, { id: receipt });
      return;
    }
    if (this.sessionUploads >= 400)
      throw new ClientError("本次连接接收数量已达上限，请重新开启联动", 413);
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
        uploadSession !== this.sessionId ||
        this.pairing?.id !== device ||
        !this.pairing.approved
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
      this.receipts.set(uploadId, photoId);
      try {
        this.persist();
      } catch (error) {
        this.files = this.files.filter((file) => file.id !== photoId);
        this.receipts.delete(uploadId);
        throw error;
      }
      this.sessionUploads++;
      this.json(res, 201, { id: photoId });
      target = undefined;
    } finally {
      this.inFlightIds.delete(uploadId);
      fs.rmSync(temp, { force: true });
      if (target) fs.rmSync(target, { force: true });
    }
  }
}
