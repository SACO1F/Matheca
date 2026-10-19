import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./manual-save-dialog.css";

export type ManualSaveChoice = "save" | "discard" | "cancel";

export function ManualSaveDialog({
  hasContent,
  onDecision,
}: {
  hasContent: boolean;
  onDecision: (choice: ManualSaveChoice) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    cancel.current?.focus();
    return () => element?.close();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="manual-save-dialog"
      aria-labelledby="manual-save-title"
      aria-describedby="manual-save-description"
      onCancel={(event) => {
        event.preventDefault();
        onDecision("cancel");
      }}
    >
      <div className="manual-save-content">
        <h2 id="manual-save-title">保存这道题目？</h2>
        <p id="manual-save-description">
          {hasContent
            ? "保存后加入题库；不保存则放弃这次录入。"
            : "这道题还没有内容。选择保存也不会留下空白题目。"}
        </p>
      </div>
      <footer>
        <button ref={cancel} onClick={() => onDecision("cancel")}>
          取消
        </button>
        <button onClick={() => onDecision("discard")}>不保存</button>
        <button className="primary" onClick={() => onDecision("save")}>
          保存
        </button>
      </footer>
    </dialog>,
    document.body,
  );
}
