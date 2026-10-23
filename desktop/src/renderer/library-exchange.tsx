import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { QuestionVisual, QuestionSource } from "./question-content";
import { NavIcon } from "./nav-icon";
import {
  decodeKnowledge,
  filterQuestion,
  grades,
  difficulties,
  kinds,
} from "../domain/catalog";
import { GlideSelect } from "./glide-select";
import { knowledgeOptions } from "./knowledge-options";
import type {
  ExchangePreview,
  ExchangePolicy,
  MobileImportState,
  State,
} from "../shared/types";

export function LibraryExchangePanel({
  state,
  busy,
  action,
  refresh,
  footerHost,
}: {
  state?: MobileImportState;
  busy: boolean;
  action: (fn: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  footerHost?: HTMLElement | null;
}) {
  const [library, setLibrary] = useState<State>();
  const [questions, setQuestions] = useState<string[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [preview, setPreview] = useState<ExchangePreview>();
  const [policy, setPolicy] = useState<ExchangePolicy>("keep");
  const [result, setResult] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [questionLimit, setQuestionLimit] = useState(100);
  const [collectionLimit, setCollectionLimit] = useState(100);
  const [questionFilter, setQuestionFilter] = useState({
    grade: "",
    difficulty: "",
    knowledge: "",
    kind: "",
  });
  const filteredQuestions = useMemo(
    () =>
      library?.questions.filter((q) =>
        filterQuestion(
          q,
          { ...questionFilter, keyword: "", reviewed: "all", favorite: false },
          library.customKnowledge,
        ),
      ) ?? [],
    [library, questionFilter],
  );
  const filterActive = Object.values(questionFilter).some(Boolean);
  const filterQuestions = (patch: Partial<typeof questionFilter>) => {
    setQuestionFilter((value) => ({ ...value, ...patch }));
    setQuestionLimit(100);
  };
  const dropdownHost = footerHost?.closest("dialog");

  useEffect(() => {
    void action(async () => setLibrary(await window.matheca.state()));
  }, []);
  const toggle = (
    id: string,
    values: string[],
    setter: (values: string[]) => void,
  ) =>
    setter(
      values.includes(id) ? values.filter((v) => v !== id) : [...values, id],
    );
  const sendAction = (
    <div className="exchange-send-footer">
      <span aria-live="polite">
        已选 {questions.length} 道题 · {collections.length} 个题集
      </span>
      <button
        className="primary"
        disabled={
          busy ||
          state?.status !== "receiving" ||
          (!questions.length && !collections.length)
        }
        onClick={() =>
          void action(async () => {
            await window.matheca.mobileSendLibrary({
              questionIds: questions,
              collectionIds: collections,
              changedOnly,
            });
            await refresh();
            setResult("资料已准备好，请在 Android 的“接收题库”中下载。");
          })
        }
      >
        发送所选资料到手机
      </button>
    </div>
  );
  return (
    <>
      <h3>题库交换</h3>
      <p className="hint">
        Android 在“我的 → 连接电脑”扫码。两端使用桌面题库 ZIP
        格式，包含原图、插图、题集顺序及排版设置。接收不会调用 AI。
      </p>
      {result && (
        <p role="status" className="hint">
          {result}
        </p>
      )}
      <h4>手机发来的资料</h4>
      {!state?.libraries.some((i) => i.status === "received") && (
        <p className="hint">
          暂无待接收资料。手机发送后会出现在这里，关闭应用后仍保留。
        </p>
      )}
      {state?.libraries
        .filter((i) => i.status === "received")
        .map((item) => (
          <article className="mobile-activity" key={item.id}>
            <strong>{item.name}</strong>
            <p>
              {(item.size / 1024 / 1024).toFixed(1)} MB ·{" "}
              {new Date(item.receivedAt).toLocaleString("zh-CN")}
            </p>
            <div className="button-row">
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    setPreview(
                      await window.matheca.mobileInspectLibrary(item.id),
                    );
                    setPolicy("keep");
                  })
                }
              >
                预览并接收
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await window.matheca.mobileDiscardLibrary(item.id);
                    if (preview?.id === item.id) setPreview(undefined);
                    await refresh();
                  })
                }
              >
                移除资料
              </button>
            </div>
          </article>
        ))}
      {preview && (
        <section className="exchange-preview" aria-label="资料接收预览">
          <h4>接收预览</h4>
          <p>
            {preview.questions} 道题 · {preview.collections} 个题集
          </p>
          <p>
            新增 {preview.added} · 重复 {preview.repeated} · 冲突{" "}
            {preview.conflicts}
          </p>
          {preview.missingImages > 0 && (
            <p className="hint">
              {preview.missingImages} 道题缺少原图，文字与其他数据仍保留。
            </p>
          )}
          <p className="hint">
            同编号且内容不同视为冲突。本阶段不自动判断哪一端更新，不传播删除。
          </p>
          <label className="field">
            <span>冲突处理方式</span>
            <select
              value={policy}
              onChange={(e) => setPolicy(e.target.value as ExchangePolicy)}
              disabled={busy}
            >
              <option value="keep">保留本机版本</option>
              <option value="replace">使用收到的版本</option>
              <option value="copy">冲突另存为新题／题集</option>
            </select>
          </label>
          <div className="exchange-details">
            {preview.details.slice(0, 100).map((i) => (
              <p key={i.kind + i.id}>
                {i.title} ·{" "}
                {i.status === "new"
                  ? "新增"
                  : i.status === "same"
                    ? "重复"
                    : "冲突"}
              </p>
            ))}
          </div>
          <div className="button-row">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await window.matheca.mobileApplyLibrary(preview.id, policy);
                  setPreview(undefined);
                  setLibrary(await window.matheca.state());
                  await refresh();
                  setResult("资料已接收，未触发识别或解题。");
                })
              }
            >
              确认接收资料
            </button>
            <button disabled={busy} onClick={() => setPreview(undefined)}>
              取消预览
            </button>
          </div>
        </section>
      )}
      <h4>发送题目与题集到手机</h4>
      <label className="field">
        <span>发送范围</span>
        <select
          aria-label="发送范围"
          value={changedOnly ? "changed" : "all"}
          disabled={busy}
          onChange={(e) => setChangedOnly(e.target.value === "changed")}
        >
          <option value="all">发送全部所选资料</option>
          <option value="changed">仅发送与手机不同的资料</option>
        </select>
      </label>
      {changedOnly && (
        <p className="hint">
          先在手机点击“检查连接”。内容相同的题目和题集跳过；题集结构变化时包含全部关联题目。删除不会传播，冲突仍由接收端确认。
        </p>
      )}
      <p className="hint">
        勾选题集时包含其全部题目。每份最多 512
        MB；手机在“接收题库”下载校验、预览并确认。
      </p>
      <details className="exchange-select">
        <summary>选择题集（{collections.length}）</summary>
        {library?.collections.slice(0, collectionLimit).map((c) => (
          <label
            key={c.id}
            className={
              "collection-card exchange-collection" +
              (collections.includes(c.id) ? " active" : "")
            }
          >
            <span className="collection-icon" aria-hidden="true">
              <NavIcon name="folder-open" />
            </span>
            <span className="collection-row-copy">
              <span className="collection-row-title">{c.title}</span>
              <span className="collection-row-count">
                {library?.items.filter((i) => i.collectionId === c.id).length ||
                  0}{" "}
                道题目
              </span>
            </span>
            <input
              aria-label={c.title}
              type="checkbox"
              checked={collections.includes(c.id)}
              disabled={busy}
              onChange={() => toggle(c.id, collections, setCollections)}
            />
          </label>
        ))}
        {!library?.collections.length && <p className="hint">暂无题集</p>}
        {!!library && library.collections.length > collectionLimit && (
          <button
            disabled={busy}
            onClick={() => setCollectionLimit((n) => n + 100)}
          >
            显示更多题集（{collectionLimit}/{library.collections.length}）
          </button>
        )}
      </details>
      <details className="exchange-select">
        <summary>选择题目（{questions.length}）</summary>
        <div
          className="library-filters exchange-question-filters"
          aria-label="交换题目筛选条件"
        >
          <GlideSelect
            label="年级"
            value={questionFilter.grade}
            onChange={(grade) => filterQuestions({ grade })}
            options={[
              { value: "", label: "全部年级" },
              ...grades.map((value) => ({ value, label: value })),
            ]}
            portalHost={dropdownHost}
          />
          <GlideSelect
            label="难度"
            value={questionFilter.difficulty}
            onChange={(difficulty) => filterQuestions({ difficulty })}
            options={[
              { value: "", label: "全部难度" },
              ...["待评估", ...difficulties].map((value) => ({
                value,
                label: value,
              })),
            ]}
            portalHost={dropdownHost}
          />
          <GlideSelect
            label="知识点"
            value={questionFilter.knowledge}
            onChange={(knowledge) => filterQuestions({ knowledge })}
            options={knowledgeOptions(
              library?.customKnowledge ?? [],
              library?.questions ?? [],
            )}
            portalHost={dropdownHost}
          />
          <GlideSelect
            label="题型"
            value={questionFilter.kind}
            onChange={(kind) => filterQuestions({ kind })}
            options={[
              { value: "", label: "全部题型" },
              ...kinds.map((value) => ({ value, label: value })),
            ]}
            portalHost={dropdownHost}
          />
        </div>
        <div className="exchange-filter-summary">
          <span aria-live="polite">
            显示 {filteredQuestions.length} / {library?.questions.length ?? 0}{" "}
            道题
          </span>
          <button
            disabled={!filterActive}
            onClick={() => {
              setQuestionFilter({
                grade: "",
                difficulty: "",
                knowledge: "",
                kind: "",
              });
              setQuestionLimit(100);
            }}
          >
            清除筛选
          </button>
        </div>
        {filteredQuestions.slice(0, questionLimit).map((q, index) => (
          <article
            key={q.id}
            data-question-id={q.id}
            className={
              "question-card exchange-question" +
              (questions.includes(q.id) ? " active" : "")
            }
            onClick={(e) => {
              if (
                !busy &&
                !(
                  e.target instanceof Element &&
                  e.target.closest(".exchange-check")
                )
              )
                toggle(q.id, questions, setQuestions);
            }}
          >
            <div className="card-top">
              <div className="tags">
                {q.grade && <span className="tag blue">{q.grade}</span>}
                <span className="tag">{q.difficulty}</span>
                {decodeKnowledge(
                  q.knowledge,
                  library?.customKnowledge ?? [],
                ).map((point) => (
                  <span key={point} className="tag purple">
                    {point}
                  </span>
                ))}
              </div>
              <label className="exchange-check">
                <input
                  aria-label={q.title}
                  type="checkbox"
                  checked={questions.includes(q.id)}
                  disabled={busy}
                  onChange={() => toggle(q.id, questions, setQuestions)}
                />
              </label>
            </div>
            <div className="card-preview">
              <span className="question-number" aria-hidden="true">
                {index + 1}.
              </span>
              <QuestionVisual question={q} lazy />
            </div>
            <QuestionSource question={q} />
            <div className="card-footer">
              <span className="card-meta">
                {q.kind} · {q.reviewed ? "已校对" : "待校对"}
              </span>
            </div>
          </article>
        ))}
        {!filteredQuestions.length && (
          <p className="hint">
            {library?.questions.length
              ? "没有符合条件的题目，请调整或清除筛选。"
              : "暂无题目"}
          </p>
        )}
        {filteredQuestions.length > questionLimit && (
          <button
            disabled={busy}
            onClick={() => setQuestionLimit((n) => n + 100)}
          >
            显示更多题目（{questionLimit}/{filteredQuestions.length}）
          </button>
        )}
      </details>
      {footerHost ? createPortal(sendAction, footerHost) : sendAction}
      <p className="hint">
        需要手动互导时，两端设置中的题库 ZIP
        导出／导入使用同一桌面格式。普通备份导入默认保留本机版本。
      </p>
    </>
  );
}
