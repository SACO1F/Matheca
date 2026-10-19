import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const core = [
  "manual-entry-ui",
  "color-themes-ui",
  "task-links-ui",
  "editor-performance-ui",
  "mobile-import-ui",
  "e2e",
  "expanded-ui",
  "navigation-ui",
  "tree-ui",
  "collections-ui",
  "collection-picker-ui",
  "option-sizing-delete-ui",
  "recovery-ui",
  "sidebar-performance-ui",
  "fab-scroll-ui",
];
const full = [
  ...core,
  "history-ui",
  "management-layout-ui",
  "difficulty-spacing-ui",
  "cross-page-ui",
  "settings-drop-ui",
  "screenshot-import-ui",
  "api-guide-ui",
  "integration",
  "image-choices-ui",
  "toast-collections-ui",
  "layout-add-undo-ui",
  "lattice-loader-ui",
];
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--"))
    throw Error(`${name} 需要参数`);
  return args[index + 1];
}
const suite = option("--suite", "core");
if (!["core", "full"].includes(suite))
  throw Error("--suite 仅支持 core 或 full");
const available = suite === "core" ? core : full;
const selected = option("--only", "").split(",").filter(Boolean);
if (selected.some((name) => !available.includes(name)))
  throw Error("--only 包含当前套件没有的脚本，请使用 --list 查看。");
const cases = selected.length ? [...new Set(selected)] : available;
if (args.includes("--list")) {
  console.log(`${suite}: ${cases.join(", ")}`);
  process.exit(0);
}
for (let index = 0; index < args.length; index++) {
  if (["--suite", "--exe", "--only"].includes(args[index])) index++;
  else throw Error(`未知参数：${args[index]}`);
}
const major = Number(process.versions.node.split(".")[0]);
if (![22, 24].includes(major) && major < 26)
  throw Error(
    `当前 Node ${process.version} 不在项目支持范围，请使用 Node 22、24 或 26 及以上。`,
  );
const latest = fs.existsSync("releases/latest.txt")
  ? fs
      .readFileSync("releases/latest.txt", "utf8")
      .match(/^EXE: (.+)$/m)?.[1]
      .trim()
  : undefined;
const executable = path.resolve(
  option("--exe", process.env.MATHECA_EXE || latest || ""),
);
if (
  path.extname(executable).toLowerCase() !== ".exe" ||
  !fs.existsSync(executable)
)
  throw Error("未找到便携版 EXE，请先打包或使用 --exe 指定。");
const hash = createHash("sha256")
  .update(fs.readFileSync(executable))
  .digest("hex");
const payload = path.join(path.dirname(executable), "resources", "app.asar");
if (!fs.existsSync(payload))
  throw Error("EXE 旁缺少 resources/app.asar，请保留完整便携目录。");
const payloadHash = createHash("sha256")
  .update(fs.readFileSync(payload))
  .digest("hex");
const run = path.resolve(
  "test-output",
  `validation-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`,
);
fs.mkdirSync(run, { recursive: true });
const report = path.join(run, "REPORT.md"),
  results = [];
const before = () =>
  new Set(
    fs
      .readdirSync("test-output", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
const escape = (value) =>
  String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
function save() {
  fs.writeFileSync(
    report,
    `# 便携版验证：${suite}\n\n- 开始时间（北京时间）：${started}\n- EXE：${executable}\n- SHA256：${hash}\n- 系统：${os.type()} ${os.release()} ${os.arch()}\n- Node：${process.version}\n- 测试数据：独立 test-output 子目录，不使用正常题库\n\n| 脚本 | 退出码/状态 | 耗时 | 日志 | 新建数据/证据目录 |\n| --- | --- | --- | --- | --- |\n` +
      results
        .map(
          (result) =>
            `| ${result.name} | ${escape(result.status)} | ${result.seconds}s | [日志](./${result.name}.log) | ${result.folders.map((folder) => `[${folder}](../${folder}/)`).join("、")} |`,
        )
        .join("\n") +
      `\n\n应用代码 app.asar SHA256：${payloadHash}\n`,
  );
}
const started = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  dateStyle: "short",
  timeStyle: "medium",
}).format(new Date());
save();
let interrupted = false;
let child;
process.on("SIGINT", () => {
  interrupted = true;
  child?.kill();
});
for (const name of cases) {
  if (interrupted) break;
  const foldersBefore = before(),
    start = Date.now();
  console.log(`运行 ${name} …`);
  const log = fs.createWriteStream(path.join(run, `${name}.log`));
  let timeout = false;
  const status = await new Promise((resolve) => {
    child = spawn(process.execPath, [path.join("scripts", `${name}.mjs`)], {
      cwd: root,
      env: { ...process.env, MATHECA_EXE: executable },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    const timer = setTimeout(() => {
      timeout = true;
      child.kill();
    }, 240_000);
    child.on("error", (error) => {
      log.write(error.message);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve(
        timeout
          ? "超时"
          : interrupted
            ? "中断"
            : (code ?? signal ?? "启动失败"),
      );
    });
  });
  await new Promise((resolve) => log.end(resolve));
  const result = {
    name,
    status,
    seconds: Math.round((Date.now() - start) / 100) / 10,
    folders: [...before()].filter((folder) => !foldersBefore.has(folder)),
  };
  results.push(result);
  save();
  console.log(
    `${name}: ${status === 0 ? "通过" : `失败（${status}）`}，${result.seconds}s`,
  );
  // Stop after a timeout/interruption so an unresponsive test window cannot
  // interfere with the next case. Never terminate unrelated Matheca apps.
  if (timeout || interrupted) break;
}
console.log(`报告：${report}`);
process.exitCode =
  results.length !== cases.length ||
  results.some((result) => result.status !== 0)
    ? 1
    : 0;
