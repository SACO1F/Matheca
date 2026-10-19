import React, { useLayoutEffect, useRef } from "react";

/** A single-column reading list needs natural flow, not per-pixel grid tracks. */
export function MasonryCards({
  children,
  focusId,
}: {
  children: React.ReactNode;
  animate?: boolean;
  focusId?: string;
  settleKey?: boolean;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!focusId) return;
    const grid = gridRef.current;
    const viewport = grid?.parentElement;
    const card =
      grid &&
      Array.from(grid.querySelectorAll<HTMLElement>(".question-card")).find(
        (item) => item.dataset.questionId === focusId,
      );
    if (!card || !viewport) return;
    // One batched measurement on selection; no resize observer or animation loop.
    const top =
      card.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top +
      viewport.scrollTop;
    viewport.scrollTop = Math.max(0, top - 8);
  }, [focusId]);
  return (
    <div className={"masonry-grid" + (focusId ? " focused" : "")} ref={gridRef}>
      {React.Children.map(children, (child) => (
        <div className="masonry-item">{child}</div>
      ))}
    </div>
  );
}
