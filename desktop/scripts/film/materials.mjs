// Matheca 发布片演示素材生成器
// 题目与图形均为自编自绘，不使用任何外部教辅扫描件；输出到 artifacts/introduction/<片名>/。
import fs from "node:fs";
import path from "node:path";
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
const assets = path.join(film, "assets");
const build = path.join(film, "build");
fs.mkdirSync(assets, { recursive: true });
fs.mkdirSync(build, { recursive: true });
fs.writeFileSync(path.join(assets, "blank.html"), "<!doctype html><meta charset=\"utf-8\">");

const QUESTIONS = [
  {
    id: "film-q-1",
    grade: "高一",
    kind: "选择题",
    difficulty: "基础",
    knowledge: "集合的基本运算",
    reviewed: true,
    favorite: true,
    page: 1,
    number: 1,
    body:
      "已知集合 \\(A=\\{x\\mid x^{2}-3x+2=0\\}\\)，\\(B=\\{1,2,3,4\\}\\)，则 \\(A\\cap B=\\)（　）\nA．\\(\\{1,2\\}\\)　　B．\\(\\{2,3\\}\\)　　C．\\(\\{1,3\\}\\)　　D．\\(\\{1,2,3,4\\}\\)",
    answer: "\\(A=\\{1,2\\}\\)，故 \\(A\\cap B=\\{1,2\\}\\)，选 A。",
  },
  {
    id: "film-q-2",
    grade: "高一",
    kind: "选择题",
    difficulty: "基础",
    knowledge: "函数的定义域",
    reviewed: true,
    favorite: false,
    page: 1,
    number: 2,
    body:
      "函数 \\(f(x)=\\sqrt{x+1}+\\dfrac{1}{x-2}\\) 的定义域为（　）\nA．\\([-1,2)\\cup(2,+\\infty)\\)　　B．\\((-1,2)\\cup(2,+\\infty)\\)\nC．\\([-1,+\\infty)\\)　　D．\\((2,+\\infty)\\)",
    answer: "需 \\(x+1\\geq 0\\) 且 \\(x-2\\neq 0\\)，即 \\([-1,2)\\cup(2,+\\infty)\\)，选 A。",
  },
  {
    id: "film-q-3",
    grade: "高一",
    kind: "选择题",
    difficulty: "进阶",
    knowledge: "同角三角函数关系",
    reviewed: false,
    favorite: false,
    page: 1,
    number: 3,
    body:
      "已知 \\(\\sin\\alpha=\\dfrac{3}{5}\\)，且 \\(\\alpha\\) 是第二象限角，则 \\(\\tan\\alpha=\\)（　）\nA．\\(-\\dfrac{3}{4}\\)　　B．\\(\\dfrac{3}{4}\\)　　C．\\(-\\dfrac{4}{3}\\)　　D．\\(\\dfrac{4}{3}\\)",
    answer: "\\(\\cos\\alpha=-\\dfrac{4}{5}\\)，\\(\\tan\\alpha=-\\dfrac{3}{4}\\)，选 A。",
  },
  {
    id: "film-q-4",
    grade: "高一",
    kind: "选择题",
    difficulty: "进阶",
    knowledge: "指数与对数比较大小",
    reviewed: true,
    favorite: false,
    page: 1,
    number: 4,
    body:
      "设 \\(a=2^{0.3}\\)，\\(b=0.3^{2}\\)，\\(c=\\log_{2}0.3\\)，则 \\(a,b,c\\) 的大小关系是（　）\nA．\\(a>b>c\\)　　B．\\(b>a>c\\)　　C．\\(c>a>b\\)　　D．\\(a>c>b\\)",
    answer: "\\(a>1\\)，\\(0<b<1\\)，\\(c<0\\)，故 \\(a>b>c\\)，选 A。",
  },
  {
    id: "film-q-5",
    grade: "高二",
    kind: "填空题",
    difficulty: "基础",
    knowledge: "等差数列",
    reviewed: true,
    favorite: true,
    page: 1,
    number: 5,
    body:
      "等差数列 \\(\\{a_{n}\\}\\) 中，\\(a_{3}=5\\)，\\(a_{7}=13\\)，则公差 \\(d=\\)＿＿＿，通项公式 \\(a_{n}=\\)＿＿＿。",
    answer: "由 \\(a_{7}-a_{3}=4d=8\\) 得 \\(d=2\\)，\\(a_{1}=1\\)，故 \\(a_{n}=2n-1\\)。",
  },
  {
    id: "film-q-6",
    grade: "高二",
    kind: "填空题",
    difficulty: "基础",
    knowledge: "平面向量的垂直",
    reviewed: false,
    favorite: false,
    page: 1,
    number: 6,
    body:
      "已知向量 \\(\\vec{a}=(1,2)\\)，\\(\\vec{b}=(-2,m)\\)，若 \\(\\vec{a}\\perp\\vec{b}\\)，则实数 \\(m=\\)＿＿＿。",
    answer: "\\(\\vec{a}\\cdot\\vec{b}=-2+2m=0\\)，得 \\(m=1\\)。",
  },
  {
    id: "film-q-7",
    grade: "高二",
    kind: "选择题",
    difficulty: "基础",
    knowledge: "椭圆的简单性质",
    reviewed: true,
    favorite: false,
    page: 2,
    number: 7,
    body:
      "椭圆 \\(\\dfrac{x^{2}}{4}+y^{2}=1\\) 的焦点坐标为（　）\nA．\\((\\pm\\sqrt{3},0)\\)　　B．\\((\\pm3,0)\\)　　C．\\((0,\\pm\\sqrt{3})\\)　　D．\\((0,\\pm3)\\)",
    answer: "\\(a^{2}=4\\)，\\(b^{2}=1\\)，\\(c^{2}=3\\)，焦点在 \\(x\\) 轴上，选 A。",
  },
  {
    id: "film-q-8",
    grade: "高二",
    kind: "解答题",
    difficulty: "进阶",
    knowledge: "导数与函数极值",
    reviewed: true,
    favorite: true,
    page: 2,
    number: 8,
    body: "已知函数 \\(f(x)=x^{3}-3x^{2}+1\\)，求 \\(f(x)\\) 的单调区间与极值。",
    answer:
      "\\(f'(x)=3x^{2}-6x=3x(x-2)\\)。递增区间 \\((-\\infty,0)\\)、\\((2,+\\infty)\\)，递减区间 \\((0,2)\\)；极大值 \\(f(0)=1\\)，极小值 \\(f(2)=-3\\)。",
  },
  {
    id: "film-q-9",
    grade: "高二",
    kind: "解答题",
    difficulty: "挑战",
    knowledge: "椭圆与焦点三角形",
    reviewed: false,
    favorite: true,
    page: 2,
    number: 9,
    figure: "figure-ellipse.png",
    body:
      "如图，\\(F_{1}\\)、\\(F_{2}\\) 分别是椭圆 \\(C:\\dfrac{x^{2}}{4}+y^{2}=1\\) 的左、右焦点，点 \\(P\\) 在 \\(C\\) 上且 \\(\\angle F_{1}PF_{2}=60^{\\circ}\\)，求 \\(\\triangle F_{1}PF_{2}\\) 的面积。",
    answer:
      "\\(|PF_{1}|+|PF_{2}|=4\\)，\\(|F_{1}F_{2}|=2\\sqrt{3}\\)。设 \\(|PF_{1}|\\cdot|PF_{2}|=m\\)，由余弦定理 \\(12=16-3m\\)，得 \\(m=\\dfrac{4}{3}\\)，故 \\(S=\\dfrac{1}{2}m\\sin 60^{\\circ}=\\dfrac{\\sqrt{3}}{3}\\)。",
  },
  {
    id: "film-q-10",
    grade: "高二",
    kind: "证明题",
    difficulty: "挑战",
    knowledge: "立体几何中的线线垂直",
    reviewed: false,
    favorite: false,
    page: 2,
    number: 10,
    figure: "figure-solid.png",
    body:
      "如图，在四棱锥 \\(P-ABCD\\) 中，底面 \\(ABCD\\) 是正方形，\\(PA\\perp\\) 底面 \\(ABCD\\)。求证：\\(BD\\perp PC\\)。",
    answer:
      "连接 \\(AC\\)。底面为正方形，故 \\(AC\\perp BD\\)；\\(PA\\perp\\) 底面，故 \\(PA\\perp BD\\)。由 \\(AC\\cap PA=A\\) 得 \\(BD\\perp\\) 平面 \\(PAC\\)，而 \\(PC\\subset\\) 平面 \\(PAC\\)，所以 \\(BD\\perp PC\\)。",
  },
  {
    id: "film-q-11",
    grade: "高三",
    kind: "解答题",
    difficulty: "进阶",
    knowledge: "三角恒等变换",
    reviewed: true,
    favorite: false,
    page: 2,
    number: 11,
    body:
      "已知函数 \\(f(x)=2\\sin x\\cos x+2\\cos^{2}x\\)，求 \\(f(x)\\) 的最小正周期以及在 \\(\\left[0,\\dfrac{\\pi}{2}\\right]\\) 上的最大值。",
    answer:
      "\\(f(x)=\\sin 2x+\\cos 2x+1=\\sqrt{2}\\sin\\left(2x+\\dfrac{\\pi}{4}\\right)+1\\)，最小正周期 \\(T=\\pi\\)；当 \\(x=\\dfrac{\\pi}{8}\\) 时取最大值 \\(\\sqrt{2}+1\\)。",
  },
  {
    id: "film-q-12",
    grade: "高三",
    kind: "填空题",
    difficulty: "进阶",
    knowledge: "双曲线的渐近线",
    reviewed: true,
    favorite: false,
    page: 2,
    number: 12,
    body:
      "双曲线 \\(\\dfrac{x^{2}}{9}-\\dfrac{y^{2}}{4}=1\\) 的渐近线方程为＿＿＿，离心率为＿＿＿。",
    answer: "渐近线 \\(y=\\pm\\dfrac{2}{3}x\\)；\\(c=\\sqrt{13}\\)，\\(e=\\dfrac{\\sqrt{13}}{3}\\)。",
  },
  {
    id: "film-q-13",
    grade: "高三",
    kind: "选择题",
    difficulty: "挑战",
    knowledge: "排列与组合",
    reviewed: false,
    favorite: false,
    page: 2,
    number: 13,
    body:
      "从 \\(4\\) 名男生和 \\(3\\) 名女生中选出 \\(3\\) 人参加活动，要求至少有 \\(1\\) 名女生，则不同的选法共有（　）\nA．\\(27\\) 种　　B．\\(31\\) 种　　C．\\(35\\) 种　　D．\\(42\\) 种",
    answer: "\\(\\binom{7}{3}-\\binom{4}{3}=35-4=31\\)，选 B。",
  },
  {
    id: "film-q-14",
    grade: "高三",
    kind: "解答题",
    difficulty: "挑战",
    knowledge: "含参函数的单调性讨论",
    reviewed: false,
    favorite: true,
    page: 2,
    number: 14,
    body:
      "已知函数 \\(f(x)=\\ln x-ax\\)（\\(a\\in\\mathbb{R}\\)），讨论 \\(f(x)\\) 的单调性。",
    answer:
      "定义域 \\((0,+\\infty)\\)，\\(f'(x)=\\dfrac{1-ax}{x}\\)。当 \\(a\\leq 0\\) 时 \\(f'(x)>0\\)，\\(f(x)\\) 在 \\((0,+\\infty)\\) 上单调递增；当 \\(a>0\\) 时在 \\(\\left(0,\\dfrac{1}{a}\\right)\\) 上递增，在 \\(\\left(\\dfrac{1}{a},+\\infty\\right)\\) 上递减。",
  },
];

