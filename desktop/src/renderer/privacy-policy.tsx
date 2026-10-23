import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import policy from "../../../app/src/main/assets/privacy-policy.json";
import "./manual-save-dialog.css";
import "./privacy-policy.css";

export function PrivacyPolicy({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    close.current?.focus();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="manual-save-dialog privacy-policy"
      aria-labelledby="privacy-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id="privacy-title">{policy.title}</h2>
        <p>更新与生效日期：{policy.effectiveDate} · 适用于桌面端与移动端</p>
      </header>
      <article tabIndex={0} aria-label="隐私政策正文">
        <p className="privacy-summary">{policy.summary}</p>
        {policy.sections.map((section) => (
          <section key={section.title}>
            <h3>{section.title}</h3>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
      </article>
      <footer>
        {error && <span role="alert">{error}</span>}
        <button
          onClick={() => {
            void window.matheca
              .openGuideLink("privacyContact")
              .catch(() =>
                setError("无法打开浏览器，请使用政策中的反馈网址。"),
              );
          }}
        >
          联系维护者
        </button>
        <button ref={close} className="primary" onClick={onClose}>
          关闭
        </button>
      </footer>
    </dialog>,
    document.body,
  );
}
