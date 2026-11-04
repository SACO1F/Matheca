import { useEffect, useState } from "react";

export function WindowControls({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const controls = window.mathecaWindow;
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!controls) return;
    let active = true;
    const sync = () => {
      void controls
        .isMaximized()
        .then((value) => {
          if (active) setMaximized(value);
        })
        .catch((error) => {
          if (active) onError(String(error));
        });
    };
    sync();
    const subscription = controls.onResized(sync);
    void subscription.catch((error) => {
      if (active) onError(String(error));
    });
    return () => {
      active = false;
      void subscription.then((stop) => stop()).catch(() => {});
    };
  }, [controls, onError]);
  if (!controls) return null;
  const action = (operation: () => Promise<void>) => {
    void operation().catch((error) => onError(String(error)));
  };
  return (
    <div className="window-controls" role="group" aria-label="窗口控制">
      <button
        aria-label="最小化"
        title="最小化"
        onClick={() => action(() => controls.minimize())}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M1 6.5h10" />
        </svg>
      </button>
      <button
        aria-label={maximized ? "还原窗口" : "最大化"}
        title={maximized ? "还原窗口" : "最大化"}
        onClick={() => action(() => controls.toggleMaximize())}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          {maximized ? (
            <path d="M3.5 3.5v-2h7v7h-2m-7-5h7v7h-7Z" />
          ) : (
            <path d="M1.5 1.5h9v9h-9Z" />
          )}
        </svg>
      </button>
      <button
        className="window-close"
        aria-label="关闭窗口"
        title="关闭"
        onClick={() => action(() => controls.close())}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="m1.5 1.5 9 9m0-9-9 9" />
        </svg>
      </button>
    </div>
  );
}
