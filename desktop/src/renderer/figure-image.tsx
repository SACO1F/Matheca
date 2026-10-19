import React, { useEffect, useState } from "react";
import { figureDimensions } from "../domain/figures";
import type { Question } from "../shared/types";

export function FigureImage({
  src,
  index,
  width = 0,
  lazy = false,
}: {
  src: string;
  index: number;
  width?: number;
  lazy?: boolean;
}) {
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const size =
    width && natural.width
      ? figureDimensions(natural.width, natural.height, width)
      : undefined;
  return (
    <img
      src={src}
      alt={`题目图形 ${index + 1}`}
      draggable={false}
      loading={lazy ? "lazy" : "eager"}
      decoding="async"
      onLoad={(e) =>
        setNatural({
          width: e.currentTarget.naturalWidth,
          height: e.currentTarget.naturalHeight,
        })
      }
      style={
        size
          ? {
              width: size.width,
              height: "auto",
              maxWidth: "100%",
              maxHeight: "none",
            }
          : undefined
      }
    />
  );
}

export function FigureSizeControl({
  index,
  width,
  onChange,
  scopeLabel,
  mixed = false,
  resetLabel = "自动大小",
}: {
  index: number;
  width: number;
  onChange: (width: number) => void;
  scopeLabel?: string;
  mixed?: boolean;
  resetLabel?: string;
}) {
  const name = scopeLabel ?? `图形 ${index + 1} 宽度`;
  const [text, setText] = useState(width ? String(width) : "");
  useEffect(() => setText(width ? String(width) : ""), [width]);
  function commit() {
    const value = Number(text);
    if (text.trim() && Number.isFinite(value)) {
      const next = Math.min(160, Math.max(20, Math.round(value)));
      setText(String(next));
      onChange(next);
    } else {
      onChange(0);
      setText("");
    }
  }
  return (
    <div className="figure-size-control">
      <label>
        {scopeLabel ? "统一图片宽度" : "图片宽度"}
        <input
          type="range"
          aria-label={`${name}滑块`}
          min={20}
          max={160}
          step={1}
          value={width || 80}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </label>
      <div className="figure-size-value">
        <input
          type="number"
          aria-label={`${name}（毫米）`}
          min={20}
          max={160}
          step={1}
          placeholder={mixed ? "各图不同" : "自动"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
        <span>毫米</span>
        <button type="button" onClick={() => onChange(0)}>
          {resetLabel}
        </button>
      </div>
    </div>
  );
}
export function OptionFigureSizeControl({
  question,
  onChange,
}: {
  question: Question;
  onChange: (widths: number[]) => void;
}) {
  if (question.kind !== "选择题") return null;
  const indices = (question.figures ?? []).flatMap((_, i) =>
    question.figurePlacements?.[i] && question.figurePlacements[i] !== "stem"
      ? [i]
      : [],
  );
  if (!indices.length) return null;
  const values = indices.map((i) => question.figureWidths?.[i] ?? 0);
  const mixed = values.some((value) => value !== values[0]);
  return (
    <section className="option-figure-size" aria-label="选项图片统一大小">
      <strong>选项图片统一大小</strong>
      <p>同步调整 A／B／C／D 图片宽度，保留各图比例。</p>
      <FigureSizeControl
        index={0}
        scopeLabel="选项图片统一宽度"
        mixed={mixed}
        width={mixed ? 0 : values[0]}
        resetLabel="全部自动大小"
        onChange={(width) =>
          onChange(
            (question.figures ?? []).map((_, i) =>
              indices.includes(i) ? width : (question.figureWidths?.[i] ?? 0),
            ),
          )
        }
      />
    </section>
  );
}
