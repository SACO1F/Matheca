// Matheca 发布片录制器：驱动真实打包 EXE，输出静帧与交互连拍
// 用法：node scripts/film/record.mjs --stages=A,B
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { appTest } from "../tauri-ui-session.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..", "..");
const film = path.resolve(
  desktop,
  "..",
  "artifacts",
  "introduction",
  "Matheca-Launch-Film-2026-11-04",
);
const shots = path.join(film, "shots");
const motion = path.join(film, "motion");
const certs = path.join(film, "mock-certs");
const assets = path.join(film, "assets");
const data = path.resolve(desktop, "test-output", "matheca-film");
for (const d of [shots, motion, certs]) fs.mkdirSync(d, { recursive: true });

const stages = (
  process.argv.find((a) => a.startsWith("--stages=")) || "A,B"
)
  .slice("--stages=".length)
  .split(",");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log(...m);

// —— 本地模拟识别服务（不使用任何真实 Key，不产生真实费用）——
const RECOGNIZED = [
  {
    body:
      "已知集合 \\(A=\\{x\\mid x^{2}-3x+2=0\\}\\)，\\(B=\\{1,2,3,4\\}\\)，则 \\(A\\cap B=\\)（　）\nA．\\(\\{1,2\\}\\)　　B．\\(\\{2,3\\}\\)　　C．\\(\\{1,3\\}\\)　　D．\\(\\{1,2,3,4\\}\\)",
    grade: "高一",
    kind: "选择题",
    difficultyScore: 1,
    knowledgePoints: ["集合的基本运算"],
  },
  {
    body:
      "函数 \\(f(x)=\\sqrt{x+1}+\\dfrac{1}{x-2}\\) 的定义域为（　）\nA．\\([-1,2)\\cup(2,+\\infty)\\)　　B．\\((-1,2)\\cup(2,+\\infty)\\)\nC．\\([-1,+\\infty)\\)　　D．\\((2,+\\infty)\\)",
    grade: "高一",
    kind: "选择题",
    difficultyScore: 1,
    knowledgePoints: ["函数的定义域"],
  },
  {
    body:
      "等差数列 \\(\\{a_{n}\\}\\) 中，\\(a_{3}=5\\)，\\(a_{7}=13\\)，则公差 \\(d=\\)＿＿＿，通项公式 \\(a_{n}=\\)＿＿＿。",
    grade: "高二",
    kind: "填空题",
    difficultyScore: 2,
    knowledgePoints: ["等差数列"],
  },
];

const makeCerts = () => {
  if (fs.existsSync(path.join(certs, "ca.pem"))) return;
  execFileSync(
    process.env.MATHECA_QA_PYTHON || "python",
    [
      "-c",
      `
from cryptography import x509
from cryptography.x509.oid import NameOID,ExtendedKeyUsageOID
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from datetime import datetime,timedelta,timezone
from pathlib import Path
import sys,ipaddress
out=Path(sys.argv[1]);now=datetime.now(timezone.utc)
ca=rsa.generate_private_key(public_exponent=65537,key_size=2048)
name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Matheca film fixture CA')])
root=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(ca.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(days=1)).not_valid_after(now+timedelta(days=2)).add_extension(x509.BasicConstraints(ca=True,path_length=0),True).add_extension(x509.KeyUsage(False,False,False,False,False,True,True,False,False),True).sign(ca,hashes.SHA256())
key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
leaf=x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'localhost')])).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(days=1)).not_valid_after(now+timedelta(days=2)).add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'),x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),False).add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),False).sign(ca,hashes.SHA256())
(out/'ca.pem').write_bytes(root.public_bytes(serialization.Encoding.PEM));(out/'server.pem').write_bytes(leaf.public_bytes(serialization.Encoding.PEM));(out/'server.key').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
`,
      certs,
    ],
  );
};

const freePort = async () => {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return port;
};

