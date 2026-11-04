import type { Store } from "./store";
const labels: Record<string, string> = {
  "deletion:undo": "撤销删除",
  "question:save": "保存题目",
  "question:undo-review": "撤销题目修改",
  "question:delete": "从题库删除题目",
  "question:crop": "提取题目图片",
  "library:examples": "添加示例题目",
  "collection:save": "保存题集设置",
  "collection:delete": "删除题集",
  "collection:add": "加入题集",
  "collection:add-undoable": "加入题集",
  "collection:undo-addition": "撤销加入题集",
  "collection:reorder": "调整题目顺序",
  "collection:remove": "从题集中移除题目",
  "knowledge:add": "添加知识点",
  "intake:choose": "导入图片或 PDF",
  "intake:capture": "截图导入题目",
  "intake:drop": "拖放导入题目",
  "intake:paste": "粘贴图片导入",
  "question:solve": "请求 AI 解题",
  "backup:inspect": "查看题库导入预览",
  "backup:restore": "导入题库备份",
  "backup:dismiss": "取消题库导入",
  "backup:export": "备份题库",
  "collection:preview": "生成导出预览",
  "collection:export": "导出题集",
};
const text = (value: unknown) =>
  typeof value === "string"
    ? value.replace(/[\u0000-\u001f]/g, " ").slice(0, 100)
    : "";
export function describeOperation(
  store: Store,
  channel: string,
  args: unknown[],
) {
  let title = labels[channel];
  if (!title) return undefined;
  const value = args[0];
  const obj =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : undefined;
  let detail = "";
  if (channel.startsWith("question:")) {
    const questionId = typeof value === "string" ? value : obj?.id;
    const old =
      typeof questionId === "string" ? store.question(questionId) : undefined;
    detail = text(old?.title || obj?.title || old?.body || obj?.body);
    if (channel === "question:save") {
      title =
        args[1] === true ? "确认题目已校对" : !old ? "创建题目" : "保存题目";
      if (args[1] !== true && old && obj?.favorite !== old.favorite)
        title = obj?.favorite ? "收藏题目" : "取消收藏题目";
    }
  } else if (channel.startsWith("collection:")) {
    const collectionId = typeof value === "string" ? value : obj?.id;
    const old =
      typeof collectionId === "string"
        ? store.collection(collectionId)
        : undefined;
    detail = text(old?.title || obj?.title);
    if (channel === "collection:save" && !old) title = "创建题集";
    if (channel === "collection:add" && Array.isArray(args[1]))
      detail += ` · 选择 ${args[1].length} 道题目`;
    if (channel === "collection:export")
      title = args[1] === "docx" ? "导出 Word" : "导出 PDF";
    if (channel === "collection:remove" && typeof args[1] === "string")
      detail += " · " + text(store.question(args[1])?.title);
  } else if (channel === "knowledge:add")
    detail = text(obj?.group) + " · " + text(obj?.name);
  return { title, detail };
}
