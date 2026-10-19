// Preserve Kotlin UTF-16 offsets and whitespace semantics rather than applying Unicode normalization.
export const trim = (s: string) =>
  s.replace(
    /^[\u0009-\u000d\u001c-\u0020\p{Z}]+|[\u0009-\u000d\u001c-\u0020\p{Z}]+$/gu,
    "",
  );
const whitespace = /[\u0009-\u000d\u001c-\u0020\p{Z}]/u;
export type MathPart =
  | { type: "text"; value: string }
  | { type: "formula"; latex: string; display: boolean };
const delimiters = () =>
  /\$\$(.+?)\$\$|\\\[(.+?)\\\]|\\\((.+?)\\\)|(?<![\\$])\$(?!\$)([^\n$]+?)(?<!\\)\$(?!\$)/gs;
export function formulaRanges(s: string) {
  return [...s.matchAll(delimiters())].map((m) => ({
    start: m.index!,
    end: m.index! + m[0].length,
  }));
}
export function toLatex(s: string): string {
  const supers = "⁰¹²³⁴⁵⁶⁷⁸⁹",
    subs = "₀₁₂₃₄₅₆₇₈₉";
  const symbols: Record<string, string> = {
    "×": "\\times ",
    "÷": "\\div ",
    "·": "\\cdot ",
    "≤": "\\le ",
    "≥": "\\ge ",
    "≠": "\\ne ",
    π: "\\pi ",
    "∞": "\\infty ",
    "∈": "\\in ",
    "∉": "\\notin ",
    "∪": "\\cup ",
    "∩": "\\cap ",
    "−": "-",
    "－": "-",
    "＋": "+",
    "√": "\\sqrt",
    ₙ: "_{n}",
  };
  return s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+|[₀₁₂₃₄₅₆₇₈₉]+|[×÷·≤≥≠π∞∈∉∪∩−－＋√ₙ]/g, (m) =>
    supers.includes(m[0])
      ? "^{" + [...m].map((c) => supers.indexOf(c)).join("") + "}"
      : subs.includes(m[0])
        ? "_{" + [...m].map((c) => subs.indexOf(c)).join("") + "}"
        : symbols[m],
  );
}
function legacy(text: string): MathPart[] {
  const matcher =
    /(?<![A-Za-z0-9])(?:\\[A-Za-z]+|[A-Za-zα-ωΑ-Ω√]|[0-9])(?:[A-Za-z0-9α-ωΑ-Ω²³⁰¹⁴⁵⁶⁷⁸⁹₀-₉ₙπ∞×÷·≤≥≠∈∉∪∩√+\-=−－＋*/^_{}()\[\],.'|\\ \t])*/g;
  const out: MathPart[] = [];
  let offset = 0;
  for (const m of text.matchAll(matcher)) {
    const expr = m[0].replace(/[ \t.,]+$/, "");
    if (!/[=+\-−－＋*/^_²³⁰¹⁴⁵⁶⁷⁸⁹₀-₉ₙ×÷·≤≥≠∈∉∪∩√]|\\[A-Za-z]+/.test(expr))
      continue;
    if (offset < m.index!)
      out.push({ type: "text", value: text.slice(offset, m.index) });
    out.push({ type: "formula", latex: toLatex(expr), display: false });
    offset = m.index! + expr.length;
  }
  if (offset < text.length)
    out.push({ type: "text", value: text.slice(offset) });
  return out;
}
export function parseMath(s: string): MathPart[] {
  const out: MathPart[] = [];
  let offset = 0;
  for (const m of s.matchAll(delimiters())) {
    out.push(...legacy(s.slice(offset, m.index)));
    out.push({
      type: "formula",
      latex: trim(m[1] ?? m[2] ?? m[3] ?? m[4]),
      display: m[1] != null || m[2] != null,
    });
    offset = m.index! + m[0].length;
  }
  out.push(...legacy(s.slice(offset)));
  return out;
}
const prefix =
  /^[ \t\n\r\f\v]*(?:第[ \t\n\r\f\v]*[0-9一二三四五六七八九十百]+[ \t\n\r\f\v]*题[ \t\n\r\f\v]*[:：.．、]?|[0-9]{1,3}[ \t\n\r\f\v]*[.．、](?![0-9])|[（(][ \t\n\r\f\v]*[0-9]{1,3}[ \t\n\r\f\v]*[)）](?![ \t\n\r\f\v]*[+\-=*/^,，])[ \t\n\r\f\v]*[.．、]?|[①-⑳])[ \t\n\r\f\v]*/;
const subPrefix =
  /^[ \t\n\r\f\v]*(?:[（(][ \t\n\r\f\v]*[0-9]{1,3}[ \t\n\r\f\v]*[)）](?![ \t\n\r\f\v]*[+\-=*/^,，])[ \t\n\r\f\v]*[.．、]?|[①-⑳])[ \t\n\r\f\v]*/;
export function cleanTitle(s: string) {
  let out = trim(s);
  for (let i = 0; i < 3; i++) out = out.replace(prefix, "");
  return out;
}
export function cleanBody(s: string) {
  const ranges = formulaRanges(s);
  const boundary =
    /(?<=[。；;：:])[ \t\n\r\f\v]*(?=(?:[（(][ \t\n\r\f\v]*[0-9]{1,3}[ \t\n\r\f\v]*[)）](?![ \t\n\r\f\v]*[+\-=*/^,，])|[①-⑳]))/g;
  let text = "",
    start = 0;
  for (const m of s.matchAll(boundary)) {
    const end = m.index! + m[0].length;
    if (ranges.some((r) => end >= r.start && end < r.end)) continue;
    text += s.slice(start, m.index) + "\n";
    start = end;
  }
  text += s.slice(start);
  const fr = formulaRanges(text),
    marked: number[] = [],
    inferred: number[] = [];
  let offset = 0;
  const lines = text.split(/\r\n|\n|\r/).map((original, index) => {
    const p = [...original].findIndex((c) => !whitespace.test(c));
    const inside = fr.some(
      (r) =>
        offset + Math.max(0, p) >= r.start && offset + Math.max(0, p) < r.end,
    );
    offset += original.length + 1;
    const line = inside
      ? original.replace(/[\u0009-\u000d\u001c-\u0020\p{Z}]+$/u, "")
      : cleanTitle(original);
    if (!inside && subPrefix.test(original)) marked.push(index);
    if (
      !inside &&
      /^(?:求|证明|判断|说明|计算|写出|解方程|解不等式|比较|讨论)/.test(line)
    )
      inferred.push(index);
    return line;
  });
  const first = lines.findIndex((x) => trim(x) !== "");
  const parts = marked.length ? marked : inferred.filter((i) => i > first);
  let number = 0;
  return trim(
    lines
      .map((line, index) =>
        parts.length > 1 && parts.includes(index)
          ? `（${++number}）${line}`
          : line,
      )
      .join("\n"),
  );
}
export function withSubquestions(stem: string, parts: string[]) {
  return cleanBody(
    [
      cleanBody(stem),
      ...parts.map((p, i) => `（${i + 1}）${cleanTitle(p)}`),
    ].join("\n"),
  );
}
export function titleFromBody(s: string) {
  return (
    trim(
      parseMath(cleanBody(s).split("\n")[0] ?? "")
        .filter((p) => p.type === "text")
        .map((p) => (p.type === "text" ? p.value : ""))
        .join(""),
    )
      .replace(/^[ ，。：]+|[ ，。：]+$/g, "")
      .slice(0, 36) || "待录入题目"
  );
}
// Only remove a complete redundant 1/A, 2/B, 3/C, 4/D sequence.
// Parenthesized values and numbering inside formulas must remain intact.
export function normalizeChoiceBody(body: string) {
  const ranges = formulaRanges(body);
  const markers = [
    ...body.matchAll(
      /[（(]([1-4])[）)][ \t\n\r]*?(?=(?:([A-DＡ-Ｄ])[.．、:：)）]|[（(]([A-DＡ-Ｄ])[）)]))/g,
    ),
  ]
    .filter((m) => !ranges.some((r) => m.index! >= r.start && m.index! < r.end))
    .filter((m) => {
      const c = (m[2] ?? m[3]).charCodeAt(0);
      return Number(m[1]) === (c >= 0xff21 ? c - 0xff21 : c - 65) + 1;
    });
  const removed = new Set<number>();
  for (let i = 0; i <= markers.length - 4; i++) {
    const group = markers.slice(i, i + 4);
    if (group.map((m) => m[1]).join("") === "1234")
      group.forEach((m) => removed.add(m.index!));
  }
  return body.replace(
    /[（(]([1-4])[）)][ \t\n\r]*?(?=(?:([A-DＡ-Ｄ])[.．、:：)）]|[（(]([A-DＡ-Ｄ])[）)]))/g,
    (text, _number, _letter, _parenthesized, offset) =>
      removed.has(offset) ? "" : text,
  );
}
export function withChoices(stem: string, parts: string[]) {
  if (!parts.length || splitChoices(stem))
    return normalizeChoiceBody(cleanBody(stem));
  const choices = parts.map((part, i) => {
    const text = cleanTitle(part);
    return parts.length === 4
      ? `${String.fromCharCode(65 + i)}. ${text.replace(/^(?:[A-DＡ-Ｄ][.．、:：)）]|[（(][A-DＡ-Ｄ][）)])[ \t]*/, "")}`
      : text;
  });
  return normalizeChoiceBody(cleanBody([stem, ...choices].join("\n")));
}
export function splitChoices(body: string, allowEmpty = false) {
  body = normalizeChoiceBody(body);
  const ranges = formulaRanges(body);
  const labels = [
    ...body.matchAll(
      /(?<![A-Za-z0-9\\])(?:([A-DＡ-Ｄ])[.．、:：)）]|[（(]([A-DＡ-Ｄ])[）)])[ \t\n\r\f\v]*/g,
    ),
  ].filter((m) => !ranges.some((r) => m.index! >= r.start && m.index! < r.end));
  const label = (m: RegExpMatchArray) => {
    const c = (m[1] ?? m[2]).charCodeAt(0);
    return String.fromCharCode(c >= 0xff21 ? c - 0xff21 + 65 : c);
  };
  let group: RegExpMatchArray[] | undefined;
  for (let i = 0; i <= labels.length - 4; i++) {
    const row = labels.slice(i, i + 4);
    if (row.map(label).join("") === "ABCD") group = row;
  }
  if (!group) return null;
  const options = group.map((m, i) => ({
    label: label(m),
    value: trim(
      body.slice(m.index! + m[0].length, group![i + 1]?.index ?? body.length),
    ),
  }));
  return !allowEmpty && options.some((o) => !o.value)
    ? null
    : {
        stem: body
          .slice(0, group[0].index)
          .replace(/[\u0009-\u000d\u001c-\u0020\p{Z}]+$/u, ""),
        options,
      };
}
export function choiceRows(widths: number[]) {
  if (widths.length !== 4 || widths.some((x) => !Number.isFinite(x) || x < 0))
    throw Error("选项宽度无效");
  const natural = widths.map((x) => Math.ceil(x) + 6);
  let left = 0;
  if (natural.reduce((a, b) => a + b, 0) + 54 <= 515) {
    const gap = (515 - natural.reduce((a, b) => a + b, 0)) / 3;
    return [
      natural.map((width, index) => {
        const cell = {
          index,
          left,
          contentWidth: width,
          cellWidth: width + (index < 3 ? gap : 0),
        };
        left += cell.cellWidth;
        return cell;
      }),
    ];
  }
  return [0, 2].map((i) => [
    { index: i, left: 0, contentWidth: 248.5, cellWidth: 266.5 },
    { index: i + 1, left: 266.5, contentWidth: 248.5, cellWidth: 248.5 },
  ]);
}
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

// Remove paragraph step labels without changing decimals or inline mathematics.
export function readableSolution(text: string): string {
  return text.replace(/(^|\n[ \t]*\n)[ \t]*\d+[.、．](?!\d)[ \t]*/g, "$1");
}
