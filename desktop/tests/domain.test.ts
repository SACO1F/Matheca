import {
  validateFigures,
  validateFigureWidths,
  figureDimensions,
  validateFigurePlacements,
  questionContent,
} from "../src/domain/figures";
import { describe, it, expect } from "vitest";
import {
  cleanBody,
  cleanTitle,
  parseMath,
  readableSolution,
  splitChoices,
  normalizeChoiceBody,
  withChoices,
  choiceRows,
  toLatex,
  trim,
  withSubquestions,
} from "../src/domain/math";
import {
  groups,
  allPoints,
  validatePoint,
  normalizeKnowledge,
  edited,
  filterQuestion,
} from "../src/domain/catalog";
import { newQuestion, newCollection } from "../src/shared/types";
import {
  encodeBackup,
  decodeBackup,
  type BackupData,
} from "../src/domain/backup";
import {
  endpoint,
  completion,
  decodeDrafts,
  decodeSolution,
  decodePagedDrafts,
} from "../src/domain/vision";
import { fingerprint, kotlinUtf8 } from "../src/main/fingerprint";
const q = {
  ...newQuestion("q"),
  title: "函数练习",
  body: "求函数 \\(f(x)=x^2\\) 的值。",
  grade: "高一",
  difficulty: "基础",
  knowledge: "函数单调性",
  reviewed: true,
};
export const data = (): BackupData => ({
  questions: [q],
  collections: [newCollection("c", "练习")],
  items: [{ collectionId: "c", questionId: "q", position: 3 }],
  customKnowledge: [{ group: "函数", name: "图像平移" }],
  sources: {},
  currentSolutions: [],
  missingSources: 0,
});
describe("Kotlin domain compatibility", () => {
  it("preserves numbering, decimals and options", () => {
    expect(
      cleanBody(
        "12. 已知函数。\n（1）求最值。\n(2) 求定义域。\n③证明结论。\n0.5 是系数。\n(0,1) 是区间。\nA. 1.25\nB. 2",
      ),
    ).toBe(
      "已知函数。\n（1）求最值。\n（2）求定义域。\n（3）证明结论。\n0.5 是系数。\n(0,1) 是区间。\nA. 1.25\nB. 2",
    );
    expect(cleanBody("第 15 题：（1）求通项")).toBe("求通项");
    expect(cleanBody("(1)+x=2")).toBe("(1)+x=2");
  });
  it("keeps math delimiter families and escaped dollar", () => {
    expect(
      parseMath("已知 \\(x=1\\)，\\[x^2\\]，$a_n$，$$S_n$$")
        .filter((p) => p.type === "formula")
        .map((p) => p.type === "formula" && p.display),
    ).toEqual([false, true, false, true]);
    expect(parseMath("价格为 \\$5，待校对 $")).toEqual([
      { type: "text", value: "价格为 \\$5，待校对 $" },
    ]);
  });
  it("converts legacy math while preserving ordinary counts", () => {
    const p = parseMath("已知 f(x) = x² − 4x + 3，首项 a₁=2，求前 10 项和。");
    expect(
      p
        .filter((x) => x.type === "formula")
        .map((x) => x.type === "formula" && x.latex),
    ).toEqual(["f(x) = x^{2} - 4x + 3", "a_{1}=2"]);
    expect(p.some((x) => x.type === "text" && x.value.includes("10 项"))).toBe(
      true,
    );
    expect(toLatex("a₁₂+x²³≤π")).toBe("a_{12}+x^{23}\\le \\pi ");
  });
  it("preserves UTF16 and Kotlin whitespace", () => {
    expect(trim("\u00a0题\u00a0")).toBe("题");
    expect(trim("\ufeff题\ufeff")).toBe("\ufeff题\ufeff");
    expect(cleanTitle("2. 中文😀")).toBe("中文😀");
    expect(kotlinUtf8("\ud800").toString()).toBe("?");
    expect(kotlinUtf8("😀").toString()).toBe("😀");
  });
  it("supports CRLF and subquestions without duplicate numbers", () => {
    expect(cleanBody("题干\r\n（1）求值\r\n（3）证明")).toBe(
      "题干\n（1）求值\n（2）证明",
    );
    expect(withSubquestions("题干", ["（4）求值", "证明结论"])).toBe(
      "题干\n（1）求值\n（2）证明结论",
    );
  });
  it.each([
    "title",
    "body",
    "grade",
    "kind",
    "difficulty",
    "knowledge",
  ] as const)("invalidates review on %s", (key) => {
    expect(
      edited(q, {
        ...q,
        [key]:
          (
            {
              grade: "高二",
              kind: "选择题",
              difficulty: "挑战",
              knowledge: "数列求和",
            } as any
          )[key] ?? "修改",
      }).reviewed,
    ).toBe(false);
  });
  it.each([
    { latex: "x^2" },
    { favorite: true },
    { autoSolve: true },
    { solution: "AI" },
    { title: "1. 函数练习" },
  ])("preserves review for auxiliary %j", (patch) => {
    expect(edited(q, { ...q, ...patch }).reviewed).toBe(true);
  });
  it("does not let draft confirm itself", () =>
    expect(
      edited({ ...q, reviewed: false }, { ...q, reviewed: true }).reviewed,
    ).toBe(false));
  it("fingerprints exclude classification but include scratch latex and exact path", () => {
    expect(fingerprint(q)).toBe(fingerprint({ ...q, grade: "高二" }));
    expect(fingerprint(q)).not.toBe(fingerprint({ ...q, latex: "x" }));
    expect(fingerprint({ ...q, sourcePath: "C:\\中文" })).not.toBe(
      fingerprint({ ...q, sourcePath: "C:/中文" }),
    );
  });
  it("matches the complete existing taxonomy", () => {
    expect(Object.keys(groups)).toHaveLength(13);
    expect(allPoints()).toHaveLength(70);
    expect(normalizeKnowledge("概率、随机事件与概率、未注册")).toBe(
      "随机事件与概率",
    );
  });
  it.each([
    "",
    "对数函数",
    "二次函数",
    "a、b",
    "a,b",
    "a|b",
    "a\nb",
    "a\tb",
    "x".repeat(33),
  ])("rejects invalid custom point %s", (name) =>
    expect(() => validatePoint({ group: "函数", name })).toThrow(),
  );
  it("rejects same custom name across different groups", () =>
    expect(() =>
      validatePoint({ group: "三角", name: "平移" }, [
        { group: "函数", name: "平移" },
      ]),
    ).toThrow());
  it("ignores choice labels inside LaTeX and accepts full width", () => {
    expect(
      splitChoices(
        "已知 \\(\\text{A. B. C. D.}\\)。\nA. 一\nB. 二\nC. 三\nD. 四",
      )?.stem,
    ).toContain("\\text{A. B. C. D.}");
    expect(
      splitChoices(
        "选出正确值。\n（Ａ）0.5\n(B) -1\nＣ、(0,1)\nD：2",
      )?.options.map((p) => p.value),
    ).toEqual(["0.5", "-1", "(0,1)", "2"]);
    expect(splitChoices("A. 一 B. 二 D. 四")).toBeNull();
  });
  it("removes redundant choice subquestion numbers while keeping mathematical values", () => {
    const body =
      "求值。\n（1）A. \\(f(1)=1\\)\n（2）B. (1)\n（3）C. (0,1)\n（4）D. 4";
    expect(splitChoices(body)).toEqual({
      stem: "求值。",
      options: [
        { label: "A", value: "\\(f(1)=1\\)" },
        { label: "B", value: "(1)" },
        { label: "C", value: "(0,1)" },
        { label: "D", value: "4" },
      ],
    });
    expect(normalizeChoiceBody("（1）A. 仅一项")).toBe("（1）A. 仅一项");
    const formula = "\\(\\text{(1)A. (2)B. (3)C. (4)D.}\\)";
    expect(normalizeChoiceBody(formula)).toBe(formula);
  });
  it("recognizes options supplied as subquestions without numeric labels", () => {
    for (const parts of [
      ["A. 一", "B. 二", "C. 三", "D. 四"],
      ["一", "二", "三", "四"],
    ]) {
      const body = withChoices("请选择。", parts);
      expect(body).toBe("请选择。\nA. 一\nB. 二\nC. 三\nD. 四");
      expect(
        decodeDrafts(
          JSON.stringify({
            questions: [
              { body: "请选择。", kind: "选择题", subquestions: parts },
            ],
          }),
        )[0].body,
      ).toBe(body);
    }
  });
  it("uses identical width policy for one and two row options", () => {
    expect(choiceRows([370, 20, 20, 20])).toHaveLength(1);
    expect(
      choiceRows([180, 170, 185, 190]).map((r) => r.map((c) => c.index)),
    ).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(() => choiceRows([NaN, 1, 2, 3])).toThrow();
  });
});
describe("ZIP v1 manifest compatibility", () => {
  it("reads both Matheca and legacy Mathector backup names", () => {
    const text = encodeBackup(data());
    expect(text).toContain("MathecaLibraryBackup");
    expect(
      decodeBackup(
        text.replace("MathecaLibraryBackup", "MathectorLibraryBackup"),
      ).questions,
    ).toEqual(decodeBackup(text).questions);
  });
  it.each([
    "9007199254740993",
    "9223372036854775807",
    "-9223372036854775808",
    Date.now().toString(),
  ])("preserves Long %s", (createdAt) => {
    const d = data();
    d.questions[0] = { ...q, createdAt };
    const text = encodeBackup(d);
    expect(decodeBackup(text).questions[0].createdAt).toBe(createdAt);
    expect(text).toContain('"createdAt":' + createdAt);
  });
  it("does not leak local paths, API preferences or answer fingerprint", () => {
    const text = encodeBackup(data());
    expect(text).not.toContain("sourcePath");
    expect(text).not.toContain("solutionFingerprint");
    expect(text).not.toContain("apiKey");
    expect(decodeBackup(text).items[0].position).toBe(3);
  });
  it.each([
    ['"version":1', '"version":2'],
    ['"reviewed":true', '"reviewed":"true"'],
    ['"favorite":false', '"favorite":0'],
    ['"position":3', '"position":3.0'],
    ['"position":3', '"position":-1'],
  ])("rejects invalid type/version %s", (from, to) =>
    expect(() =>
      decodeBackup(encodeBackup(data()).replace(from, to)),
    ).toThrow(),
  );
  it("rejects duplicate IDs and dangling references", () => {
    const d = data();
    d.questions.push(q);
    expect(() => encodeBackup(d)).toThrow();
    d.questions.pop();
    d.items[0].questionId = "absent";
    expect(() => encodeBackup(d)).toThrow();
  });
  it("rejects invalid original-image path", () => {
    const text = encodeBackup(data()).replace(
      '"sourceEntry":""',
      '"sourceEntry":"../secret"',
    );
    expect(() => decodeBackup(text)).toThrow();
  });
});
describe("Vision contract", () => {
  it.each([
    ["https://example.invalid", "https://example.invalid/v1/chat/completions"],
    [
      "https://example.invalid/v1/",
      "https://example.invalid/v1/chat/completions",
    ],
    [
      "https://example.invalid/custom",
      "https://example.invalid/custom/chat/completions",
    ],
    [
      "https://example.invalid/chat/completions",
      "https://example.invalid/chat/completions",
    ],
  ])("normalizes %s", (value, want) => expect(endpoint(value)).toBe(want));
  it.each([
    "http://example.invalid",
    "https://u:p@example.invalid",
    "https://example.invalid?",
    "https://example.invalid#",
  ])("rejects unsafe endpoint %s", (v) => expect(() => endpoint(v)).toThrow());
  it("rejects truncation and refusal", () => {
    expect(() =>
      completion(
        '{"choices":[{"finish_reason":"length","message":{"content":"{}"}}]}',
      ),
    ).toThrow();
    expect(() =>
      completion('{"choices":[{"message":{"refusal":"no","content":"{}"}}]}'),
    ).toThrow();
  });
  it("preserves complete subquestions and constrained categories", () => {
    const result = decodeDrafts(
      JSON.stringify({
        questions: [
          {
            body: "已知函数。",
            subquestions: ["求值", "证明结论"],
            grade: "初一",
            knowledgePoints: ["概率", "函数单调性", "不存在"],
          },
        ],
      }),
    )[0];
    expect(result.body).toBe("已知函数。\n（1）求值\n（2）证明结论");
    expect(result.grade).toBe("");
    expect(result.knowledge).toBe("随机事件与概率、函数单调性");
  });
  it.each(["基础", "进阶", "挑战", "待评估", "困难", undefined])(
    "validates model difficulty %s and retains pending assessment for unsupported values",
    (difficulty) => {
      const draft = decodeDrafts(
        JSON.stringify({ questions: [{ body: "求函数的值域", difficulty }] }),
      )[0];
      expect(draft.difficulty).toBe(
        ["基础", "进阶", "挑战"].includes(difficulty ?? "")
          ? difficulty
          : "待评估",
      );
    },
  );
  it("rejects empty and malformed extraction and solution", () => {
    expect(() => decodeDrafts('{"questions":[]}')).toThrow();
    expect(() => decodeSolution('{"answer":"x","steps":[]}')).toThrow();
    expect(
      decodeSolution('```json\n{"answer":"1","steps":["计算得 1"]}\n```')
        .solution,
    ).toBe("答案：1\n\n计算得 1");
  });
  it("maps AI scores consistently in recognition and solutions without replacing missing assessments", () => {
    for (const [score, difficulty] of [
      [1, "基础"],
      [2, "进阶"],
      [3, "挑战"],
    ] as const) {
      expect(
        decodeDrafts(
          JSON.stringify({
            questions: [
              { body: "求值", difficultyScore: score, difficulty: "基础" },
            ],
          }),
        )[0].difficulty,
      ).toBe(difficulty);
      expect(
        decodeSolution(
          JSON.stringify({
            answer: "1",
            steps: ["计算"],
            difficultyScore: score,
          }),
        ).difficulty,
      ).toBe(difficulty);
    }
    for (const score of [0, 4, 1.5, "2"]) {
      expect(
        decodeDrafts(
          JSON.stringify({
            questions: [
              { body: "求值", difficultyScore: score, difficulty: "基础" },
            ],
          }),
        )[0].difficulty,
      ).toBe("待评估");
      expect(
        decodeSolution(
          JSON.stringify({
            answer: "1",
            steps: ["计算"],
            difficultyScore: score,
          }),
        ).difficulty,
      ).toBeUndefined();
    }
  });
});