const FIGURES = {
  "figure-ellipse.png": {
    width: 1100,
    height: 700,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="700" viewBox="0 0 1100 700" font-family="Georgia, serif">
<rect width="1100" height="700" fill="#ffffff"/>
<g stroke="#d8d8d8" stroke-width="1.5"><line x1="90" y1="350" x2="1010" y2="350"/><line x1="550" y1="70" x2="550" y2="630"/></g>
<ellipse cx="550" cy="350" rx="420" ry="210" fill="none" stroke="#262626" stroke-width="3"/>
<g fill="#262626"><circle cx="340" cy="350" r="6"/><circle cx="760" cy="350" r="6"/><circle cx="655" cy="166" r="6"/></g>
<g stroke="#315a86" stroke-width="2.5" fill="none"><line x1="340" y1="350" x2="655" y2="166"/><line x1="760" y1="350" x2="655" y2="166"/></g>
<path d="M 612 205 A 52 52 0 0 0 641 220" fill="none" stroke="#315a86" stroke-width="2"/>
<g font-size="28" fill="#262626"><text x="316" y="394">F₁</text><text x="746" y="394">F₂</text><text x="672" y="156">P</text><text x="978" y="384">x</text><text x="562" y="92">y</text><text x="590" y="252">60°</text></g>
</svg>`,
  },
  "figure-solid.png": {
    width: 900,
    height: 700,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700" viewBox="0 0 900 700" font-family="Georgia, serif">
<rect width="900" height="700" fill="#ffffff"/>
<g stroke="#262626" stroke-width="3" fill="none">
<polygon points="200,520 520,590 700,430 380,360"/>
<line x1="200" y1="520" x2="380" y2="120"/><line x1="700" y1="430" x2="380" y2="120"/>
<line x1="520" y1="590" x2="380" y2="120"/>
</g>
<g stroke="#315a86" stroke-width="2.5" stroke-dasharray="9 8" fill="none">
<line x1="200" y1="520" x2="700" y2="430"/><line x1="520" y1="590" x2="380" y2="360"/>
<line x1="380" y1="120" x2="360" y2="470"/>
</g>
<g font-size="30" fill="#262626">
<text x="166" y="554">A</text><text x="512" y="634">B</text><text x="712" y="442">C</text><text x="344" y="366">D</text><text x="372" y="104">P</text>
</g>
</svg>`,
  },
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};
const katexDist = path.join(desktop, "node_modules", "katex", "dist");
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ deviceScaleFactor: 1.5 });
  await context.route("https://film.local/**", (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//, "");
    const file = rel.startsWith("katex/")
      ? path.join(katexDist, rel.slice("katex/".length))
      : path.join(assets, rel);
    if (!fs.existsSync(file))
      return route.fulfill({ status: 404, body: `missing ${rel}` });
    return route.fulfill({
      body: fs.readFileSync(file),
      contentType: MIME[path.extname(file)] || "application/octet-stream",
    });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  for (const [name, spec] of Object.entries(FIGURES)) {
    await page.setViewportSize({ width: spec.width, height: spec.height });
    await page.goto("https://film.local/blank.html");
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}</style>${spec.svg}`,
    );
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(assets, name) });
    console.log("figure ->", name);
  }
  await page.setViewportSize({ width: 1240, height: 1754 });
  for (const n of [1, 2]) {
    const items = QUESTIONS.filter((q) => q.page === n);
    fs.writeFileSync(path.join(assets, `page-${n}.html`), paperPage(n, items));
    await page.goto(`https://film.local/page-${n}.html`, { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.images].map(
          (img) =>
            img.complete ||
            new Promise((r) => {
              img.onload = img.onerror = r;
            }),
        ),
      );
    });
    const check = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll("body *")) {
        if (el.closest("svg")) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 1400)
          bad.push(`${el.tagName}.${el.className}`.toString().slice(0, 50));
      }
      return {
        scrollWidth: document.documentElement.scrollWidth,
        math: document.querySelectorAll(".katex").length,
        fonts: document.fonts.check("27px KaTeX_Main"),
        bad: bad.slice(0, 5),
      };
    });
    if (check.math < 1 || !check.fonts || check.bad.length)
      throw Error(`试卷页排版异常：${JSON.stringify(check)}`);
    console.log(`page ${n}: ${JSON.stringify(check)}`);
    await page.screenshot({
      path: path.join(assets, `paper-page-${n}.png`),
      fullPage: true,
    });
    console.log("paper ->", `paper-page-${n}.png`);
  }
  // 同一份自编题导出成两页 PDF，供"拖一份 PDF 进窗口"与跨页识别镜头使用
  for (const n of [1, 2]) {
    await page.goto(`https://film.local/page-${n}.html`, { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.images].map(
          (img) =>
            img.complete ||
            new Promise((r) => {
              img.onload = img.onerror = r;
            }),
        ),
      );
    });
    await page.pdf({
      path: path.join(assets, `paper-part-${n}.pdf`),
      printBackground: true,
      width: "1240px",
      height: `${Math.ceil(
        await page.evaluate(() => document.body.scrollHeight),
      )}px`,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    console.log("pdf ->", `paper-part-${n}.pdf`);
  }
} finally {
  await browser.close();
}

