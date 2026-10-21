import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { MobileImport, photoExtension } from "../src/main/mobile-import";
const services: MobileImport[] = [],
  folders: string[] = [];
const png = fs.readFileSync(path.resolve("assets/vision-test.png"));
it("keeps a damaged pairing file and allows the rest of the application to construct", async () => {
  const { service, folder } = inbox();
  await service.pause();
  fs.writeFileSync(
    path.join(folder, "paired-devices.json"),
    "broken credential file",
  );
  const replacement = inbox(async () => {}, folder).service;
  expect(replacement.state().status).toBe("closed");
  await expect(replacement.start()).rejects.toThrow("题库不受影响");
  expect(
    fs.readFileSync(path.join(folder, "paired-devices.json"), "utf8"),
  ).toBe("broken credential file");
});
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.pause()));
  for (const folder of folders.splice(0))
    fs.rmSync(folder, { recursive: true, force: true });
});
function inbox(
  intake: (files: string[]) => Promise<string | void> = async () => {},
  folder?: string,
  known: (name: string) => boolean = () => false,
  lifetime = 60000,
) {
  folder ||= fs.mkdtempSync(path.join(os.tmpdir(), "matheca-mobile-test-"));
  if (!folders.includes(folder)) folders.push(folder);
  const service = new MobileImport(
    folder,
    intake,
    known,
    lifetime,
    "127.0.0.1",
  );
  services.push(service);
  return { service, folder };
}
async function client(service: MobileImport) {
  const state = await service.start(),
    url = new URL(state.urls[0]);
  const base = `http://127.0.0.1:${url.port}`;
  const authorization =
    "Bearer " + new URLSearchParams(url.hash.slice(1)).get("pair");
  const headers = {
    authorization,
    "x-device-id": randomBytes(16).toString("hex"),
  };
  await fetch(base + "/api/state", { headers });
  service.approve(headers["x-device-id"]);
  const upload = (
    data: Buffer = png,
    id = randomBytes(16).toString("hex"),
    name = "试题.png",
  ) =>
    fetch(base + "/api/upload", {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/octet-stream",
        "x-upload-id": id,
        "x-file-name": encodeURIComponent(name),
      },
      body: new Uint8Array(data),
    });
  return { state, base, headers, upload };
}
it("remembers only approved phones, reconnects across server restarts, and revokes immediately", async () => {
  const { service, folder } = inbox();
  const c = await client(service);
  const trust = await fetch(c.base + "/api/trust", {
    method: "POST",
    headers: { ...c.headers, "x-device-name": encodeURIComponent("测试手机") },
  });
  const remembered = await trust.json();
  expect(trust.ok).toBe(true);
  expect(service.state().pairedDevices[0].name).toBe("测试手机");
  expect(JSON.stringify(service.state())).not.toContain(remembered.credential);
  expect(
    fs.readFileSync(path.join(folder, "paired-devices.json"), "utf8"),
  ).not.toContain(remembered.credential);
  await service.pause();
  const replacement = inbox(async () => {}, folder).service;
  const started = await replacement.start();
  expect(new URL(started.urls[0]).port).toBe(new URL(c.base).port);
  const headers = {
    ...c.headers,
    authorization: "Bearer " + remembered.credential,
  };
  const response = await fetch(c.base + "/api/state", { headers });
  expect(response.status).toBe(200);
  expect((await response.json()).approved).toBe(true);
  expect(
    (
      await fetch(c.base + "/api/state", {
        headers: { ...headers, "x-device-id": randomBytes(16).toString("hex") },
      })
    ).status,
  ).toBe(401);
  replacement.forgetDevice(headers["x-device-id"]);
  expect((await fetch(c.base + "/api/state", { headers })).status).toBe(401);
  expect(replacement.state().pairedDevices).toHaveLength(0);
});
it("never remembers a pending phone and does not reopen a paused session with saved credentials", async () => {
  const { service } = inbox();
  const c = await client(service);
  const credential = (
    await (
      await fetch(c.base + "/api/trust", { method: "POST", headers: c.headers })
    ).json()
  ).credential;
  await service.pause();
  const next = await service.start();
  const base = "http://127.0.0.1:" + new URL(next.urls[0]).port;
  const headers = {
    authorization: "Bearer " + new URL(next.urls[0]).hash.slice(6),
    "x-device-id": randomBytes(16).toString("hex"),
  };
  expect(
    (await fetch(base + "/api/trust", { method: "POST", headers })).status,
  ).toBe(403);
  service.reject(headers["x-device-id"]);
  expect(
    (
      await fetch(base + "/api/state", {
        headers: { ...c.headers, authorization: "Bearer " + credential },
      })
    ).status,
  ).toBe(200);
});
it("pairs only through a bearer token, rejects foreign origins, and exposes no file paths", async () => {
  const { service } = inbox();
  const c = await client(service);
  expect((await fetch(c.base + "/api/state")).status).toBe(401);
  expect(
    (
      await fetch(c.base + "/api/state", {
        headers: { ...c.headers, origin: "http://foreign.example" },
      })
    ).status,
  ).toBe(403);
  const response = await fetch(c.base + "/api/state", { headers: c.headers });
  expect(response.ok).toBe(true);
  expect(await response.text()).not.toContain("mobile-test");
  const page = await fetch(c.base);
  expect(page.headers.get("content-security-policy")).toContain("sha256-");
  expect(page.headers.get("content-security-policy")).not.toContain(
    "unsafe-inline'; script",
  );
  const html = await page.text();
  const browserScript = html
    .match(/<script>([\s\S]*?)<\/script>/)![1]
    .replace(/\r\n?/g, "\n");
  expect(page.headers.get("content-security-policy")).toContain(
    `sha256-${createHash("sha256").update(browserScript).digest("base64")}`,
  );
  expect(service.state().connected).toBe(true);
  expect(c.state.qrCodes[0]).toMatch(/^data:image\/png;base64,/);
});
it("validates actual image bytes and rejects uploads beyond per-file size", async () => {
  const { service } = inbox();
  const c = await client(service);
  expect((await c.upload(Buffer.from("not a photo"))).status).toBe(400);
  expect(service.state().files).toHaveLength(0);
  const response = await fetch(c.base + "/api/upload", {
    method: "POST",
    headers: {
      ...c.headers,
      "content-type": "text/plain",
      "x-upload-id": randomBytes(16).toString("hex"),
    },
    body: "invalid",
  });
  expect(response.status).toBe(413);
  expect(() => photoExtension(Buffer.alloc(64))).toThrow("请选择");
});
it("makes retries idempotent, sanitizes display names, and saves pictures across pause/restart", async () => {
  const first = inbox();
  const c = await client(first.service),
    id = randomBytes(16).toString("hex");
  expect((await c.upload(png, id, "../../试题.png")).status).toBe(201);
  expect((await c.upload(png, id)).status).toBe(200);
  expect(first.service.state().files).toHaveLength(1);
  const photo = first.service.state().files[0];
  expect(photo.name).not.toContain("/");
  expect(
    fs.existsSync(
      first.service.image(first.service.state().sessionId, photo.id)!,
    ),
  ).toBe(true);
  await first.service.pause();
  expect(first.service.state().status).toBe("closed");
  const recovered = inbox(undefined, first.folder);
  expect(recovered.service.state().files).toHaveLength(1);
  const fresh = await client(recovered.service);
  expect(
    (await fetch(fresh.base + "/api/state", { headers: c.headers })).status,
  ).toBe(401);
});
it("retains pictures on recognition/configuration failure and consumes only after successful intake", async () => {
  let fail = true,
    received: string[] = [];
  const { service } = inbox(async (files) => {
    if (fail) throw Error("请先配置接口");
    received = files;
    expect(fs.existsSync(files[0])).toBe(true);
  });
  const c = await client(service);
  await c.upload();
  await expect(service.confirm()).rejects.toThrow("配置");
  expect(service.state().files).toHaveLength(1);
  fail = false;
  expect(await service.confirm()).toBe(1);
  expect(received).toHaveLength(1);
  expect(service.state().files).toHaveLength(0);
  expect(fs.existsSync(received[0])).toBe(false);
});
it("limits batches to 20, allows removal, and never lets a remote request trigger recognition", async () => {
  let imports = 0;
  const { service } = inbox(async () => {
    imports++;
  });
  const c = await client(service);
  for (let i = 0; i < 20; i++) expect((await c.upload()).ok).toBe(true);
  expect((await c.upload()).status).toBe(413);
  expect(imports).toBe(0);
  expect(
    (
      await fetch(c.base + "/api/confirm", {
        method: "POST",
        headers: c.headers,
      })
    ).status,
  ).toBe(404);
  service.remove(service.state().files[0].id);
  expect(service.state().files).toHaveLength(19);
  expect((await c.upload()).ok).toBe(true);
});
it("expires the listener without deleting received photos", async () => {
  const { service } = inbox(undefined, undefined, undefined, 150);
  const c = await client(service);
  await c.upload();
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(service.state().status).toBe("expired");
  expect(service.state().files).toHaveLength(1);
});
it("recovers already committed intake without offering it for duplicate recognition", async () => {
  const first = inbox();
  const c = await client(first.service);
  await c.upload();
  const name = path.basename(
    first.service.image(
      first.service.state().sessionId,
      first.service.state().files[0].id,
    )!,
  );
  await first.service.pause();
  const recovered = inbox(undefined, first.folder, (value) => value === name);
  expect(recovered.service.state().files).toHaveLength(0);
});
it("closing while start is in flight does not leave a listener active", async () => {
  const { service } = inbox();
  const pending = service.start();
  await service.pause();
  await pending;
  expect(service.state().status).toBe("closed");
});