let requests = 0;
const startMock = async () => {
  const https = await import("node:https");
  const server = https.createServer(
    {
      key: fs.readFileSync(path.join(certs, "server.key")),
      cert: fs.readFileSync(path.join(certs, "server.pem")),
    },
    async (req, res) => {
      let raw = "";
      for await (const c of req) raw += c;
      requests++;
      const payload = JSON.parse(raw);
      const prompt = String(payload.messages?.[0]?.content?.[0]?.text || "");
      const solve = prompt.includes("解题助手");
      const text = solve
        ? JSON.stringify({
            answer: "见教师用书",
            steps: ["本题解答需在电脑上继续核对。"],
            latex: "",
            difficultyScore: 2,
          })
        : JSON.stringify({
            questions: RECOGNIZED.map((q) => ({
              ...q,
              subquestions: [],
              latex: "",
              startPage: 1,
              endPage: 1,
              complete: true,
            })),
            needMorePages: false,
          });
      await new Promise((r) => setTimeout(r, solve ? 300 : 2400));
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: text } }] }),
      );
    },
  );
  const port = await freePort();
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { server, endpoint: `https://127.0.0.1:${port}/v1` };
};

// —— 录制工具 ——
let app, page;
const state = () => page.evaluate(() => window.matheca.state());
const shot = async (name) => {
  await page.evaluate(() => document.fonts.ready);
  const buffer = await page.screenshot();
  fs.writeFileSync(path.join(shots, `${name}.png`), buffer);
  log("shot", name);
};
const burst = async (name, fps, action) => {
  const dir = path.join(motion, name);
  fs.mkdirSync(dir, { recursive: true });
  let stop = false;
  const grab = (async () => {
    let i = 0;
    while (!stop) {
      const t = Date.now();
      try {
        const buffer = await page.screenshot({ type: "jpeg", quality: 92 });
        fs.writeFileSync(path.join(dir, `${String(i).padStart(4, "0")}.jpg`), buffer);
      } catch {}
      i++;
      await wait(Math.max(20, 1000 / fps - (Date.now() - t)));
    }
    return i;
  })();
  await action();
  stop = true;
  const frames = await grab;
  log("burst", name, frames, "frames");
  return { name, frames, fps };
};
const nav = async (name) => {
  await page.locator(".sidebar").getByRole("button", { name, exact: true }).click();
  await page.waitForTimeout(320);
};
const until = async (fn, message, ms = 45000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw Error(message);
    await wait(120);
  }
};

const STAGE_A = async () => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  log("viewport", await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]));
  await page.evaluate(() => window.matheca.setColorTheme("BLUE"));
  await wait(400);
  await shot("a01-library-default");
  await nav("题集");
  await shot("a02-collections");
  await nav("知识点");
  await shot("a03-knowledge");
  await nav("历史记录");
  await shot("a04-history");
  await nav("题库");
  await shot("a05-library-scrolled");
  await page.evaluate(() => window.scrollTo(0, 99999));
  await wait(300);
  await shot("a06-library-bottom");
  await page.evaluate(() => window.scrollTo(0, 0));
};

const STAGE_B = async () => {
  makeCerts();
  const { server, endpoint } = await startMock();
  await page.evaluate(
    async (address) => {
      const s = (await window.matheca.state()).settings;
      await window.matheca.saveSettings({
        ...s,
        address,
        model: "local-fixture",
        apiKey: "matheca-film-synthetic",
        autoSolveImports: false,
      });
    },
    endpoint,
  );
  await nav("设置与备份");
  await wait(400);
  await shot("b01-settings-interface");
  const before = new Set((await state()).jobs.map((j) => j.id));
  const bytes = Array.from(fs.readFileSync(path.join(assets, "paper-page-1.png")));
  await page.evaluate(
    async ({ name, bytes }) =>
      window.matheca.importDropped([new File([new Uint8Array(bytes)], name)]),
    { name: "paper-page-1.png", bytes },
  );
  await nav("任务");
  await wait(120);
  await burst("b02-task-running", 12, async () => {
    await until(
      async () => {
        const j = (await state()).jobs.find((x) => !before.has(x.id));
        return j && !["queued", "processing"].includes(j.status) ? j : false;
      },
      "识别任务未结束",
    );
  });
  await shot("b03-task-done");
  await nav("题库");
  await wait(500);
  await shot("b04-library-after-import");
  server.close();
  log("mock requests", requests);
};

