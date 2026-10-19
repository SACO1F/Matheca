import { useEffect, useRef, useState } from "react";
import type { HistoryEntry } from "../shared/types";
const api = window.matheca;
function useHistory(limit: number, offset = 0, query = "", refreshKey = false) {
  const [result, setResult] = useState<{
    records: HistoryEntry[];
    total: number;
  }>({ records: [], total: 0 });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true,
      version = 0;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const current = ++version;
      try {
        const result = await api.historyList(limit, offset, query);
        if (alive && current === version) {
          setResult(result);
          setError("");
          setLoading(false);
        }
      } catch (error) {
        if (alive && current === version) {
          setError(error instanceof Error ? error.message : "读取历史失败");
          setLoading(false);
        }
      }
    };
    setLoading(true);
    void refresh();
    const unsubscribe = api.onHistoryChanged(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 100);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [limit, offset, query, refreshKey]);
  return { ...result, error, loading };
}
const statuses = { done: "已完成", failed: "失败", cancelled: "已取消" };
function historyDay(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const prefix =
    date.toDateString() === now.toDateString()
      ? "今天"
      : date.toDateString() === yesterday.toDateString()
        ? "昨天"
        : date.toLocaleDateString("zh-CN", { weekday: "long" });
  return {
    key: date.toDateString(),
    label: prefix,
    date: date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  };
}
function HistoryRows({
  records,
  compact = false,
}: {
  records: HistoryEntry[];
  compact?: boolean;
}) {
  return (
    <ol className={`history-rows${compact ? " compact" : ""}`}>
      {records.map((entry) => (
        <li key={entry.id}>
          {!compact && (
            <time
              className="history-row-time"
              dateTime={new Date(entry.timestamp).toISOString()}
            >
              {new Date(entry.timestamp).toLocaleTimeString("zh-CN", {
                hour12: false,
              })}
            </time>
          )}
          <span
            className={`history-marker ${entry.status}`}
            aria-hidden="true"
          />
          <div className="history-description">
            <b>{entry.title}</b>
            {entry.detail && <p>{entry.detail}</p>}
            {compact && (
              <time dateTime={new Date(entry.timestamp).toISOString()}>
                {new Date(entry.timestamp).toLocaleString("zh-CN", {
                  hour12: false,
                })}
              </time>
            )}
          </div>
          <span className={`history-status ${entry.status}`}>
            {entry.category === "interaction" ? "查询" : statuses[entry.status]}
          </span>
        </li>
      ))}
    </ol>
  );
}
export function HistoryPage() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(0);
      setSearch(query);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  const result = useHistory(100, page * 100, search);
  const days: {
    key: string;
    label: string;
    date: string;
    records: HistoryEntry[];
  }[] = [];
  for (const entry of result.records) {
    const day = historyDay(entry.timestamp);
    const last = days[days.length - 1];
    if (last?.key === day.key) last.records.push(entry);
    else days.push({ ...day, records: [entry] });
  }
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroll.current?.scrollTo(0, 0);
  }, [page, search]);
  return (
    <section className="management-page history-page" aria-label="操作历史">
      <div className="management-toolbar history-toolbar">
        <p>
          {search ? "匹配" : "共"} {result.total} 条记录{" "}
          <span aria-hidden="true">·</span> 最新操作在前
        </p>
        <input
          type="search"
          aria-label="搜索历史记录"
          placeholder="搜索操作或题目、题集…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="history-column-head" aria-hidden="true">
        <span>时间</span>
        <span>操作与内容</span>
        <span>结果</span>
      </div>
      <div className="history-timeline" ref={scroll} aria-busy={result.loading}>
        {result.error ? (
          <p role="alert">{result.error}</p>
        ) : result.loading ? (
          <p className="hint">正在读取历史记录…</p>
        ) : result.records.length ? (
          days.map((day) => (
            <section
              className="history-day"
              key={day.key}
              aria-label={day.date}
            >
              <header>
                <h2>{day.label}</h2>
                <span>{day.date}</span>
                <span className="history-day-count">
                  {day.records.length} 条记录
                </span>
              </header>
              <HistoryRows records={day.records} />
            </section>
          ))
        ) : (
          <div className="management-empty history-empty">
            <h3>{search ? "没有匹配的历史记录" : "暂无历史记录"}</h3>
            <p>
              {search
                ? "试试题目、题集名称或操作关键词。"
                : "题库与题集的增删、修改和查询会记录在这里。"}
            </p>
            {search && <button onClick={() => setQuery("")}>清空搜索</button>}
          </div>
        )}
      </div>
      <div className="history-pagination">
        <p>仅记录题库、题集等内容操作</p>
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>
          上一页
        </button>
        <span>
          第 {page + 1} / {Math.max(1, Math.ceil(result.total / 100))} 页
        </span>
        <button
          disabled={(page + 1) * 100 >= result.total}
          onClick={() => setPage(page + 1)}
        >
          下一页
        </button>
      </div>
    </section>
  );
}
export function RecentHistory({ onViewAll }: { onViewAll: () => void }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const open = !dismissed && (hover || pinned);
  const result = useHistory(5, 0, "", open);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setPinned(false);
        setHover(false);
        setDismissed(true);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setPinned(false);
        setHover(false);
        setDismissed(true);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  return (
    <div
      className="recent-history"
      ref={root}
      onMouseEnter={() => {
        clearTimeout(leaveTimer.current);
        setDismissed(false);
        setHover(true);
      }}
      onMouseLeave={() => {
        leaveTimer.current = setTimeout(() => setHover(false), 180);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setPinned(false);
          setHover(false);
        }
      }}
    >
      <button
        ref={trigger}
        className="titlebar-history-button history-steps-button"
        aria-label="历史步骤"
        title="历史步骤"
        aria-expanded={open}
        aria-controls="recent-operation-history"
        onClick={() => {
          setPinned(!pinned);
          setDismissed(pinned);
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 11a9 9 0 1 1 2.6 7M3 5v6h6M12 7v5l3 2" />
        </svg>
      </button>
      {open && (
        <section
          id="recent-operation-history"
          className="recent-history-popover"
          aria-label="最近五次操作"
        >
          <header>
            <b>最近 5 次操作</b>
            <span>{Math.min(5, result.total)} 条</span>
          </header>
          {result.error ? (
            <p role="alert">{result.error}</p>
          ) : result.loading ? (
            <p className="hint">正在读取…</p>
          ) : result.records.length ? (
            <HistoryRows records={result.records} compact />
          ) : (
            <p className="hint">暂无历史记录</p>
          )}
          <button
            className="history-view-all"
            onClick={() => {
              setHover(false);
              setPinned(false);
              setDismissed(true);
              onViewAll();
            }}
          >
            查看全部历史记录
          </button>
        </section>
      )}
    </div>
  );
}
