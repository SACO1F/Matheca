import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type Option = { value: string; label: string; group?: string };
export function GlideSelect({
  label,
  value,
  options,
  onChange,
  boundaryRef,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  boundaryRef?: React.RefObject<HTMLElement | null>;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 196,
    maxHeight: 300,
    above: false,
  });
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const sections: {
    group?: string;
    options: { option: Option; index: number }[];
  }[] = [];
  const offsets: number[] = [];
  let menuHeight = 0;
  options.forEach((option, index) => {
    if (!sections.length || sections.at(-1)?.group !== option.group) {
      sections.push({ group: option.group, options: [] });
      if (option.group) menuHeight += 28;
    }
    offsets.push(menuHeight);
    menuHeight += 32;
    sections.at(-1)!.options.push({ option, index });
  });
  const show = () => {
    setHighlight(selected);
    setMounted(true);
    setOpen(true);
    window.dispatchEvent(
      new CustomEvent("matheca:select-open", { detail: id }),
    );
  };
  const pick = (index: number) => {
    onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus();
  };
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const update = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const boundary = boundaryRef?.current?.getBoundingClientRect();
      const leftEdge = boundary ? boundary.left + 8 : 8;
      const rightEdge = boundary ? boundary.right - 8 : innerWidth - 8;
      const topEdge = boundary ? boundary.top + 8 : 8;
      const bottomEdge = boundary ? boundary.bottom - 8 : innerHeight - 8;
      const width = Math.min(
        label === "知识点" || label === "添加知识点" || label === "所属模块"
          ? 264
          : 196,
        rightEdge - leftEdge,
      );
      const above =
        bottomEdge - rect.bottom < 180 &&
        rect.top - topEdge > bottomEdge - rect.bottom;
      const maxHeight = Math.min(
        304,
        Math.max(
          32,
          (above ? rect.top - topEdge : bottomEdge - rect.bottom) - 6,
        ),
      );
      const height = Math.min(maxHeight, menuHeight + 12);
      setPosition({
        left: Math.max(leftEdge, Math.min(rect.left, rightEdge - width)),
        top: above ? rect.top - height - 6 : rect.bottom + 6,
        width,
        maxHeight,
        above,
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open, menuHeight, label, boundaryRef]);
  useEffect(() => {
    if (open || !mounted) return;
    const timeout = setTimeout(
      () => setMounted(false),
      matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180,
    );
    return () => clearTimeout(timeout);
  }, [open, mounted]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const otherOpened = (event: Event) => {
      if ((event as CustomEvent).detail !== id) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("matheca:select-open", otherOpened);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("matheca:select-open", otherOpened);
    };
  }, [id]);
  useEffect(() => {
    if (open)
      menu.current
        ?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);
  return (
    <div
      className={"glide-select" + (value && value !== "all" ? " filtered" : "")}
    >
      <button
        ref={trigger}
        type="button"
        role="combobox"
        className="glide-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={id}
        aria-activedescendant={open ? `${id}-${highlight}` : undefined}
        title={`${label}：${options[selected]?.label ?? "全部"}`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          } else if (
            ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
          ) {
            event.preventDefault();
            if (!open) show();
            else
              setHighlight((index) =>
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? options.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        options.length) %
                      options.length,
              );
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) pick(highlight);
            else show();
          } else if (event.key === "Tab") setOpen(false);
        }}
      >
        <span>
          {value && value !== "all" ? options[selected]?.label : label}
        </span>
        <svg
          className={open ? "turned" : ""}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {mounted &&
        createPortal(
          <div
            ref={menu}
            id={id}
            className={
              "glide-menu" +
              (open ? " open" : "") +
              (position.above ? " above" : "")
            }
            role="listbox"
            aria-label={label}
            aria-hidden={!open}
            inert={!open}
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.maxHeight,
            }}
          >
            <div className="glide-options">
              <div
                className="glide-highlight"
                aria-hidden="true"
                style={{
                  transform: `translateY(${offsets[highlight] ?? 0}px)`,
                }}
              />
              {sections.map((section, sectionIndex) => (
                <div
                  key={section.group ?? sectionIndex}
                  role={section.group ? "group" : undefined}
                  aria-label={section.group}
                >
                  {section.group && (
                    <div className="glide-group-title" aria-hidden="true">
                      {section.group}
                    </div>
                  )}
                  {section.options.map(({ option, index }) => (
                    <button
                      type="button"
                      role="option"
                      tabIndex={-1}
                      key={option.value}
                      id={`${id}-${index}`}
                      data-index={index}
                      aria-selected={option.value === value}
                      className={
                        "glide-option" + (option.group ? " grouped" : "")
                      }
                      title={option.label}
                      onPointerEnter={() => setHighlight(index)}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => pick(index)}
                    >
                      <span>{option.label}</span>
                      {option.value === value && (
                        <span className="glide-check" aria-hidden="true">
                          ✓
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
