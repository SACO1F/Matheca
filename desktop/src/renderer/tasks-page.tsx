import { useState, type ReactNode } from "react";
import type { ImportJob, Question } from "../shared/types";
import LatticeLoader from "./lattice-loader";

const filters = ["全部", "进行中", "待处理", "已完成"] as const;
function category(job: ImportJob) {
  return job.status === "processing" || job.status === "queued"
    ? "进行中"
    : job.status === "complete"
      ? "已完成"
      : "待处理";
}
function taskDate(value: string) {
  const date = new Date(/^\d+$/.test(value) ? Number(value) : value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
}
export function TasksPage({
  jobs,
  busy,
  onCancel,
  onResume,
  questions,
  onOpenQuestion,
  renderMath,
}: {
  jobs: ImportJob[];
  busy: boolean;
  onCancel: (id: string) => void;
  onResume: (id: string) => void;
  questions: Question[];
  onOpenQuestion: (question: Question) => void;
  renderMath: (text: string) => ReactNode;
}) {
  const [filter, setFilter] = useState<(typeof filters)[number]>("全部");
  const visible = jobs.filter(
    (j) => filter === "全部" || category(j) === filter,
  );
  return (
    <section className="management-page tasks-page" aria-label="识别与解题任务">
      <div className="management-toolbar">
        <div className="management-tabs" role="group" aria-label="筛选任务状态">
          {filters.map((value) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value}
              <span>
                {value === "全部"
                  ? jobs.length
                  : jobs.filter((j) => category(j) === value).length}
              </span>
            </button>
          ))}
        </div>
        <p className="task-resume-hint">进度自动保存，未完成任务可继续</p>
      </div>
      <div className="task-list" aria-live="off">
        {!visible.length && (
          <div className="management-empty">
            <h3>{jobs.length ? "暂无此类任务" : "暂无识别与解题任务"}</h3>
            <p>
              {jobs.length
                ? "切换其他状态，查看识别和解题记录。"
                : "导入图片、PDF 或发起 AI 解题后，可在这里查看进度和结果。"}
            </p>
            {jobs.length > 0 && (
              <button onClick={() => setFilter("全部")}>查看全部任务</button>
            )}
          </div>
        )}
        {visible.map((j) => {
          const ids = new Set(
            j.type === "import"
              ? j.questionIds
              : j.status === "complete" && j.questionId
                ? [j.questionId]
                : [],
          );
          const results = questions.filter((question) => ids.has(question.id));
          const progress =
            j.total > 0
              ? Math.min(100, Math.max(0, (j.completed / j.total) * 100))
              : 0;
          return (
            <article
              className="job-card"
              key={j.id}
              data-job-id={j.id}
              data-job-status={j.status}
            >
              <div className="job-content">
                <div className="job-heading">
                  <h3>{j.type === "import" ? "题目识别" : "AI 解题"}</h3>
                  <time>{taskDate(j.createdAt)}</time>
                  {j.type === "import" && (
                    <strong className="job-result-count">
                      已识别 {j.recognizedCount ?? 0} 道题
                    </strong>
                  )}
                </div>
                {j.type === "import" ? (
                  <ul className="job-files" aria-label="识别来源文件">
                    {j.sourceFiles?.length ? (
                      j.sourceFiles.map((file, index) => (
                        <li key={index}>
                          <span className="job-file-name">{file.name}</span>
                          <span className="job-file-count">
                            {file.completedPages} 页已识别 ·{" "}
                            {file.recognizedCount} 道题
                          </span>
                        </li>
                      ))
                    ) : (
                      <li>旧任务未记录来源文件</li>
                    )}
                  </ul>
                ) : (
                  <div className="job-details">
                    <div
                      className="job-question-preview"
                      aria-label="解题对应题目"
                    >
                      {renderMath(
                        j.questionPreview || "原题已删除，旧任务未保存题干摘要",
                      )}
                    </div>
                    {j.questionSource && (
                      <div className="job-question-source">
                        来源：{j.questionSource}
                      </div>
                    )}
                  </div>
                )}
                <p className="job-message">{j.message}</p>
                {results.length === 1 && (
                  <button
                    className="task-result-button"
                    onClick={() => onOpenQuestion(results[0])}
                  >
                    查看题目
                  </button>
                )}
                {results.length > 1 && (
                  <details className="task-results">
                    <summary>查看识别题目（{results.length} 道）</summary>
                    <ol>
                      {results.map((question) => (
                        <li key={question.id}>
                          <button onClick={() => onOpenQuestion(question)}>
                            {question.body.slice(0, 100) || "未填写题干"}
                          </button>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>
              <div className="job-status-column">
                <LatticeLoader
                  status={
                    j.status === "processing"
                      ? "working"
                      : j.status === "complete"
                        ? "done"
                        : j.status === "failed" || j.status === "partial"
                          ? "error"
                          : "idle"
                  }
                  label={
                    j.status === "processing"
                      ? j.type === "import"
                        ? "正在识别"
                        : "正在解题"
                      : j.status === "queued"
                        ? "排队中"
                        : "等待继续"
                  }
                  doneLabel="已完成"
                  errorLabel={
                    j.status === "partial"
                      ? "部分失败"
                      : j.type === "import"
                        ? "识别失败"
                        : "解题失败"
                  }
                  color="var(--blue)"
                  doneColor="#16845b"
                  errorColor="#c53750"
                  fontSize={12}
                  showTimer={false}
                />
                <div
                  className="job-progress"
                  role="progressbar"
                  aria-label={j.type === "import" ? "识别进度" : "解题进度"}
                  aria-valuemin={0}
                  aria-valuemax={j.total || 1}
                  aria-valuenow={Math.min(j.completed, j.total || 1)}
                >
                  <span style={{ width: `${progress}%` }} />
                </div>
                <div className="job-progress-caption">
                  <span>
                    {j.completed} / {j.total}{" "}
                    {j.type === "import" ? "页" : "题"}
                  </span>
                  <span>{Math.round(progress)}%</span>
                </div>
                {j.status === "processing" ? (
                  <button disabled={busy} onClick={() => onCancel(j.id)}>
                    停止
                  </button>
                ) : (
                  j.status !== "complete" && (
                    <button
                      className="generation-button"
                      disabled={busy}
                      onClick={() => onResume(j.id)}
                    >
                      继续 / 重试
                    </button>
                  )
                )}
              </div>
            </article>
          );
        })}
      </div>
      <p className="management-footnote">
        重新打开应用后，点击继续可复用已成功识别的页面，已校对内容会保留。
      </p>
    </section>
  );
}