function paperPage(n, items) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://film.local/katex/katex.min.css">
<script src="https://film.local/katex/katex.min.js"></script>
<script src="https://film.local/katex/contrib/auto-render.min.js"></script>
<style>
html,body{margin:0}
body{width:1240px;background:#fff;color:#1a1a1a;font-family:"SimSun","SimHei",serif;font-size:27px;line-height:1.9;padding:76px 92px 90px;box-sizing:border-box}
.title{text-align:center;font-family:"SimHei","SimSun",sans-serif;font-size:40px;letter-spacing:2px;margin:0 0 12px}
.sub{text-align:center;font-size:24px;color:#444;margin:0 0 30px}
.q{margin:0 0 20px}
.q .no{font-weight:700}
.fig{display:block;margin:8px 0 12px;max-width:480px}
.foot{margin-top:38px;padding-top:14px;border-top:1px solid #bbb;font-size:22px;color:#555}
.katex{font-size:1.05em}
</style></head><body>
<h1 class="title">高二数学周测（自编题）</h1>
<p class="sub">${
  n === 1
    ? "满分 100 分　考试时间 45 分钟　　班级＿＿＿＿　姓名＿＿＿＿"
    : "第 2 页　填空题与解答题"
}</p>
${items
  .map(
    (q) => `<p class="q"><span class="no">${q.number}．</span>${q.body.replace(
      /\n/g,
      "<br>&nbsp;&nbsp;&nbsp;&nbsp;",
    )}${
      q.figure
        ? `<img class="fig" src="https://film.local/${q.figure}">`
        : ""
    }</p>`,
  )
  .join("")}
<p class="foot">${
  n === 1
    ? "本卷题目与图形均为自编自绘，仅用于 Matheca 功能演示。"
    : "—— 自编题，仅用于 Matheca 功能演示 ——"
}</p>
<script>
renderMathInElement(document.body, {
  delimiters: [
    { left: "\\\\[", right: "\\\\]", display: true },
    { left: "\\\\(", right: "\\\\)", display: false },
  ],
  throwOnError: false,
});
</script>
</body></html>`;
}

const picked = ["film-q-8", "film-q-9", "film-q-11", "film-q-3", "film-q-5", "film-q-7"];
const redo = QUESTIONS.filter((q) => !q.reviewed).map((q) => q.id);
const now = Date.now();
const questions = QUESTIONS.map((q, i) => ({
  id: q.id,
  title: "",
  body: q.body,
  latex: "",
  grade: q.grade,
  kind: q.kind,
  difficulty: q.difficulty,
  knowledge: q.knowledge,
  sourcePath: q.figure ? path.join(assets, q.figure) : path.join(assets, `paper-page-${q.page}.png`),
  sourceLabel: q.figure ? "自编图形" : `周测卷 第${q.page}页`,
  reviewed: q.reviewed,
  favorite: q.favorite,
  example: false,
  createdAt: String(now - (QUESTIONS.length - i) * 90000),
  autoSolve: false,
  solution: q.reviewed ? q.answer : "",
  solutionLatex: "",
  solutionFingerprint: "",
  solutionError: "",
  figures: [],
  figureWidths: [],
  figurePlacements: [],
}));
fs.writeFileSync(
  path.join(build, "seed.json"),
  JSON.stringify(
    {
      questions,
      collections: [
        {
          id: "film-paper",
          title: "高二数学周测",
          paperTitle: "高二数学周测（自编题）",
          createdAt: String(now),
          examInstructions: "本卷题目与图形均为自编自绘，仅用于 Matheca 功能演示。",
          examMinutes: 45,
          totalScore: 100,
          questionLayout: Object.fromEntries(
            picked.map((id) => [
              id,
              {
                answerSpaceMm:
                  QUESTIONS.find((q) => q.id === id).kind === "选择题"
                    ? 0
                    : QUESTIONS.find((q) => q.id === id).kind === "填空题"
                      ? 20
                      : 50,
                pageBreakBefore: id === "film-q-11",
              },
            ]),
          ),
        },
        {
          id: "film-redo",
          title: "考前重做清单",
          paperTitle: "考前重做清单",
          createdAt: String(now),
          examInstructions: "按知识点回看未校对与挑战题，考前重做。",
          examMinutes: 30,
          totalScore: 50,
          questionLayout: Object.fromEntries(
            redo.map((id) => [id, { answerSpaceMm: 50, pageBreakBefore: false }]),
          ),
        },
      ],
      items: { "film-paper": picked, "film-redo": redo },
      knowledge: [
        { group: "集合与常用逻辑用语", name: "集合的基本运算" },
        { group: "函数与导数", name: "函数的定义域" },
        { group: "函数与导数", name: "导数与函数极值" },
        { group: "函数与导数", name: "含参函数的单调性讨论" },
        { group: "指数函数与对数函数", name: "指数与对数比较大小" },
        { group: "三角函数", name: "同角三角函数关系" },
        { group: "三角函数", name: "三角恒等变换" },
        { group: "数列", name: "等差数列" },
        { group: "平面向量", name: "平面向量的垂直" },
        { group: "立体几何", name: "立体几何中的线线垂直" },
        { group: "解析几何", name: "椭圆的简单性质" },
        { group: "解析几何", name: "椭圆与焦点三角形" },
        { group: "解析几何", name: "双曲线的渐近线" },
        { group: "概率与统计", name: "排列与组合" },
      ],
    },
    null,
    2,
  ),
);
console.log("seed ->", path.join(build, "seed.json"));
