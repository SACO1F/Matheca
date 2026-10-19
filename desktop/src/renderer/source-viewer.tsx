import React, { useEffect, useRef, useState } from "react";
import { GlideSelect } from "./glide-select";
import {
  figurePlacementOptions,
  type FigurePlacement,
} from "../domain/figures";

export function SourceViewer({
  src,
  label,
  expanded,
  onToggle,
  persistent = false,
  onExtract,
  choice = false,
}: {
  src: string;
  label: string;
  expanded: boolean;
  onToggle: () => void;
  persistent?: boolean;
  choice?: boolean;
  onExtract?: (
    rect: {
      x: number;
      y: number;
      width: number;
      height: number;
    },
    placement: FigurePlacement,
  ) => Promise<void>;
}) {
  const [zoom, setZoom] = useState(1);
  const [placement, setPlacement] = useState<FigurePlacement>("stem");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const viewport = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [cropping, setCropping] = useState(false);
  const [selection, setSelection] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>();
  const cropStart = useRef<{ x: number; y: number } | undefined>(undefined);
  const [cropError, setCropError] = useState("");
  const [extracting, setExtracting] = useState(false);
  const fitted = () => {
    const image = imageRef.current,
      canvas = viewport.current;
    if (!image || !canvas || !image.naturalWidth)
      return { width: 0, height: 0 };
    const scale = Math.min(
      canvas.clientWidth / image.naturalWidth,
      canvas.clientHeight / image.naturalHeight,
    );
    return {
      width: image.naturalWidth * scale,
      height: image.naturalHeight * scale,
    };
  };
  const clampPan = (value: { x: number; y: number }) => {
    const fit = fitted(),
      canvas = viewport.current;
    if (!canvas || !fit.width) return { x: 0, y: 0 };
    const x = Math.abs(fit.width * zoom - canvas.clientWidth) / 2,
      y = Math.abs(fit.height * zoom - canvas.clientHeight) / 2;
    return {
      x: Math.max(-x, Math.min(x, value.x)),
      y: Math.max(-y, Math.min(y, value.y)),
    };
  };
  useEffect(() => {
    const canvas = viewport.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() =>
      setSize({ width: canvas.clientWidth, height: canvas.clientHeight }),
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [expanded]);
  useEffect(() => {
    setPan((previous) => clampPan(previous));
  }, [zoom, size.width, size.height]);
  const cropPoint = (x: number, y: number) => {
    const rect = viewport.current!.getBoundingClientRect(),
      fit = fitted();
    return {
      x: Math.max(
        0,
        Math.min(
          1,
          (x - rect.left - (rect.width - fit.width * zoom) / 2 - pan.x) /
            (fit.width * zoom),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          1,
          (y - rect.top - (rect.height - fit.height * zoom) / 2 - pan.y) /
            (fit.height * zoom),
        ),
      ),
    };
  };
  const fit = fitted();

  const drag = useRef<
    | {
        pointer: number;
        x: number;
        y: number;
        originX: number;
        originY: number;
      }
    | undefined
  >(undefined);
  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  const changeZoom = (delta: number) =>
    setZoom((value) =>
      Math.min(8, Math.max(1, Math.round((value + delta) * 100) / 100)),
    );
  useEffect(() => {
    if (!expanded) reset();
    const element = viewport.current;
    if (!element || !expanded) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      changeZoom(event.deltaY < 0 ? 0.15 : -0.15);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [expanded]);
  return (
    <aside
      className={"source-pane" + (expanded ? " expanded" : "")}
      aria-label="来源原图对照"
    >
      <div className="list-heading">
        <b>来源原图</b>
        {!persistent && (
          <button onClick={onToggle} aria-expanded={expanded}>
            {expanded ? "收起对照" : "对照查看"}
          </button>
        )}
      </div>
      {expanded && (
        <div className="source-tools">
          <div className="source-view-controls">
            <button
              aria-label="缩小原图"
              disabled={zoom <= 1}
              onClick={() => changeZoom(-0.25)}
            >
              −
            </button>
            <output aria-live="polite">{Math.round(zoom * 100)}%</output>
            <button
              aria-label="放大原图"
              disabled={zoom >= 8}
              onClick={() => changeZoom(0.25)}
            >
              ＋
            </button>
            <button onClick={reset}>适应窗口</button>
          </div>
          {onExtract && (
            <div className="source-crop-tools">
              {choice && !extracting && (
                <GlideSelect
                  label="提取图形位置"
                  value={placement}
                  options={figurePlacementOptions}
                  onChange={(value) => setPlacement(value as FigurePlacement)}
                />
              )}
              {!cropping && (
                <button
                  onClick={() => {
                    setCropping(true);
                    setSelection(undefined);
                    setCropError("");
                  }}
                >
                  提取图形
                </button>
              )}
              {cropping && (
                <>
                  <button
                    disabled={
                      !selection ||
                      selection.width <= 0 ||
                      selection.height <= 0 ||
                      extracting
                    }
                    onClick={async () => {
                      if (!selection) return;
                      setExtracting(true);
                      try {
                        await onExtract?.(
                          selection,
                          choice ? placement : "stem",
                        );
                        setCropping(false);
                        setSelection(undefined);
                      } catch (error) {
                        setCropError(
                          error instanceof Error ? error.message : "提取失败",
                        );
                      } finally {
                        setExtracting(false);
                      }
                    }}
                  >
                    插入图形
                  </button>
                  <button
                    disabled={extracting}
                    onClick={() => {
                      setCropping(false);
                      setSelection(undefined);
                      setCropError("");
                    }}
                  >
                    取消提取
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {expanded ? (
        <div
          className={"source-canvas" + (cropping ? " cropping" : "")}
          onDragStart={(event) => event.preventDefault()}
          ref={viewport}
          tabIndex={0}
          aria-label="原图查看区域，滚轮缩放，拖动移动，方向键移动，零键复位"
          onDoubleClick={reset}
          onKeyDown={(event) => {
            if (
              [
                "+",
                "=",
                "-",
                "0",
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
              ].includes(event.key)
            )
              event.preventDefault();
            if (event.key === "+" || event.key === "=") changeZoom(0.25);
            if (event.key === "-") changeZoom(-0.25);
            if (event.key === "0") reset();
            const offsets: Record<string, [number, number]> = {
              ArrowLeft: [24, 0],
              ArrowRight: [-24, 0],
              ArrowUp: [0, 24],
              ArrowDown: [0, -24],
            };
            const offset = offsets[event.key];
            if (offset)
              setPan((value) => ({
                ...clampPan({ x: value.x + offset[0], y: value.y + offset[1] }),
              }));
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            if (cropping) {
              cropStart.current = cropPoint(event.clientX, event.clientY);
              setSelection(undefined);
              return;
            }

            drag.current = {
              pointer: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              originX: pan.x,
              originY: pan.y,
            };
            event.currentTarget.dataset.dragging = "true";
          }}
          onPointerMove={(event) => {
            if (cropping && cropStart.current) {
              const point = cropPoint(event.clientX, event.clientY),
                start = cropStart.current;
              setSelection({
                x: Math.min(point.x, start.x),
                y: Math.min(point.y, start.y),
                width: Math.abs(point.x - start.x),
                height: Math.abs(point.y - start.y),
              });
              return;
            }
            const start = drag.current;
            if (start?.pointer === event.pointerId)
              setPan(
                clampPan({
                  x: start.originX + event.clientX - start.x,
                  y: start.originY + event.clientY - start.y,
                }),
              );
          }}
          onLostPointerCapture={(event) => {
            drag.current = undefined;
            cropStart.current = undefined;
            delete event.currentTarget.dataset.dragging;
          }}
          onPointerCancel={(event) => {
            drag.current = undefined;
            cropStart.current = undefined;
            delete event.currentTarget.dataset.dragging;
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
        >
          <img
            src={src}
            alt="放大的题目原图"
            ref={imageRef}
            onLoad={() =>
              setSize({
                width: viewport.current!.clientWidth,
                height: viewport.current!.clientHeight,
              })
            }
            onDragStart={(event) => event.preventDefault()}
            draggable={false}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          />
          {selection && cropping && (
            <div
              className="figure-crop-selection"
              style={{
                left:
                  (size.width - fit.width * zoom) / 2 +
                  pan.x +
                  selection.x * fit.width * zoom,
                top:
                  (size.height - fit.height * zoom) / 2 +
                  pan.y +
                  selection.y * fit.height * zoom,
                width: selection.width * fit.width * zoom,
                height: selection.height * fit.height * zoom,
              }}
            />
          )}
        </div>
      ) : (
        <img
          src={src}
          alt="题目来源原图"
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
          onClick={onToggle}
        />
      )}
      {cropError && (
        <p role="alert" className="pending">
          {cropError}
        </p>
      )}
      {cropping && (
        <p className="hint">在原图上框选几何图或函数图像，然后点击插入图形。</p>
      )}
      <p className="hint">
        {label}
        <br />
        {expanded
          ? "滚轮缩放 · 拖动查看 · 双击复位"
          : "对照原图核对条件、符号和图形。"}
      </p>
    </aside>
  );
}
