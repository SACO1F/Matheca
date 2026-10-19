import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { MobileImport, photoExtension } from "../src/main/mobile-import";
const services: MobileImport[] = [],
  folders: string[] = [];
const png = fs.readFileSync(path.resolve("assets/vision-test.png"));
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.pause()));
  for (const folder of folders.splice(0))
    fs.rmSync(folder, { recursive: true, force: true });
});
function inbox(
  intake: (files: string[]) => Promise<void> = async () => {},
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
  const headers = { authorization };
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
