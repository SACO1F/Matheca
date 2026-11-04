import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Modal({
  titleId,
  onCancel,
  busy = false,
  children,
}: {
  titleId: string;
  onCancel: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [trigger] = useState(() => document.activeElement);
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      // Parent regions may still be inert during the unmount commit.
      // Restore focus after React has removed their inert attributes.
      requestAnimationFrame(() => {
        if (trigger instanceof HTMLElement && trigger.isConnected)
          trigger.focus({ preventScroll: true });
      });
    };
  }, [trigger]);
  return createPortal(
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}
