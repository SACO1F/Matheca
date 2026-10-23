import { describe, expect, it } from "vitest";
import { knowledgeOptions } from "../src/renderer/knowledge-options";
import { groups } from "../src/domain/catalog";

describe("knowledge assignment and filtering", () => {
  const custom = [{ id: "custom-function", name: "我的函数题", group: "函数" }];
  it("keeps the complete catalogue available for assignment", () => {
    const values = knowledgeOptions(custom).map((option) => option.value);
    expect(values).toContain("我的函数题");
    expect(values).toContain("集合的概念");
    expect(values.length).toBe(Object.values(groups).flat().length + 2);
  });
  it("filters using decoded aliases and custom points in stable catalogue order", () => {
    const options = knowledgeOptions(custom, [
      { knowledge: "我的函数题、二次函数、二次函数" },
      { knowledge: "集合的概念" },
    ]);
    expect(options.map((option) => option.value)).toEqual([
      "",
      "集合的概念",
      "函数的概念与性质",
      "我的函数题",
    ]);
    expect(options[3]).toMatchObject({ group: "函数" });
  });
  it("offers only all for an empty or unlabelled library and updates after removal", () => {
    expect(knowledgeOptions(custom, [])).toEqual([
      { value: "", label: "全部知识点" },
    ]);
    expect(knowledgeOptions(custom, [{ knowledge: "未知分类" }])).toHaveLength(
      1,
    );
    expect(
      knowledgeOptions(custom, [{ knowledge: "我的函数题" }]),
    ).toHaveLength(2);
    expect(knowledgeOptions(custom, [])).toHaveLength(1);
  });
});
