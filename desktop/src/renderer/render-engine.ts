import {
  validateFigures,
  validateFigureWidths,
  figureDimensions,
  questionContent,
} from "../domain/figures";
import katex from "katex";
import "katex/dist/katex.min.css";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  parseMath,
  cleanBody,
  choiceRows,
  escapeHtml,
  type MathPart,
} from "../domain/math";
import type { Question, Collection } from "../shared/types";
import { answerSpaceMm } from "../domain/paper";
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
type FormulaImage = {
  latex: string;
  display: boolean;
  rect: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
};
export interface RenderEngine {
  prepare(
    questions: Question[],
    collection: Collection,
  ): Promise<{
    parts: {
      stem: MathPart[];
      options: MathPart[][];
      rows: ReturnType<typeof choiceRows>;
    }[];
  }>;
  formula(latex: string, display: boolean): Promise<FormulaImage>;
  image(data: string): Promise<string>;
  joinImages(data: string[]): Promise<string>;
  openPdf(data: number[]): Promise<number>;
  pdfPage(page: number): Promise<string>;
}
const container = document.getElementById("document")!;
let questionNumber = 0;
const mathHtml = (parts: MathPart[]) =>
  parts
    .map((p) => {
      if (p.type === "text") return escapeHtml(p.value);
      try {
        return katex.renderToString(p.latex, {
          displayMode: p.display,
          throwOnError: true,
          trust: false,
          strict: "warn",
          output: "html",
        });
      } catch {
        throw Error(
          `第 ${questionNumber} 题公式无法渲染，请检查：${p.latex.slice(0, 120)}`,
        );
      }
    })
    .join("");
