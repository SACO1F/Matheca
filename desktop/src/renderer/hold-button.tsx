import { useCallback, useEffect, useRef, useState } from "react";

// Progress stays in the DOM so holding does not rerender the question list.
export function HoldButton({
  label,
  ariaLabel = label,
  className = "",
  disabled = false,
  onComplete,
}: {
  label: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  onComplete: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const frame = useRef(0);
  const pressed = useRef(false);
  const [holding, setHolding] = useState(false);
  const [done, setDone] = useState(false);
  const complete = useRef(onComplete);
  complete.current = onComplete;
  const cancel = useCallback(() => {
    cancelAnimationFrame(frame.current);
    pressed.current = false;
    button.current?.style.setProperty("--hold-progress", "0");
    setHolding(false);
    setDone(false);
  }, []);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancelAnimationFrame(frame.current);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [cancel]);
  useEffect(() => {
    if (disabled) cancel();
  }, [disabled, cancel]);
  const start = () => {
    if (disabled || pressed.current) return;
    pressed.current = true;
    setHolding(true);
    setDone(false);
    const started = performance.now();
    const tick = (now: number) => {
      if (!pressed.current) return;
      const progress = Math.min(1, (now - started) / 1200);
      button.current?.style.setProperty("--hold-progress", String(progress));
      if (progress === 1) {
        setHolding(false);
        setDone(true);
        complete.current();
      } else frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  return (
    <button
      ref={button}
      type="button"
      className={`hold-button ${className}${holding ? " holding" : ""}${done ? " completed" : ""}`}
      disabled={disabled}
      aria-label={ariaLabel}
      title={`${ariaLabel}（按住 1.2 秒，松开取消；支持空格或回车）`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (!event.isPrimary || event.button !== 0) return;
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        start();
      }}
      onPointerMove={(event) => {
        if (!pressed.current) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onBlur={cancel}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          cancel();
          return;
        }
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) start();
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <span className="hold-fill" aria-hidden="true" />
      <span className="hold-label">{label}</span>
      <span className="hold-feedback" aria-hidden="true">
        {done ? "已完成" : "松开取消"}
      </span>
    </button>
  );
}
