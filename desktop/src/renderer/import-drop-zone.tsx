import { useEffect, useRef, useState } from "react";
export function ImportDropZone({
  busy,
  onImport,
  onBlocked,
}: {
  busy: boolean;
  onImport: (files: File[]) => void;
  onBlocked: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const current = useRef({ busy, onImport, onBlocked });
  current.current = { busy, onImport, onBlocked };
  useEffect(() => {
    let depth = 0;
    const isFile = (event: DragEvent) =>
      event.dataTransfer?.types.includes("Files");
    const reset = () => {
      depth = 0;
      setDragging(false);
    };
    const enter = (event: DragEvent) => {
      if (isFile(event)) {
        event.preventDefault();
        depth++;
        setDragging(true);
      }
    };
    const over = (event: DragEvent) => {
      if (isFile(event)) {
        event.preventDefault();
        // Keep receiving the drop so a blocked operation can clear the overlay
        // and explain why it was refused, instead of leaving a stale highlight.
        event.dataTransfer!.dropEffect = "copy";
      }
    };
    const leave = (event: DragEvent) => {
      if (isFile(event) && --depth <= 0) reset();
    };
    const drop = (event: DragEvent) => {
      if (!isFile(event)) return;
      event.preventDefault();
      event.stopPropagation();
      reset();
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.length) return;
      if (current.current.busy) current.current.onBlocked();
      else current.current.onImport(files);
    };
    document.addEventListener("dragenter", enter, true);
    document.addEventListener("dragover", over, true);
    document.addEventListener("dragleave", leave, true);
    document.addEventListener("drop", drop, true);
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
    return () => {
      document.removeEventListener("dragenter", enter, true);
      document.removeEventListener("dragover", over, true);
      document.removeEventListener("dragleave", leave, true);
      document.removeEventListener("drop", drop, true);
      window.removeEventListener("dragend", reset);
      window.removeEventListener("blur", reset);
    };
  }, []);
  if (!dragging) return null;
  return (
    <div className="import-drop-overlay" role="status" aria-live="polite">
      <div className="import-drop-message">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3v12m-4-8 4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
        </svg>
        <h2>{busy ? "正在处理，请稍后拖入" : "松开即可导入文件"}</h2>
        <p>图片、PDF 或 Windows 题库 ZIP</p>
        <small>
          图片 / PDF 一次最多 20 个，每个不超过 50 MB；题库 ZIP 请单独拖入
        </small>
      </div>
    </div>
  );
}
