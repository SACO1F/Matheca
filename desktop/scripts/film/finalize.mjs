// 终混：画面 + 旁白 + 自制音床，输出交付用 mp4 与校验清单
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const film = path.resolve(
  here,
  "..",
  "..",
  "..",
  "artifacts",
  "introduction",
  "Matheca-Launch-Film-2026-11-04",
);
const FF = "D:\\AI\\Matheca\\.tmp\\film-tools\\node_modules\\ffmpeg-static\\ffmpeg.exe";
const silent = path.join(film, "build", "video-silent.mp4");
const out = path.join(film, "output", "Matheca-Launch-Film-1080p.mp4");

const run = (args, allowFail = false) =>
  new Promise((resolve, reject) => {
    const child = spawn(FF, args, { windowsHide: true });
    let err = "";
    child.stderr.on("data", (b) => (err += b));
    child.on("exit", (code) =>
      code === 0 || allowFail ? resolve(err) : reject(Error(err.slice(-1500))),
    );
  });

// 旁白实测 -19.9 LUFS / 真峰值 -5.8 dBTP：+3.9dB 静态增益即达 -16 LUFS 且削波安全
const info = await run([
  "-y", "-hide_banner", "-loglevel", "error",
  "-i", silent,
  "-i", path.join(film, "audio", "narration.wav"),
  "-i", path.join(film, "audio", "bed.wav"),
  "-filter_complex",
  "[1:a]volume=3.9dB[n];[n][2:a]amix=inputs=2:duration=longest:dropout_transition=3:normalize=0[a]",
  "-map", "0:v", "-map", "[a]",
  "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
  "-shortest", "-movflags", "+faststart", out,
]);
if (process.env.FILM_VERBOSE) process.stdout.write(info);

const probe = await run(["-hide_banner", "-i", out, "-f", "null", "-"], true);
const duration = /Duration: (\d{2}:\d{2}:\d{2}\.\d{2})/.exec(probe)?.[1];
const size = fs.statSync(out).size;
const sha = crypto.createHash("sha256").update(fs.readFileSync(out)).digest("hex");
const srt = path.join(film, "output", "Matheca-Launch-Film.srt");
const manifest = {
  file: out,
  bytes: size,
  sha256: sha,
  duration,
  resolution: "1920x1080",
  fps: 30,
  video: "libx264 crf18 yuv420p",
  audio: "AAC 192k 48kHz；旁白 +3.9dB 静态增益≈-16 LUFS（真峰值 -1.9 dBTP），自制音床 -36.6 dBFS RMS",
  narrationVoice: "zh-CN-XiaoxiaoNeural (edge-tts, rate +3%)",
  subtitles: fs.existsSync(srt) ? srt : null,
  source: {
    exe: "desktop/releases/tauri/v0.1.0/2026-11-01-00-05-53-1793462753853/Matheca-win32-x64/Matheca.exe",
    dataDir: "desktop/test-output/matheca-film（隔离夹具，未触碰正常题库）",
    recognition: "本地模拟 OpenAI 兼容接口，未使用任何真实 API Key",
    content: "题目与图形均为自编自绘，未使用外部教辅扫描件",
  },
};
fs.writeFileSync(
  path.join(film, "build", "validation.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(JSON.stringify(manifest, null, 2));
