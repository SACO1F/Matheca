import type { KnowledgePoint, Question, Filter } from "../shared/types";
import { cleanBody, cleanTitle, trim } from "./math";
export const grades = ["高一", "高二", "高三"];
export const kinds = ["选择题", "填空题", "计算题", "解答题", "证明题"];
export const difficulties = ["基础", "进阶", "挑战"];
export const groups: Record<string, string[]> = {
  集合与逻辑: [
    "集合的概念",
    "集合的运算",
    "充分条件与必要条件",
    "全称量词与存在量词",
    "命题及其否定",
  ],
  不等式: ["不等式的性质", "一元二次不等式", "基本不等式"],
  函数: [
    "函数的概念与性质",
    "函数单调性",
    "函数奇偶性",
    "指数函数",
    "对数函数",
    "幂函数",
    "函数零点",
    "函数的应用",
  ],
  三角: [
    "任意角与弧度制",
    "三角函数定义",
    "同角三角函数关系",
    "诱导公式",
    "三角函数图像与性质",
    "三角恒等变换",
    "正弦定理与余弦定理",
    "解三角形",
  ],
  平面向量: ["平面向量概念", "平面向量运算", "向量数量积", "平面向量坐标运算"],
  复数: ["复数概念", "复数的运算"],
  立体几何: [
    "空间几何体",
    "空间点线面关系",
    "空间平行关系",
    "空间垂直关系",
    "空间向量",
    "空间角与距离",
    "体积与表面积",
  ],
  解析几何: [
    "直线的方程",
    "直线的位置关系",
    "圆的方程",
    "直线与圆",
    "椭圆",
    "双曲线",
    "抛物线",
    "直线与圆锥曲线",
  ],
  数列: ["等差数列", "等比数列", "数列通项", "数列求和"],
  导数: ["导数概念与运算", "导数与单调性", "导数与极值最值", "导数的综合应用"],
  计数原理: ["分类加法与分步乘法", "排列", "组合", "二项式定理"],
  概率统计: [
    "随机事件与概率",
    "古典概型",
    "条件概率",
    "独立事件",
    "离散型随机变量",
    "二项分布",
    "正态分布",
    "统计抽样",
    "统计估计",
    "相关关系与回归",
    "独立性检验",
  ],
  数学活动: ["数学建模", "数学探究"],
};
const aliases: Record<string, string> = {
  二次函数: "函数的概念与性质",
  概率: "随机事件与概率",
  导数: "导数概念与运算",
  三角函数: "三角函数图像与性质",
  平面向量: "平面向量概念",
  复数: "复数概念",
  数列: "数列通项",
};
export function allPoints(custom: KnowledgePoint[] = []) {
  return [...Object.values(groups).flat(), ...custom.map((p) => p.name)];
}
export function decodeKnowledge(value: string, custom: KnowledgePoint[] = []) {
  const allowed = new Set(allPoints(custom));
  return [
    ...new Set(
      value
        .split(/[、,，;；|\n]/)
        .map(trim)
        .map((x) => aliases[x] ?? x)
        .filter((x) => allowed.has(x)),
    ),
  ];
}
export function normalizeKnowledge(
  value: string,
  custom: KnowledgePoint[] = [],
) {
  return decodeKnowledge(value, custom).join("、");
}
export function validatePoint(
  point: KnowledgePoint,
  custom: KnowledgePoint[] = [],
): KnowledgePoint {
  const name = trim(point.name);
  if (!Object.hasOwn(groups, point.group)) throw Error("请选择高中数学模块");
  if (
    !name ||
    name.length > 32 ||
    /[\u0000-\u001f\u007f-\u009f、,，;；|]/.test(point.name)
  )
    throw Error("知识点名称须为 1–32 字，且不含控制字符或分隔符");
  if (allPoints(custom).includes(name) || Object.hasOwn(aliases, name))
    throw Error("这个知识点已存在");
  return { group: point.group, name };
}
export function normalizeQuestion(
  q: Question,
  custom: KnowledgePoint[] = [],
): Question {
  return {
    ...q,
    title: cleanTitle(q.title) || "新题目",
    body: cleanBody(q.body),
    grade: grades.includes(q.grade) ? q.grade : "",
    kind: kinds.includes(q.kind) ? q.kind : "解答题",
    difficulty: difficulties.includes(q.difficulty) ? q.difficulty : "待评估",
    knowledge: normalizeKnowledge(q.knowledge, custom),
  };
}
export function edited(
  saved: Question,
  draft: Question,
  custom: KnowledgePoint[] = [],
): Question {
  const a = normalizeQuestion(saved, custom),
    b = normalizeQuestion(draft, custom);
  return {
    ...b,
    reviewed:
      saved.reviewed &&
      JSON.stringify(a.figures ?? []) === JSON.stringify(b.figures ?? []) &&
      JSON.stringify(a.figurePlacements ?? []) ===
        JSON.stringify(b.figurePlacements ?? []) &&
      (
        ["title", "body", "grade", "kind", "difficulty", "knowledge"] as const
      ).every((k) => a[k] === b[k]),
  };
}
export function filterQuestion(
  q: Question,
  f: Filter,
  custom: KnowledgePoint[] = [],
): boolean {
  const points = decodeKnowledge(q.knowledge, custom);
  return (
    (!f.grade || q.grade === f.grade) &&
    (!f.kind || q.kind === f.kind) &&
    (!f.difficulty || q.difficulty === f.difficulty) &&
    (!f.knowledge || points.includes(f.knowledge)) &&
    (!f.favorite || q.favorite) &&
    (f.reviewed === "all" || q.reviewed === (f.reviewed === "reviewed")) &&
    (!trim(f.keyword) ||
      [q.title, q.body, q.latex, q.knowledge]
        .join("\n")
        .toLocaleLowerCase()
        .includes(trim(f.keyword).toLocaleLowerCase()))
  );
}