it("keeps decimals while removing AI step labels", () => {
  expect(
    decodeSolution(
      JSON.stringify({
        answer: "1.2",
        steps: ["1. 取 x = 1.2", "2. 计算得到结果", "1.2 是小数"],
      }),
    ).solution,
  ).toBe("答案：1.2\n\n取 x = 1.2\n\n计算得到结果\n\n1.2 是小数");
});

it("reads existing numbered solution paragraphs without changing inline numbers", () => {
  expect(
    readableSolution(
      "答案：1.2\n\n1. 取 x = 1.2\n\n2. 得到结论（保留小题 1.、2.）",
    ),
  ).toBe("答案：1.2\n\n取 x = 1.2\n\n得到结论（保留小题 1.、2.）");
});

it("validates embedded figures and rejects external or oversized payloads", () => {
  const image = "data:image/png;base64,iVBORw0KGgo=";
  expect(validateFigures([image])).toEqual([image]);
  expect(() => validateFigures(["https://example.com/image.png"])).toThrow();
  expect(() => validateFigures(Array(7).fill(image))).toThrow();
});

it("validates printable widths and preserves image proportions within A4", () => {
  expect(validateFigureWidths(undefined, 2)).toBeUndefined();
  expect(validateFigureWidths([0, 120], 2)).toEqual([0, 120]);
  for (const invalid of [[10], [161], [NaN], [Infinity], ["80"], []])
    expect(() => validateFigureWidths(invalid, 1)).toThrow();
  const size = figureDimensions(400, 200, 100);
  expect(size.width).toBeCloseTo((100 * 96) / 25.4);
  expect(size.width / size.height).toBe(2);
  const tall = figureDimensions(100, 2000, 160);
  expect(tall.height).toBe(900);
  expect(tall.width / tall.height).toBe(0.05);
});
it("places pure image and mixed choices without duplicating stem figures", () => {
  const q = {
    kind: "选择题",
    body: "选择正确图象。",
    figures: ["s", "a", "b", "c", "d"],
    figurePlacements: validateFigurePlacements(["stem", "A", "B", "C", "D"], 5),
  };
  expect(questionContent(q)).toMatchObject({
    stem: q.body,
    stemFigures: [0],
    options: [
      { label: "A", value: "", figures: [1] },
      { label: "B", figures: [2] },
      { label: "C", figures: [3] },
      { label: "D", figures: [4] },
    ],
  });
  expect(
    questionContent({ ...q, body: "选择图象。 A. B. 文字 C. D." }).options.map(
      (o) => o.value,
    ),
  ).toEqual(["", "文字", "", ""]);
  expect(questionContent({ ...q, kind: "解答题" }).stemFigures).toEqual([
    0, 1, 2, 3, 4,
  ]);
  expect(
    questionContent({ ...q, figurePlacements: undefined }).options,
  ).toEqual([]);
  expect(validateFigurePlacements(undefined, 4)).toBeUndefined();
  for (const invalid of [["E"], ["A", "B"], "A", [null]])
    expect(() => validateFigurePlacements(invalid, 1)).toThrow();
});
it("decodes complete cross-page questions only on their starting page", () => {
  const make = (startPage: number, endPage: number) => ({
    body: "完整题干",
    startPage,
    endPage,
    complete: true,
  });
  const content = JSON.stringify({
    questions: [make(1, 3), make(3, 3)],
    needMorePages: false,
  });
  expect(decodePagedDrafts(content, 1, 1, 3).drafts).toHaveLength(1);
  expect(decodePagedDrafts(content, 2, 1, 3).drafts).toHaveLength(0);
  expect(decodePagedDrafts(content, 3, 1, 3).drafts[0].startPage).toBe(3);
  expect(
    decodePagedDrafts('{"questions":[],"needMorePages":false}', 2, 1, 3).drafts,
  ).toEqual([]);
  expect(
    decodePagedDrafts('{"questions":[],"needMorePages":true}', 1, 1, 2)
      .needMorePages,
  ).toBe(true);
  for (const q of [
    make(0, 1),
    make(1, 4),
    make(2, 1),
    { ...make(1, 2), complete: false },
    { body: "半道题" },
  ])
    expect(() =>
      decodePagedDrafts(
        JSON.stringify({ questions: [q], needMorePages: false }),
        1,
        1,
        3,
      ),
    ).toThrow();
  expect(() => decodePagedDrafts('{"questions":[]}', 1, 1, 2)).toThrow();
});
