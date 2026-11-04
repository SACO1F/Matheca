// 发布片合成：把真实界面素材装进 M6 苹果发布会风的动效层，逐帧渲染后编码
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..", "..");
const film = path.resolve(
  desktop,
  "..",
  "artifacts",
  "introduction",
  "Matheca-Launch-Film-2026-11-04",
);
const FF = "D:\\AI\\Matheca\\.tmp\\film-tools\\node_modules\\ffmpeg-static\\ffmpeg.exe";
const timings = JSON.parse(
  fs.readFileSync(path.join(film, "build", "timings.json"), "utf8"),
);
const T = Object.fromEntries(timings.shots.map((s) => [s.n, s]));
const shot = (n) => T[n];
const A = (p) => `https://film.local/${p}`;
const clip = (name) => {
  const dir = path.join(film, "motion", name);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jpg"))
    .sort()
    .map((f) => A(`motion/${name}/${f}`));
};

const fps = 30;
const seg = (kind, n, from, to, extra) => {
  const s = shot(n);
  const start = s.start + (to - from) * 0;
  return { kind, n, from, to, ...extra };
};

// 分段表：from/to 是该句旁白内部的相对比例，便于把长句拆成"动作 + 结果"两拍
const RAW = [
  { n: 1, kind: "photos", at: [0, 1], sheets: [
      { src: A("assets/paper-page-1.png"), x: 210, y: 120, w: 640, h: 906, par: 1 },
      { src: A("assets/paper-page-2.png"), x: 880, y: 210, w: 560, h: 793, par: 0.55 },
      { src: A("assets/figure-ellipse.png"), x: 1290, y: 520, w: 470, h: 299, par: 0.28 },
    ], screen: "一道好题" },
  { n: 2, kind: "title", at: [0, 1], logo: true, logoSrc: A("assets/logo.png"), kicker: "LOCAL FIRST · HIGH-SCHOOL MATH", screen: "Matheca" },
  { n: 3, kind: "ui", at: [0, 1], assets: [A("shots/a01-library-default.png")],
    ring: { x: 8, y: 42, w: 62, h: 300 }, screen: "收题 · 校对 · 组卷" },
  { n: 4, kind: "ui", at: [0, 0.42], assets: [A("shots/e00-fab-menu.png")],
    cursor: { from: { x: 1840, y: 1010 }, to: { x: 1560, y: 700 }, tap: 0.5 } },
  { n: 4, kind: "ui", at: [0.42, 1], assets: [A("shots/b04-library-after-import.png")] },
  { n: 5, kind: "clip", at: [0, 0.34], clip: "b02-task-running", fps: 12,
    note: "识别使用你自行配置的接口，可能产生服务费用" },
  { n: 5, kind: "ui", at: [0.34, 1], assets: [A("shots/b03-task-done.png")],
    ring: { x: 1690, y: 190, w: 190, h: 110 } },
  { n: 6, kind: "ui", at: [0, 1], assets: [A("shots/c01-review-split.png")],
    cursor: { from: { x: 1500, y: 300 }, to: { x: 1500, y: 620 }, tap: 0.7 } },
  { n: 7, kind: "clip", at: [0, 0.32], clip: "c03-figure-crop", fps: 12 },
  { n: 7, kind: "ui", at: [0.32, 0.55], assets: [A("shots/c04-after-crop.png")],
    ring: { x: 1436, y: 312, w: 116, h: 40 } },
  { n: 7, kind: "ui", at: [0.55, 1], assets: [A("shots/c07-image-option.png")] },
  { n: 8, kind: "clip", at: [0, 0.3], clip: "c05-confirmed-toast", fps: 12 },
  { n: 8, kind: "ui", at: [0.3, 1], assets: [A("shots/c06-review-closed.png")],
    ring: { x: 1768, y: 995, w: 130, h: 46 } },
  { n: 9, kind: "ui", at: [0, 1], assets: [
      A("shots/d01-filter-grade.png"),
      A("shots/d02-filter-grade-difficulty.png"),
      A("shots/d03-filter-three.png"),
    ] },
  { n: 10, kind: "ui", at: [0, 0.45], assets: [A("shots/d06-join-collection.png")] },
  { n: 10, kind: "ui", at: [0.45, 1], assets: [A("shots/d07-collection-three-columns.png")] },
  { n: 11, kind: "ui", at: [0, 1], assets: [A("shots/d08-document-settings.png")],
    ring: { x: 660, y: 335, w: 250, h: 60 } },
  { n: 12, kind: "ui", at: [0, 0.55], assets: [A("shots/d09-pdf-preview.png")],
    note: "Word 中的公式目前以图片输出，实际 Word／WPS 可能重新分页" },
  { n: 12, kind: "ui", at: [0.55, 1], assets: [A("shots/d10-exported.png")] },
  { n: 13, kind: "split", at: [0, 0.5], phone: [A("shots/e02-phone-scan.png")], ui: [A("shots/e03-desktop-approved.png")] },
  { n: 13, kind: "split", at: [0.5, 1], phone: [A("shots/e06-phone-sent.png")], ui: [A("shots/e07-desktop-inbox.png")] },
  { n: 14, kind: "clip", at: [0, 0.45], clip: "e08-desktop-recognizing", fps: 10 },
  { n: 14, kind: "split", at: [0.45, 1], phone: [A("shots/e11-phone-status.png")], ui: [A("shots/e10-desktop-picker.png")],
    note: "局域网手动交换，当前没有账号云同步" },
  { n: 15, kind: "ui", at: [0, 1], assets: [A("shots/f02-settings-backup.png")],
    ring: { x: 1520, y: 690, w: 210, h: 46 } },
  { n: 16, kind: "title", at: [0, 1], logo: true, logoSrc: A("assets/logo.png"),
    kicker: "WINDOWS · ANDROID · v0.1.0", kickerTop: "45%", logoTop: "27%",
    bigTop: "52%", bigSize: "86px", urlTop: "75%",
    screen: "从一张照片<br>到一张卷子", url: "github.com/SACO1F/Matheca" },
];