const dumpOn = async (target, label, selector, depth = 3) => {
  const text = await target.evaluate(
    ([sel, d]) => {
      const root = document.querySelector(sel);
      if (!root) return "NOT FOUND " + sel;
      const walk = (el, level) => {
        const lines = [];
        for (const child of el.children) {
          const r = child.getBoundingClientRect();
          lines.push(
            `${"  ".repeat(level)}<${child.tagName.toLowerCase()} class="${child.className}" aria="${child.getAttribute("aria-label") || ""} type="${child.getAttribute("type") || ""}" ${Math.round(r.width)}x${Math.round(r.height)} "${(child.textContent || "").trim().slice(0, 30)}">`,
          );
          if (level < d) lines.push(...walk(child, level + 1));
        }
        return lines;
      };
      return walk(root, 0).join("\n");
    },
    [selector, depth],
  );
  log(`\n----- dump ${label} -----\n${text}\n`);
};

const dump = async (label, selector, depth = 3) => {
  const text = await page.evaluate(
    ([sel, d]) => {
      const root = document.querySelector(sel);
      if (!root) return "NOT FOUND " + sel;
      const walk = (el, level) => {
        const lines = [];
        for (const child of el.children) {
          const r = child.getBoundingClientRect();
          lines.push(
            `${"  ".repeat(level)}<${child.tagName.toLowerCase()} class="${child.className}" aria="${child.getAttribute("aria-label") || ""} role="${child.getAttribute("role") || ""}" ${Math.round(r.width)}x${Math.round(r.height)} "${(child.textContent || "").trim().slice(0, 34)}">`,
          );
          if (level < d) lines.push(...walk(child, level + 1));
        }
        return lines;
      };
      return walk(root, 0).join("\n");
    },
    [selector, depth],
  );
  log(`\n----- dump ${label} ${selector} -----\n${text}\n`);
};

const STAGE_C = async () => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => window.matheca.setColorTheme("BLUE"));
  await nav("题库");
  await wait(500);
  await dump("card", ".cards > div", 4);
  await page
    .locator('button[aria-label="按知识点筛选：椭圆与焦点三角形"]')
    .first()
    .click();
  await wait(700);
  await shot("c00-filtered-by-knowledge");
  await page.locator(".card-review").first().click();
  await wait(1400);
  await dump("review", "main", 3);
  await shot("c01-review-split");
  const viewer = page
    .locator(".editor img, [class*='source'] img, main img")
    .first();
  const box = await viewer.boundingBox().catch(() => null);
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -600);
    await wait(600);
    await shot("c02-source-zoomed");
    await burst("c03-figure-crop", 12, async () => {
      await page.getByRole("button", { name: /提取图形/ }).first().click().catch(() => {});
      await wait(300);
      const b = await viewer.boundingBox();
      await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.25);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) {
        await page.mouse.move(
          b.x + b.width * (0.2 + 0.5 * (i / 12)),
          b.y + b.height * (0.25 + 0.45 * (i / 12)),
        );
        await wait(60);
      }
      await page.mouse.up();
      await wait(900);
    });
    await dump("after-crop", "main", 3);
    await shot("c04-after-crop");
  } else {
    log("no source image box found");
  }
  await page.getByRole("button", { name: /确认已校对|已校对/ }).first().click().catch((e) => log("confirm:", e.message));
  await burst("c05-confirmed-toast", 12, async () => {
    await wait(1200);
  });
  await shot("c06-review-closed");
  await page.getByRole("button", { name: "清除筛选", exact: true }).click().catch(() => {});
  await wait(600);
  // 图片选项：走应用自身的保存通道，把自编几何图放进选择题 A 选项
  await page
    .locator('button[aria-label="按知识点筛选：排列与组合"]')
    .first()
    .click();
  await wait(500);
  await page.locator(".card-review").first().click();
  await wait(900);
  await page.evaluate(
    async (figure) => {
      const q = (await window.matheca.state()).questions.find(
        (x) => x.knowledge === "排列与组合",
      );
      await window.matheca.saveQuestion(
        {
          ...q,
          figures: [figure],
          figureWidths: [120],
          figurePlacements: ["A"],
        },
        true,
      );
    },
    "data:image/png;base64," +
      fs.readFileSync(path.join(data, "sources", "figure-solid.png")).toString("base64"),
  );
  await wait(700);
  await shot("c07-image-option");
  await page.getByRole("button", { name: "关闭题目校对", exact: true }).click().catch(() => {});
  await wait(500);
};

