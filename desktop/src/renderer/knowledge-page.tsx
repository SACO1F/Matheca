import { useMemo, useState } from "react";
import { groups, decodeKnowledge } from "../domain/catalog";
import type { KnowledgePoint, Question } from "../shared/types";
import { GlideSelect } from "./glide-select";

export function KnowledgePage({
  custom,
  questions,
  group,
  name,
  onGroup,
  onName,
  onAdd,
  busy,
}: {
  custom: KnowledgePoint[];
  questions: Question[];
  group: string;
  name: string;
  onGroup: (group: string) => void;
  onName: (name: string) => void;
  onAdd: () => Promise<boolean | undefined>;
  busy: boolean;
}) {
  const [selected, setSelected] = useState(group);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const modules = useMemo(
    () =>
      Object.entries(groups).map(([title, points]) => ({
        title,
        points: [
          ...points.map((name) => ({ name, custom: false })),
          ...custom
            .filter((p) => p.group === title)
            .map((p) => ({ name: p.name, custom: true })),
        ],
      })),
    [custom],
  );
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    questions.forEach((q) =>
      decodeKnowledge(q.knowledge, custom).forEach((point) =>
        result.set(point, (result.get(point) ?? 0) + 1),
      ),
    );
    return result;
  }, [questions, custom]);
  const keyword = query.trim().toLocaleLowerCase();
  const visible = modules.flatMap((module) => {
    if (!keyword) return module.title === selected ? [module] : [];
    const points = module.points.filter((point) =>
      (module.title + point.name).toLocaleLowerCase().includes(keyword),
    );
    return points.length ? [{ ...module, points }] : [];
  });
  const total = modules.reduce((sum, m) => sum + m.points.length, 0);
  return (
    <section className="management-page knowledge-page" aria-label="知识点管理">
      <div className="management-toolbar">
        <p>
          {modules.length} 个模块 <span aria-hidden="true">·</span> {total}{" "}
          个知识点 <span aria-hidden="true">·</span> {custom.length} 个自定义
        </p>
        <div className="management-tools">
          <input
            type="search"
            aria-label="搜索知识点"
            placeholder="搜索模块或知识点"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="primary"
            aria-expanded={adding}
            aria-controls="knowledge-create"
            onClick={() => {
              setAdding(!adding);
              if (!adding) onGroup(selected);
            }}
          >
            添加知识点
          </button>
        </div>
      </div>
      <div className="knowledge-workbench">
        <nav className="knowledge-modules" aria-label="知识点模块">
          <div className="module-list-heading">
            知识模块 <span>{modules.length}</span>
          </div>
          {modules.map((module) => (
            <button
              key={module.title}
              aria-current={
                !keyword && selected === module.title ? "true" : undefined
              }
              onClick={() => {
                setSelected(module.title);
                setQuery("");
                onGroup(module.title);
              }}
            >
              <span>{module.title}</span>
              <span className="module-point-count">{module.points.length}</span>
            </button>
          ))}
        </nav>
        <div className="knowledge-detail">
          {adding && (
            <form
              id="knowledge-create"
              className="knowledge-create"
              onSubmit={async (e) => {
                e.preventDefault();
                if (name.trim() && !busy && (await onAdd())) {
                  setSelected(group);
                  setQuery("");
                }
              }}
            >
              <div className="knowledge-create-title">
                <h3>添加自定义知识点</h3>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setAdding(false)}
                >
                  收起
                </button>
              </div>
              <div className="knowledge-create-fields">
                <div className="field knowledge-field">
                  <span>所属模块</span>
                  <GlideSelect
                    label="所属模块"
                    value={group}
                    onChange={onGroup}
                    options={modules.map((m) => ({
                      value: m.title,
                      label: m.title,
                      group: "知识点总类",
                    }))}
                  />
                </div>
                <label className="field">
                  <span>知识点名称</span>
                  <input
                    maxLength={32}
                    value={name}
                    onChange={(e) => onName(e.target.value)}
                    placeholder="最多 32 个字符"
                  />
                </label>
                <button
                  className="primary"
                  type="submit"
                  disabled={busy || !name.trim()}
                >
                  确认添加
                </button>
              </div>
              <p>自定义知识点会随题库备份保存与转移。</p>
            </form>
          )}
          <div className="knowledge-detail-heading">
            <div>
              <h2>{keyword ? "搜索结果" : selected}</h2>
              <p>
                {keyword
                  ? `找到 ${visible.reduce((sum, m) => sum + m.points.length, 0)} 个知识点`
                  : "按知识点查看题库中的题目分布"}
              </p>
            </div>
            <span className="knowledge-column-label">题库题数</span>
          </div>
          {!visible.length && (
            <div className="management-empty">
              <h3>没有找到相关知识点</h3>
              <p>试试其他名称，或添加一个自定义知识点。</p>
              <button onClick={() => setQuery("")}>清空搜索</button>
            </div>
          )}
          {visible.map((module) => (
            <section
              className="knowledge-point-section"
              key={module.title}
              aria-label={module.title}
            >
              {keyword && <h3>{module.title}</h3>}
              <ul className="knowledge-point-list">
                {module.points.map((point) => (
                  <li key={point.name}>
                    <span className="knowledge-point-name">
                      {point.name}
                      {point.custom && (
                        <span className="point-origin">自定义</span>
                      )}
                    </span>
                    <span className="knowledge-question-count">
                      {counts.get(point.name) ?? 0}
                      <small> 道题</small>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