const ready = async () => {
  await document.fonts.ready;
  await new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(r)),
  );
};
const css = document.createElement("style");
css.textContent = `@page{size:A4;margin:40pt}body{margin:0;background:white;color:#000;font-family:"SimSun","Microsoft YaHei",sans-serif;font-size:12pt}#document{width:515pt}.paper-title{text-align:center;font-size:20pt;font-weight:bold;margin:0 0 12pt}.summary{text-align:center;font-size:11pt;margin-bottom:12pt}.instructions{font-size:11pt;white-space:pre-wrap;margin-bottom:24pt}.question{margin-bottom:0;break-inside:avoid}.answer-space{break-inside:avoid}.stem{orphans:3;widows:3;break-after:avoid}.options,.question-figure{break-after:avoid}.stem{white-space:pre-wrap;line-height:1.55}.options{width:515pt;table-layout:fixed;border-collapse:collapse;margin-top:6pt}.options td{vertical-align:top;padding:0 0 6pt;overflow-wrap:anywhere;line-height:1.55}.katex{font-size:1em}.katex-display{margin:.7em 0;overflow:visible}.measure{display:inline-block;white-space:nowrap;max-width:none}.formula-only{display:inline-block;font-size:48px;padding:6px}.long-question{break-inside:auto}.question-figure{display:block;max-width:360pt;max-height:270pt;object-fit:contain;margin:10pt 0}.options .question-figure{max-width:100%;height:auto;max-height:none;break-inside:avoid;margin:6pt 0}`;
document.head.append(css);
let pdf: pdfjs.PDFDocumentProxy | undefined;
window.renderEngine = {
  async prepare(questions, collection) {
    document.title = collection.paperTitle || collection.title;
    container.innerHTML = "";
    const parts = [];
    const articles: string[] = [];
    for (const [i, q] of questions.entries()) {
      questionNumber = i + 1;
      const body = cleanBody(q.body);
      if (!body) throw Error(`第 ${i + 1} 题尚未填写题干`);
      const content = questionContent({ ...q, body });
      const stem: MathPart[] = [
        { type: "text", value: `${i + 1}. ` },
        ...parseMath(content.stem),
      ];
      const options = content.options.map((o) => [
        { type: "text", value: `${o.label}. ` } as MathPart,
        ...parseMath(o.value).map((p) =>
          p.type === "formula"
            ? { ...p, display: false }
            : { ...p, value: p.value.replace(/[ \t\n\r\f\v]+/g, " ") },
        ),
      ]);
      const widths: number[] = [];
      for (const option of options) {
        container.innerHTML =
          '<span class="measure">' + mathHtml(option) + "</span>";
        await ready();
        widths.push(
          container.firstElementChild!.getBoundingClientRect().width * 0.75,
        );
      }
      const rows = options.length
        ? choiceRows(
            content.options.some((o) => o.figures.length)
              ? widths.map((w) => Math.max(200, w))
              : widths,
          )
        : [];
      parts.push({ stem, options, rows });
      let html = `<article class="question"${i > 0 && collection.questionLayout?.[q.id]?.pageBreakBefore ? ' style="break-before:page"' : ""}><div class="stem">${mathHtml(stem)}</div>`;
      const figures = validateFigures(q.figures);
      const figureWidths = validateFigureWidths(q.figureWidths, figures.length);
      const figureHtml = (index: number) =>
        `<img class="question-figure" data-width-mm="${figureWidths?.[index] ?? 0}" src="${escapeHtml(figures[index])}" alt="${q.figurePlacements?.[index] && q.figurePlacements[index] !== "stem" ? `选项 ${q.figurePlacements[index]} 图片` : "题目图形"}" />`;
      for (const index of content.stemFigures) html += figureHtml(index);
      for (const row of rows)
        html += `<table class="options"><colgroup>${row.map((c) => `<col style="width:${c.cellWidth}pt">`).join("")}</colgroup><tbody><tr>${row.map((c) => `<td><div style="width:${c.contentWidth}pt">${mathHtml(options[c.index])}${content.options[c.index].figures.map(figureHtml).join("")}</div></td>`).join("")}</tr></tbody></table>`;
      articles.push(
        html +
          `<div class="answer-space" style="height:${answerSpaceMm(q, collection)}mm" aria-label="解答空间"></div></article>`,
      );
    }
    const summary = [
      collection.examMinutes ? `考试时间：${collection.examMinutes} 分钟` : "",
      collection.totalScore ? `满分：${collection.totalScore} 分` : "",
    ]
      .filter(Boolean)
      .join("　　");
    container.innerHTML =
      (collection.paperTitle
        ? `<div class="paper-title">${escapeHtml(collection.paperTitle)}</div>`
        : "") +
      (summary ? `<div class="summary">${summary}</div>` : "") +
      (collection.examInstructions
        ? `<div class="instructions">考试说明：\n${escapeHtml(collection.examInstructions)}</div>`
        : "") +
      articles.join("");
    await Promise.all(
      Array.from(container.querySelectorAll<HTMLImageElement>("img")).map(
        async (image) => {
          await image.decode();
          const mm = Number(image.dataset.widthMm);
          if (mm) {
            const size = figureDimensions(
              image.naturalWidth,
              image.naturalHeight,
              mm,
            );
            Object.assign(image.style, {
              width: `${size.width}px`,
              height: "auto",
              maxWidth: "100%",
              maxHeight: "none",
            });
          }
        },
      ),
    );
    await ready();
    for (const article of container.querySelectorAll("article")) {
      if (article.getBoundingClientRect().height > (762 * 4) / 3)
        article.classList.add("long-question");
    }
    for (const formula of container.querySelectorAll(
      ".katex-display .katex-html",
    ))
      if (formula.getBoundingClientRect().width > (515 * 4) / 3 + 1)
        throw Error("公式超出页面宽度，请修正后导出");
    return { parts };
  },
  async formula(latex, display) {
    container.innerHTML = `<div class="formula-only">${katex.renderToString(latex, { displayMode: display, trust: false, throwOnError: true, output: "html" })}</div>`;
    await ready();
    const rect = container.firstElementChild!.getBoundingClientRect();
    if (rect.width > 3000 || rect.height > 3000) throw Error("公式尺寸过大");
    return {
      latex,
      display,
      rect: {
        x: Math.floor(rect.x),
        y: Math.floor(rect.y),
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
      },
      width: rect.width / 3,
      height: rect.height / 3,
    };
  },
  async image(data) {
    const bitmap = await createImageBitmap(await (await fetch(data)).blob());
    try {
      if (bitmap.width * bitmap.height > 100000000) throw Error("图片像素过大");
      const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height)),
        canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(bitmap.width * scale));
      canvas.height = Math.max(1, Math.floor(bitmap.height * scale));
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.92);
    } finally {
      bitmap.close();
    }
  },
  async joinImages(data) {
    const bitmaps: ImageBitmap[] = [];
    try {
      for (const image of data)
        bitmaps.push(
          await createImageBitmap(await (await fetch(image)).blob()),
        );
      const naturalHeight = bitmaps.reduce(
        (n, image) => n + image.height + 12,
        0,
      );
      const scale = Math.min(1, 30000 / naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(
        Math.max(...bitmaps.map((image) => image.width)) * scale,
      );
      canvas.height = Math.ceil(naturalHeight * scale);
      if (canvas.width * canvas.height > 100000000) throw Error("跨页原图过大");
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#e7ebf2";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      let y = 0;
      for (const image of bitmaps) {
        ctx.drawImage(image, 0, y, image.width * scale, image.height * scale);
        y += (image.height + 12) * scale;
      }
      return canvas.toDataURL("image/jpeg", 0.94);
    } finally {
      bitmaps.forEach((image) => image.close());
    }
  },
  async openPdf(data) {
    if (pdf) await pdf.loadingTask.destroy();
    pdf = await pdfjs.getDocument({
      data: new Uint8Array(data),
      useSystemFonts: true,
      cMapUrl: new URL("./pdfjs/cmaps/", location.href).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("./pdfjs/standard_fonts/", location.href)
        .href,
      wasmUrl: new URL("./pdfjs/wasm/", location.href).href,
    }).promise;
    if (pdf.numPages > 20) throw Error("单份 PDF 最多 20 页");
    return pdf.numPages;
  },
  async pdfPage(number) {
    if (!pdf) throw Error("PDF 未打开");
    const page = await pdf.getPage(number),
      original = page.getViewport({ scale: 1 }),
      scale = Math.min(1400 / original.width, 2000 / original.height);
    const viewport = page.getViewport({ scale }),
      canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const data = canvas.toDataURL("image/jpeg", 0.92);
    page.cleanup();
    canvas.width = 0;
    canvas.height = 0;
    return data;
  },
} satisfies RenderEngine;
