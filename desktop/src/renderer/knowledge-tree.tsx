import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { groups } from "../domain/catalog";
import type { KnowledgePoint } from "../shared/types";
import "./knowledge-tree.css";

// Adapted from React Bits BranchedMenu; attribution in assets/react-bits.

function BranchConnectors({
  selected,
  points,
}: {
  selected: string;
  points: string[];
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [centers, setCenters] = useState<number[]>([]);
  useEffect(() => {
    const container = ref.current?.parentElement;
    if (!container) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rows = Array.from(
          container.querySelectorAll<HTMLElement>(".knowledge-leaf"),
        );
        const next = rows.map((row) => row.offsetTop + row.offsetHeight / 2);
        setCenters((previous) =>
          previous.length === next.length &&
          previous.every((value, i) => Math.abs(value - next[i]) < 0.5)
            ? previous
            : next,
        );
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    container
      .querySelectorAll(".knowledge-leaf")
      .forEach((row) => observer.observe(row));
    measure();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [points.join("\0")]);
  return (
    <svg ref={ref} className="branch-connectors" aria-hidden="true">
      <path
        className="branch-line"
        d={`M 14 0 V ${Math.max(0, (centers.at(-1) ?? 10) - 10)}`}
      />
      {centers.map((center, index) => {
        const branch = `M 14 ${Math.max(0, center - 10)} A 10 10 0 0 0 24 ${center} H 32`;
        const d = `M 14 0 V ${Math.max(0, center - 10)} A 10 10 0 0 0 24 ${center} H 32`;
        return (
          <g key={points[index]}>
            <path className="branch-line" d={branch} />
            <path
              className={
                "branch-trace" + (selected === points[index] ? " active" : "")
              }
              pathLength="1"
              d={d}
            />
          </g>
        );
      })}
    </svg>
  );
}

export function KnowledgeTree({
  custom,
  selected,
  onSelect,
  onClose,
}: {
  custom: KnowledgePoint[];
  selected: string;
  onSelect: (point: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(Object.keys(groups).slice(0, 3)),
  );
  const [focused, setFocused] = useState(Object.keys(groups)[0]);
  useEffect(() => {
    const group = Object.entries(groups).find(
      ([name, points]) =>
        points.includes(selected) ||
        custom.some((point) => point.group === name && point.name === selected),
    )?.[0];
    if (group)
      setExpanded((previous) =>
        previous.has(group) ? previous : new Set([...previous, group]),
      );
  }, [selected, custom]);
  const menuRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLSpanElement>(null);
  const activeGroup = Object.entries(groups).find(
    ([group, points]) =>
      points.includes(selected) ||
      custom.some((point) => point.group === group && point.name === selected),
  )?.[0];
  const markerShown = !!activeGroup && expanded.has(activeGroup);
  useLayoutEffect(() => {
    const menu = menuRef.current,
      marker = markerRef.current;
    if (!menu || !marker) return;
    const place = (glide: boolean) => {
      const heading = Array.from(
        menu.querySelectorAll<HTMLElement>(".knowledge-group"),
      ).find(
        (head) =>
          head.closest<HTMLElement>(".knowledge-branch")?.dataset.group ===
          activeGroup,
      );
      if (!glide) marker.style.transition = "none";
      if (markerShown && heading)
        marker.style.top = `${heading.offsetTop + heading.parentElement!.offsetTop + (heading.offsetHeight - 16) / 2}px`;
      marker.toggleAttribute("data-on", !!(markerShown && heading));
      if (!glide) {
        void marker.offsetHeight;
        marker.style.transition = "";
      }
    };
    place(true);
    let frame = 0;
    let first = true;
    const observer = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => place(false));
    });
    observer.observe(menu);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [activeGroup, markerShown]);
  const toggle = (group: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  return (
    <aside
      className="knowledge-panel"
      aria-label="题库知识点导航"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="knowledge-panel-heading">
        <strong>知识点</strong>
      </div>
      <button
        className={"knowledge-all" + (!selected ? " selected" : "")}
        aria-pressed={!selected}
        onClick={() => onSelect("")}
      >
        全部题目
      </button>
      <div
        className="knowledge-tree-scroll"
        role="tree"
        aria-label="数学知识点"
        onKeyDown={(event) => {
          const current = (
            event.target as HTMLElement
          ).closest<HTMLButtonElement>('[role="treeitem"]');
          if (!current) return;
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role="treeitem"]',
            ),
          ).filter((element) => !element.closest("[inert]"));
          const index = items.indexOf(current);
          const group =
            current.closest<HTMLElement>(".knowledge-branch")!.dataset.group!;
          let target: HTMLButtonElement | undefined;
          if (event.key === "ArrowDown")
            target = items[Math.min(index + 1, items.length - 1)];
          else if (event.key === "ArrowUp")
            target = items[Math.max(index - 1, 0)];
          else if (event.key === "Home") target = items[0];
          else if (event.key === "End") target = items.at(-1);
          else if (
            event.key === "ArrowRight" &&
            current.hasAttribute("aria-expanded")
          ) {
            if (!expanded.has(group)) toggle(group);
            else target = items[index + 1];
          } else if (event.key === "ArrowLeft") {
            if (current.hasAttribute("aria-expanded")) {
              if (expanded.has(group)) toggle(group);
            } else
              target = current
                .closest(".knowledge-branch")!
                .querySelector<HTMLButtonElement>(".knowledge-group")!;
          } else return;
          event.preventDefault();
          target?.focus();
        }}
      >
        <div ref={menuRef} className="branched-menu">
          <span
            ref={markerRef}
            className="branched-menu__marker"
            aria-hidden="true"
          />
          {Object.entries(groups).map(([group, base], index) => {
            const points = [
              ...base,
              ...custom
                .filter((point) => point.group === group)
                .map((point) => point.name),
            ];
            const open = expanded.has(group);
            const groupId = `${id}-${index}`;
            return (
              <section
                className="knowledge-branch"
                data-group={group}
                data-selected={points.includes(selected)}
                key={group}
                role="none"
              >
                <button
                  className="knowledge-group"
                  role="treeitem"
                  aria-level={1}
                  aria-expanded={open}
                  aria-selected={false}
                  aria-controls={groupId}
                  tabIndex={focused === group ? 0 : -1}
                  onFocus={() => setFocused(group)}
                  onClick={() => toggle(group)}
                >
                  <span>{group}</span>
                </button>
                <div
                  id={groupId}
                  className={"knowledge-children" + (open ? " open" : "")}
                  inert={!open}
                  role="group"
                  aria-label={group}
                >
                  <div className="knowledge-fold">
                    <div className="knowledge-leaves">
                      <BranchConnectors points={points} selected={selected} />
                      {points.map((point) => (
                        <button
                          key={point}
                          className={
                            "knowledge-leaf" +
                            (selected === point ? " selected" : "")
                          }
                          role="treeitem"
                          aria-level={2}
                          aria-selected={selected === point}
                          tabIndex={focused === point ? 0 : -1}
                          onFocus={() => setFocused(point)}
                          onClick={() => onSelect(point)}
                        >
                          <span>{point}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