it("requires desktop approval before exposing inbox, tasks or downloads and rejects another device", async () => {
  const { service } = inbox();
  const state = await service.start();
  const url = new URL(state.urls[0]);
  const base = `http://127.0.0.1:${url.port}`;
  const headers = {
    authorization:
      "Bearer " + new URLSearchParams(url.hash.slice(1)).get("pair"),
    "x-device-id": randomBytes(16).toString("hex"),
  };
  const pending = await (await fetch(base + "/api/state", { headers })).json();
  expect(pending.approved).toBe(false);
  expect(pending.files).toBeUndefined();
  expect(
    (await fetch(base + "/api/download/anything", { headers })).status,
  ).toBe(403);
  expect(
    (await fetch(base + "/api/upload", { method: "POST", headers })).status,
  ).toBe(403);
  service.approve(headers["x-device-id"]);
  expect(
    (await (await fetch(base + "/api/state", { headers })).json()).approved,
  ).toBe(true);
  expect(
    (
      await fetch(base + "/api/state", {
        headers: { ...headers, "x-device-id": randomBytes(16).toString("hex") },
      })
    ).status,
  ).toBe(409);
  service.reject(headers["x-device-id"]);
  expect((await fetch(base + "/api/state", { headers })).status).toBe(403);
});
it("keeps upload acknowledgements after intake and exposes only this session's task progress", async () => {
  const { service } = inbox(async () => "my-job");
  const c = await client(service),
    uploadId = randomBytes(16).toString("hex");
  await c.upload(png, uploadId);
  await service.confirm();
  expect((await c.upload(png, uploadId)).status).toBe(200);
  expect(service.state().files).toHaveLength(0);
  const state = await (
    await fetch(c.base + "/api/state", { headers: c.headers })
  ).json();
  expect(state.receipts).toHaveLength(1);
  expect(state.tasks).toEqual([
    { id: "my-job", photos: 1, status: "unavailable", completed: 0, total: 1 },
  ]);
  await service.pause();
  const fresh = await client(service);
  expect(
    (
      await (
        await fetch(fresh.base + "/api/state", { headers: fresh.headers })
      ).json()
    ).tasks,
  ).toEqual([]);
});
it("shares immutable document copies by opaque ID, preserves filenames and revokes links", async () => {
  const { service, folder } = inbox();
  const c = await client(service);
  const source = path.join(folder, "练习 (A).pdf");
  const content = Buffer.from("%PDF-1.7 test snapshot");
  fs.writeFileSync(source, content);
  const shared = await service.share(source);
  fs.writeFileSync(source, "changed");
  const transfer = shared.transfers[0];
  expect(JSON.stringify(shared.transfers)).not.toContain(
    folder.replaceAll("\\", "\\\\"),
  );
  expect((await fetch(c.base + "/api/download/" + transfer.id)).status).toBe(
    401,
  );
  const download = await fetch(c.base + "/api/download/" + transfer.id, {
    headers: c.headers,
  });
  expect(download.headers.get("content-type")).toBe("application/pdf");
  expect(download.headers.get("content-disposition")).toContain(
    "filename*=UTF-8",
  );
  expect(Buffer.from(await download.arrayBuffer())).toEqual(content);
  await expect
    .poll(() => service.state().transfers[0].status)
    .toBe("transferred");
  expect(
    (await fetch(c.base + "/api/download/not-a-file", { headers: c.headers }))
      .status,
  ).toBe(404);
  await expect(
    service.share(path.join(folder, "manifest.json")),
  ).rejects.toThrow("仅支持");
  await service.pause();
  const fresh = await client(service);
  expect(
    (
      await fetch(fresh.base + "/api/download/" + transfer.id, {
        headers: fresh.headers,
      })
    ).status,
  ).toBe(404);
  expect(
    (await fetch(fresh.base + "/api/state", { headers: c.headers })).status,
  ).toBe(401);
  expect(service.state().transfers).toEqual([]);
});
it("projects task status without leaking unrelated jobs, paths, messages or question content", async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "matheca-mobile-test-"));
  folders.push(folder);
  const jobs = [
    {
      id: "mine",
      status: "processing",
      completed: 1,
      total: 2,
      createdAt: "0",
      message: "secret path and question",
      type: "import" as const,
    },
    {
      id: "other",
      status: "failed",
      completed: 0,
      total: 8,
      createdAt: "0",
      message: "secret unrelated job",
      type: "import" as const,
    },
  ];
  const service = new MobileImport(
    folder,
    async () => "mine",
    undefined,
    60000,
    "127.0.0.1",
    () => jobs,
  );
  services.push(service);
  const c = await client(service);
  await c.upload();
  await service.confirm();
  const response = await fetch(c.base + "/api/state", { headers: c.headers });
  const state = await response.json();
  expect(state.tasks).toEqual([
    { id: "mine", status: "processing", completed: 1, total: 2, photos: 1 },
  ]);
  expect(JSON.stringify(state)).not.toMatch(/secret|other/);
  jobs[0].status = "complete";
  jobs[0].completed = 2;
  expect(service.state().tasks[0].status).toBe("complete");
});

it("keeps committed photo receipts across a new connection and process restart", async () => {
  const first = inbox();
  const c = await client(first.service);
  const id = randomBytes(16).toString("hex");
  await c.upload(png, id);
  await first.service.confirm();
  await first.service.pause();
  const recovered = inbox(undefined, first.folder);
  const fresh = await client(recovered.service);
  expect((await fresh.upload(png, id)).status).toBe(200);
  expect(recovered.service.state().files).toHaveLength(0);
});