const PLAN = [];
for (const r of RAW) {
  const s = shot(r.n);
  const [f0, f1] = r.at;
  const start = +(s.start + s.duration * f0).toFixed(3);
  const dur = +(s.duration * (f1 - f0)).toFixed(3);
  const frames = r.clip ? clip(r.clip).length : 0;
  const assets = r.clip ? clip(r.clip) : r.assets;
  PLAN.push({ ...r, start, dur, assets, frames, clipFps: r.fps || 12 });
}
const total = PLAN[PLAN.length - 1].start + PLAN[PLAN.length - 1].dur;
fs.writeFileSync(path.join(film, "build", "plan.json"), JSON.stringify(PLAN, null, 2));
console.log("segments", PLAN.length, "total", total.toFixed(2), "s");

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".json": "application/json",
};
const browser = await chromium.launch();
const framesDir = path.join(film, "frames");
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  await context.route("https://film.local/**", (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//, "");
    const file = path.join(film, rel);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: rel });
    return route.fulfill({
      body: fs.readFileSync(file),
      contentType: MIME[path.extname(file)] || "application/octet-stream",
    });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto("https://film.local/build/film.html", { waitUntil: "load" });
  await page.evaluate((plan) => window.setPlan(plan), PLAN);
  await page.evaluate(
    (narr) => window.setNarration(narr),
    timings.shots
      .filter((s) => s.n !== 16)
      .map((s) => ({ start: s.start, end: s.start + s.duration, text: s.text })),
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  const count = Math.round(total * fps);
  const preview = process.env.FILM_PREVIEW;
  const t0 = Date.now();
  const times = preview
    ? PLAN.map((s) => s.start + s.dur * 0.62)
    : Array.from({ length: count }, (_, i) => i / fps);
  if (preview) fs.mkdirSync(path.join(film, "build", "preview"), { recursive: true });
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    await page.evaluate((v) => window.seek(v), t);
    const buffer = await page.screenshot({ type: "png" });
    if (preview) {
      fs.writeFileSync(
        path.join(film, "build", "preview", `seg${String(i).padStart(2, "0")}-n${PLAN[i].n}.png`),
        buffer,
      );
    } else {
      fs.writeFileSync(path.join(framesDir, `${String(i).padStart(5, "0")}.png`), buffer);
    }
    if (i % 300 === 0) {
      const rate = (i + 1) / ((Date.now() - t0) / 1000);
      console.log(`frame ${i}/${count} (${rate.toFixed(1)} fps)`);
    }
  }
  if (preview) {
    console.log("preview frames ->", path.join(film, "build", "preview"));
    await browser.close();
    process.exit(0);
  }
  console.log(`rendered ${count} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
} finally {
  await browser.close();
}

const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(FF, args, { windowsHide: true });
    let err = "";
    child.stderr.on("data", (b) => {
      err += b;
      if (process.env.FILM_VERBOSE) process.stderr.write(b);
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(Error(err.slice(-2000)))));
  });

const silent = path.join(film, "build", "video-silent.mp4");
await run([
  "-y", "-hide_banner", "-loglevel", "error",
  "-framerate", String(fps), "-i", path.join(framesDir, "%05d.png"),
  "-c:v", "libx264", "-preset", "medium", "-crf", "18",
  "-pix_fmt", "yuv420p", "-r", String(fps), silent,
]);
console.log("encoded silent");

const out = path.join(film, "output", "Matheca-Launch-Film-1080p.mp4");
fs.mkdirSync(path.dirname(out), { recursive: true });
await run([
  "-y", "-hide_banner", "-loglevel", "error",
  "-i", silent, "-i", path.join(film, "audio", "narration.wav"),
  "-c:v", "copy",
  "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
  "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
  "-shortest", "-movflags", "+faststart", out,
]);
console.log("muxed ->", out);
fs.rmSync(framesDir, { recursive: true, force: true });
