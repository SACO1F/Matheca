import { nativeImage } from "electron";
import {
  validateFigures,
  validateFigureWidths,
  figureDimensions,
  questionContent,
} from "../domain/figures";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  TableLayoutType,
  BorderStyle,
  AlignmentType,
  LineRuleType,
} from "docx";
import fs from "node:fs";
import { RenderHost } from "./render-host";
import type { Question, Collection } from "../shared/types";
import type { MathPart } from "../domain/math";
import { validatePaper, answerSpaceMm } from "../domain/paper";
function printPreparedPdf(host: RenderHost) {
  return host.window.webContents.printToPDF({
    pageSize: "A4",
    preferCSSPageSize: true,
    printBackground: true,
    generateTaggedPDF: true,
  });
}
export async function previewDocument(
  questions: Question[],
  collection: Collection,
) {
  if (!questions.length) throw Error("请先加入至少一道题");
  collection = validatePaper(collection);
  const host = new RenderHost();
  try {
    await host.load();
    await host.prepare(questions, collection);
    return Array.from(await printPreparedPdf(host));
  } finally {
    host.close();
  }
}
export async function exportDocument(
  questions: Question[],
  collection: Collection,
  format: "pdf" | "docx",
  target: string,
) {
  if (!questions.length) throw Error("请先加入至少一道题");
  collection = validatePaper(collection);
  const host = await new RenderHost().load();
  try {
    const { parts } = await host.prepare(questions, collection);
    if (format === "pdf") {
      const bytes = await printPreparedPdf(host);
      fs.writeFileSync(target, bytes);
      return;
    }
    const formulas = new Map<
      string,
      { data: Buffer; width: number; height: number }
    >();
    for (const part of parts.flatMap((p) => [...p.stem, ...p.options.flat()]))
      if (part.type === "formula") {
        const key = String(part.display) + part.latex;
        if (formulas.has(key)) continue;
        const f = await host.call("formula", part.latex, part.display);
        const img = await host.window.webContents.capturePage(f.rect);
        formulas.set(key, {
          data: img.toPNG(),
          width: f.width,
          height: f.height,
        });
      }
    const runs = (ps: MathPart[]): (TextRun | ImageRun)[] =>
      ps.flatMap<TextRun | ImageRun>((p) => {
        if (p.type === "formula") {
          const f = formulas.get(String(p.display) + p.latex)!;
          const scale = Math.min(1, (515 * 4) / 3 / f.width);
          return [
            ...(p.display ? [new TextRun({ break: 1 })] : []),
            new ImageRun({
              type: "png",
              data: f.data,
              transformation: {
                width: f.width * scale,
                height: f.height * scale,
              },
              altText: {
                title: "数学公式",
                description: p.latex,
                name: "formula",
              },
              run: { position: `-${Math.max(0, f.height * 0.375 - 4)}pt` },
            }),
            ...(p.display ? [new TextRun({ break: 1 })] : []),
          ];
        }
        return p.value
          .split("\n")
          .flatMap((line, i) => [
            ...(i ? [new TextRun({ break: 1 })] : []),
            new TextRun(line),
          ]);
      });
    const children: (Paragraph | Table)[] = [];
    if (collection.paperTitle)
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: collection.paperTitle, size: 40, bold: true }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
          run: { size: 40, bold: true },
        }),
      );
    const summary = [
      collection.examMinutes ? `考试时间：${collection.examMinutes} 分钟` : "",
      collection.totalScore ? `满分：${collection.totalScore} 分` : "",
    ]
      .filter(Boolean)
      .join("    ");
    if (summary)
      children.push(
        new Paragraph({
          children: [new TextRun({ text: summary, size: 22 })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
          run: { size: 22 },
        }),
      );
    if (collection.examInstructions)
      children.push(
        new Paragraph({
          children: runs([
            {
              type: "text",
              value: "考试说明：\n" + collection.examInstructions,
            },
          ]),
          spacing: { after: 480 },
          run: { size: 22 },
        }),
      );
    const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
    for (const [index, p] of parts.entries()) {
      children.push(
        new Paragraph({
          children: runs(p.stem),
          keepNext: true,
          pageBreakBefore:
            index > 0 &&
            collection.questionLayout?.[questions[index].id]?.pageBreakBefore,
          spacing: { after: p.rows.length ? 120 : 0, line: 360 },
        }),
      );
      const figures = validateFigures(questions[index].figures);
      const widths = validateFigureWidths(
        questions[index].figureWidths,
        figures.length,
      );
      const content = questionContent(questions[index]);
      const figureParagraph = (figureIndex: number, maxWidth = 480) => {
        const image = nativeImage.createFromDataURL(figures[figureIndex]);
        const size = image.getSize();
        if (image.isEmpty()) throw Error("题目图形无法读取");
        const scale = Math.min(1, maxWidth / size.width, 360 / size.height);
        const desired = widths?.[figureIndex]
          ? figureDimensions(size.width, size.height, widths[figureIndex])
          : { width: size.width * scale, height: size.height * scale };
        const fit = Math.min(1, maxWidth / desired.width);
        return new Paragraph({
          children: [
            new ImageRun({
              type: "png",
              data: image.toPNG(),
              transformation: {
                width: desired.width * fit,
                height: desired.height * fit,
              },
              altText: {
                title: "题目图形",
                description: "从来源原图提取的图形",
                name: "figure",
              },
            }),
          ],
          spacing: { after: 200 },
          keepNext: true,
        });
      };
      children.push(...content.stemFigures.map((i) => figureParagraph(i)));
      for (const row of p.rows) {
        children.push(
          new Table({
            width: { size: 10300, type: WidthType.DXA },
            columnWidths: row.map((c) => Math.round(c.cellWidth * 20)),
            layout: TableLayoutType.FIXED,
            borders: {
              top: none,
              bottom: none,
              left: none,
              right: none,
              insideHorizontal: none,
              insideVertical: none,
            },
            rows: [
              new TableRow({
                cantSplit: true,
                children: row.map(
                  (c) =>
                    new TableCell({
                      width: {
                        size: Math.round(c.cellWidth * 20),
                        type: WidthType.DXA,
                      },
                      margins: {
                        top: 0,
                        bottom: 100,
                        left: 0,
                        right: Math.round((c.cellWidth - c.contentWidth) * 20),
                      },
                      children: [
                        new Paragraph({
                          children: runs(p.options[c.index]),
                          keepNext: true,
                          spacing: { line: 360 },
                        }),
                        ...content.options[c.index].figures.map((i) =>
                          figureParagraph(i, (c.contentWidth * 4) / 3),
                        ),
                      ],
                    }),
                ),
              }),
            ],
          }),
        );
      }
      if (answerSpaceMm(questions[index], collection) > 0)
        children.push(
          new Paragraph({
            text: "",
            spacing: {
              before: 0,
              after: 0,
              line: Math.round(
                (answerSpaceMm(questions[index], collection) * 1440) / 25.4,
              ),
              lineRule: LineRuleType.EXACT,
            },
            keepLines: true,
          }),
        );
    }
    const doc = new Document({
      creator: "Matheca",
      title: collection.paperTitle,
      styles: {
        default: {
          document: {
            run: {
              font: { ascii: "SimSun", eastAsia: "SimSun", hAnsi: "SimSun" },
              size: 24,
              color: "000000",
            },
            paragraph: { spacing: { line: 360 } },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              size: { width: 11900, height: 16840 },
              margin: { top: 800, bottom: 800, left: 800, right: 800 },
            },
          },
          children,
        },
      ],
    });
    fs.writeFileSync(target, await Packer.toBuffer(doc));
  } finally {
    host.close();
  }
}
