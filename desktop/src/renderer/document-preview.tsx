import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export function DocumentPreview({
  data,
  title,
  format,
  busy,
  onClose,
  onExport,
}: {
  data: number[];
  title: string;
  format: "pdf" | "docx";
  busy: boolean;
  onClose: () => void;
  onExport: () => void;
}) {
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    let cancelled = false;
    const task = pdfjs.getDocument({
      data: new Uint8Array(data),
      useSystemFonts: true,
      cMapUrl: new URL("./pdfjs/cmaps/", location.href).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("./pdfjs/standard_fonts/", location.href)
        .href,
      wasmUrl: new URL("./pdfjs/wasm/", location.href).href,
    });
    task.promise
      .then((document) => {
        if (!cancelled) setPdf(document);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || "预览加载失败");
      });
    return () => {
      cancelled = true;
      void task.destroy().catch(() => {});
    };
  }, [data]);
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    let task: pdfjs.RenderTask | undefined;
    setReady(false);
    setError("");
    void (async () => {
      try {
        const source = await pdf.getPage(page);
        if (cancelled || !canvas.current) return;
        const viewport = source.getViewport({ scale: 1.5 });
        canvas.current.width = Math.ceil(viewport.width);
        canvas.current.height = Math.ceil(viewport.height);
        task = source.render({ canvas: canvas.current, viewport });
        await task.promise;
        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "页面渲染失败");
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page]);
  return (
    <div className="modal-backdrop document-preview-backdrop">
      <section
        className="document-preview"
        role="dialog"
        aria-modal="true"
        aria-label="导出预览"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            onClose();
          }
          if (event.key === "Tab") {
            const controls = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
              ),
            ];
            const first = controls[0],
              last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header className="document-preview-heading">
          <div>
            <h2>导出预览</h2>
            <p>
              {title} · {format === "pdf" ? "PDF" : "Word"}
            </p>
          </div>
          <button
            ref={close}
            className="picker-close"
            aria-label="关闭导出预览"
            disabled={busy}
            onClick={onClose}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div className="document-preview-toolbar">
          <div className="preview-page-controls">
            <button
              aria-label="上一页"
              disabled={!pdf || page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              上一页
            </button>
            <span aria-live="polite">
              {pdf ? `${page} / ${pdf.numPages} 页` : "加载页面…"}
            </span>
            <button
              aria-label="下一页"
              disabled={!pdf || page === pdf.numPages}
              onClick={() => setPage((value) => value + 1)}
            >
              下一页
            </button>
          </div>
          <div className="preview-zoom-controls">
            <button
              aria-label="缩小预览"
              onClick={() =>
                setZoom((value) => Math.max(50, (value ?? 100) - 25))
              }
            >
              −
            </button>
            <span>{zoom === null ? "适应宽度" : `${zoom}%`}</span>
            <button
              aria-label="放大预览"
              onClick={() =>
                setZoom((value) => Math.min(200, (value ?? 100) + 25))
              }
            >
              ＋
            </button>
            <button onClick={() => setZoom(null)}>适应宽度</button>
          </div>
        </div>
        {format === "docx" && (
          <p className="word-preview-note">
            此处为内容的 A4 排版预览，Word 的最终分页可能随软件和字体变化。
          </p>
        )}
        <div className="document-preview-pages" aria-busy={!ready && !error}>
          {error ? (
            <div className="empty" role="alert">
              <h3>无法显示预览</h3>
              <p>{error}</p>
            </div>
          ) : (
            <>
              {!ready && (
                <div className="preview-loading" role="status">
                  正在生成页面…
                </div>
              )}
              <div
                className="preview-canvas-stage"
                style={{ width: zoom === null ? "100%" : "max-content" }}
              >
                <canvas
                  ref={canvas}
                  className={ready ? "ready" : ""}
                  role="img"
                  aria-label={`第 ${page} 页文档预览`}
                  style={{
                    width: zoom === null ? "100%" : `${(794 * zoom) / 100}px`,
                    maxWidth: zoom === null ? 794 : "none",
                  }}
                />
              </div>
            </>
          )}
        </div>
        <footer className="document-preview-footer">
          <button disabled={busy} onClick={onClose}>
            返回编辑
          </button>
          <button
            className="primary"
            disabled={busy || !ready || !!error}
            onClick={onExport}
          >
            {busy
              ? "正在导出…"
              : `确认导出 ${format === "pdf" ? "PDF" : "Word"}`}
          </button>
        </footer>
      </section>
    </div>
  );
}
