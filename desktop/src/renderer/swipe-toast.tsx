import { useEffect, useRef, useState } from "react";

export function SwipeToast({
  message,
  duration = 8000,
  onDismiss,
  actionLabel,
  onAction,
  busy = false,
}: {
  message: string;
  duration?: number;
  onDismiss: () => void;
  actionLabel?: string;
  onAction?: () => void;
  busy?: boolean;
}) {
  const toast = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const pause = useRef({
    hover: false,
    focus: false,
    drag: false,
    hidden: false,
  });
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const drag = useRef<{ y: number; time: number; offset: number } | undefined>(
    undefined,
  );
  const close = () => {
    if (closeTimer.current) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => dismiss.current(), 220);
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    let frame = 0,
      elapsed = 0,
      previous = performance.now();
    const hidden = () => {
      pause.current.hidden = document.hidden || !document.hasFocus();
    };
    hidden();
    window.addEventListener("blur", hidden);
    window.addEventListener("focus", hidden);
    document.addEventListener("visibilitychange", hidden);
    const tick = (now: number) => {
      if (!Object.values(pause.current).some(Boolean))
        elapsed += now - previous;
      previous = now;
      toast.current?.style.setProperty(
        "--toast-remaining",
        String(Math.max(0, 1 - elapsed / duration)),
      );
      if (elapsed >= duration) closeRef.current();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(closeTimer.current);
      window.removeEventListener("blur", hidden);
      window.removeEventListener("focus", hidden);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [duration]);
  const resetDrag = () => {
    drag.current = undefined;
    pause.current.drag = false;
    toast.current?.style.setProperty("--toast-drag", "0px");
  };
  return (
    <div className="toast-slot">
      <div
        ref={toast}
        className={`swipe-toast${closing ? " dismissing" : ""}`}
        role="region"
        aria-label="通知"
        onPointerEnter={() => {
          pause.current.hover = true;
        }}
        onPointerLeave={() => {
          pause.current.hover = false;
        }}
        onFocusCapture={() => {
          pause.current.focus = true;
        }}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget))
            pause.current.focus = false;
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
        }}
        onPointerDown={(e) => {
          if (
            e.button !== 0 ||
            !e.isPrimary ||
            (e.target as Element).closest("button")
          )
            return;
          drag.current = { y: e.clientY, time: performance.now(), offset: 0 };
          pause.current.drag = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          drag.current.offset = Math.max(
            0,
            Math.min(160, e.clientY - drag.current.y),
          );
          toast.current?.style.setProperty(
            "--toast-drag",
            `${drag.current.offset}px`,
          );
        }}
        onPointerUp={() => {
          if (!drag.current) return;
          const { offset, time } = drag.current;
          if (
            offset > 52 ||
            (offset > 16 &&
              offset / Math.max(1, performance.now() - time) > 0.5)
          )
            close();
          resetDrag();
        }}
        onPointerCancel={resetDrag}
        onLostPointerCapture={resetDrag}
      >
        <svg
          className="toast-check"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 3 3 5-6" />
        </svg>
        <span className="toast-message" role="status" aria-live="polite">
          {message}
        </span>
        {actionLabel && (
          <button
            className="toast-action"
            disabled={busy || closing}
            onClick={onAction}
          >
            {actionLabel}
          </button>
        )}
        <button className="toast-close" aria-label="关闭通知" onClick={close}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m7 7 10 10M17 7 7 17" />
          </svg>
        </button>
        <span className="toast-fuse" aria-hidden="true" />
      </div>
    </div>
  );
}