const pick = async (filter, option) => {
  await page.locator(`.glide-trigger[aria-label="${filter}"]`).click();
  await wait(420);
  const target = page
    .getByRole("option", { name: option, exact: true })
    .or(page.locator(`[role="listbox"] >> text=${option}`))
    .or(page.getByText(option, { exact: true }).last());
  await target.first().click();
  await wait(520);
};

const reset = async () => {
  await page.keyboard.press("Escape").catch(() => {});
  await wait(400);
  if ((await page.locator(".modal-backdrop").count().catch(() => 0)) > 0) {
    await page.locator(".modal-backdrop button").first().click().catch(() => {});
    await wait(600);
  }
};

const STAGE_D = async () => {
  await reset();
  await nav("题库");
  await wait(400);
  await pick("年级", "高一");
  await shot("d01-filter-grade");
  await pick("难度", "进阶");
  await shot("d02-filter-grade-difficulty");
  await pick("校对状态", "待校对");
  await shot("d03-filter-three");
  await page.getByRole("button", { name: "清除筛选", exact: true }).click().catch(() => {});
  await wait(400);
  await page.locator(".favorite-filter input").check();
  await wait(500);
  await shot("d04-favorites-only");
  await page.locator(".favorite-filter input").uncheck();
  await wait(400);
  await nav("知识点");
  await wait(600);
  await shot("d05-knowledge-tree");
  await nav("题库");
  await wait(400);
  await page.locator(".card-add-collection").first().click();
  await wait(700);
  await dump("join dialog", '[role="dialog"]', 3);
  await shot("d06-join-collection");
  await page.keyboard.press("Escape");
  await wait(400);
  await nav("题集");
  await wait(500);
  await page.locator(".collection-list-items > *").first().click();
  await wait(700);
  await shot("d07-collection-three-columns");
  await dump("collection", ".collections-layout", 3);
  await page.locator(".collections-layout").getByText("文档设置", { exact: false }).first().scrollIntoViewIfNeeded().catch(() => {});
  await shot("d08-document-settings");
  const preview = page.getByRole("button", { name: "导出 PDF", exact: true }).first();
  await preview.click().catch((e) => log("preview:", e.message));
  await wait(3200);
  await shot("d09-pdf-preview");
  await dump("preview", ".document-preview-backdrop", 3);
  await page
    .locator(".document-preview-backdrop")
    .getByRole("button")
    .first()
    .click()
    .catch(async () => {
      await page.keyboard.press("Escape");
    });
  await wait(900);
  const exportWord = page
    .getByRole("button", { name: "导出 Word", exact: true })
    .first();
  await exportWord.click().catch((e) => log("export:", e.message));
  await wait(2500);
  await shot("d10-exported");
  await page.keyboard.press("Escape");
  await wait(600);
};

const STAGE_F = async () => {
  await reset();
  await nav("设置与备份");
  await wait(600);
  await page.locator(".theme-options").getByText("雾蓝", { exact: true }).click().catch(() => {});
  await wait(500);
  await shot("f01-settings-appearance");
  await page
    .locator(".settings-page")
    .evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    })
    .catch(() => {});
  await wait(700);
  await dump("backup", ".settings-page", 2);
  await shot("f02-settings-backup");
  await page
    .getByRole("button", { name: "导出完整题库", exact: true })
    .first()
    .click()
    .catch((e) => log("backup btn:", e.message));
  await wait(2500);
  await shot("f03-backup-done");
  const zips = fs
    .readdirSync(data)
    .filter((f) => f.endsWith(".zip"))
    .concat(
      fs.existsSync(path.join(data, "backups"))
        ? fs.readdirSync(path.join(data, "backups"))
        : [],
    );
  log("backup files", zips);
};

