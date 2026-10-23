import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./manual-save-dialog.css";

export function CloseChoiceDialog({
  onDecision,
}: {
  onDecision: (
    choice: "quit" | "background" | "cancel",
    remember: boolean,
  ) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [remember, setRemember] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    cancel.current?.focus();
    return () => element?.close();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="manual-save-dialog close-choice-dialog"
      aria-labelledby="close-choice-title"
      aria-describedby="close-choice-description"
      onCancel={(event) => {
        event.preventDefault();
        onDecision("cancel", remember);
      }}
    >
      <div className="manual-save-content">
        <h2 id="close-choice-title">关闭 Matheca</h2>
        <p id="close-choice-description">
          直接退出前会处理未保存的题目；后台运行会保留当前窗口和任务，可从系统托盘恢复或右键退出。
        </p>
        <label className="check close-choice-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          保持以上选择
        </label>
        <p className="close-choice-note">
          记住退出或后台运行，下次关闭时不再询问。可在“设置与备份 →
          关闭行为”中修改。
        </p>
      </div>
      <footer>
        <button ref={cancel} onClick={() => onDecision("cancel", remember)}>
          取消
        </button>
        <button onClick={() => onDecision("quit", remember)}>直接退出</button>
        <button
          className="primary"
          onClick={() => onDecision("background", remember)}
        >
          后台运行
        </button>
      </footer>
    </dialog>,
    document.body,
  );
}