const STAGE_E = async () => {
  await reset();
  await page.locator("button.fab").click();
  await wait(600);
  await shot("e00-fab-menu");
  await page.locator(".fab-menu").getByText("手机联动", { exact: true }).click();
  await wait(1600);
  await dump("mobile panel", ".content-shell", 3);
  await shot("e01-mobile-panel");
  const mobile = await page.evaluate(() => window.matheca.mobileStart());
  log("mobile urls", JSON.stringify(mobile.urls));
  const phoneBrowser = await chromium.launch({ channel: "msedge" });
  const phone = await phoneBrowser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const shotPhone = async (name) =>
    fs.writeFileSync(path.join(shots, `${name}.png`), await phone.screenshot());
  try {
    await phone.goto(mobile.urls[0], { waitUntil: "load" });
    await wait(1500);
    await dump("phone", "body", 2);
    await shotPhone("e02-phone-scan");
    const status = await page.evaluate(() => window.matheca.mobileStatus());
    log("mobile status", JSON.stringify(status).slice(0, 500));
    const device =
      status.pairing?.id ||
      status.requests?.[0]?.id ||
      status.devices?.[0]?.id ||
      status.pending?.[0]?.id;
    log("approve device", device, "code", status.pairing?.code);
    if (device) {
      await page.evaluate((id) => window.matheca.mobileApprove(id), device);
      await wait(1800);
      await shot("e03-desktop-approved");
      await dump("desktop panel after approve", ".content-shell", 3);
      await shotPhone("e04-phone-connected");
      await dumpOn(phone, "phone ui", "body", 4);
    }
    const input = phone.locator('input[type="file"]').nth(1);
    if (await input.count()) {
      await input.setInputFiles(path.join(assets, "paper-page-2.png"));
      await wait(1500);
      await dumpOn(phone, "phone queued", "main", 3);
      await shotPhone("e05-phone-queued");
      await phone
        .getByRole("button", { name: /发送/ })
        .first()
        .click()
        .catch(async () => {
          await phone.getByText(/发送/).first().click().catch((e) => log("send:", e.message));
        });
      await wait(2500);
      await shotPhone("e06-phone-sent");
      await page
        .locator(".mobile-tabs")
        .getByRole("tab", { name: /收到的照片/ })
        .click()
        .catch(() => {});
      await wait(800);
      await shot("e07-desktop-inbox");
      await page
        .locator(".mobile-import-footer")
        .getByRole("button", { name: /开始识别/ })
        .first()
        .click()
        .catch((e) => log("start recognition:", e.message));
      await burst("e08-desktop-recognizing", 10, () => wait(3200));
      await shot("e09-desktop-recognized");
      await page
        .locator(".mobile-tabs")
        .getByRole("tab", { name: /题目与题库交换/ })
        .first()
        .click()
        .catch(() => {});
      await wait(900);
      await shot("e10-desktop-picker");
      await shotPhone("e11-phone-status");
    } else {
      log("no file input on phone page");
    }
  } finally {
    await phoneBrowser.close();
  }
};

const runners = { A: STAGE_A, B: STAGE_B, C: STAGE_C, D: STAGE_D, E: STAGE_E, F: STAGE_F };
const launchEnv = { ...process.env, MATHECA_TEST_DATA: data };
if (stages.includes("B")) {
  makeCerts();
  launchEnv.MATHECA_HTTPS_CA = path.join(certs, "ca.pem");
}
app = await appTest.launch({ env: launchEnv });
page = await app.firstWindow();
await page.setViewportSize({ width: 1920, height: 1080 });
await page.evaluate(() => window.matheca.setColorTheme("BLUE"));
await wait(400);
try {
  for (const s of stages) {
    log(`=== stage ${s} ===`);
    await runners[s]();
  }
} finally {
  await app.close().catch((e) => log("close:", e.message));
}
