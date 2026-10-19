import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MobileImportState } from "../shared/types";
import "./mobile-import.css";

export function MobileImportDialog({
  onClose,
  onTasks,
}: {
  onClose: () => void;
  onTasks: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<MobileImportState>();
  const [network, setNetwork] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let alive = true;
    let polling = false;
    dialog.current?.showModal();
    void window.matheca
      .mobileStart()
      .then((value) => {
        if (alive) setState(value);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    const timer = window.setInterval(() => {
      if (polling) return;
      polling = true;
      void window.matheca
        .mobileStatus()
        .then((value) => {
          if (alive) setState(value);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        })
        .finally(() => {
          polling = false;
        });
    }, 1500);
    return () => {
      alive = false;
      window.clearInterval(timer);
      dialog.current?.close();
    };
  }, []);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成");
    } finally {
      setBusy(false);
    }
  }
  const close = async (tasks = false) => {
    if (busy) return;
    await action(async () => {
      await window.matheca.mobilePause();
      tasks ? onTasks() : onClose();
    });
  };
  const address = Math.min(network, Math.max(0, (state?.urls.length || 1) - 1));
  return createPortal(
    <dialog
      ref={dialog}
      className="mobile-import-dialog"
      aria-labelledby="mobile-import-title"
      onCancel={(event) => {
        event.preventDefault();
        void close();
      }}
    >
      <header className="mobile-import-heading">
        <div>
          <h2 id="mobile-import-title">手机拍照导入</h2>
          <p>手机与电脑连接同一局域网（通常是同一 Wi-Fi），扫码后拍摄或选图。</p>
        </div>
        <button
          className="ghost"
          aria-label="关闭手机接收面板"
          disabled={busy}
          onClick={() => void close()}
        >
          ×
        </button>
      </header>
      {error && (
        <p className="mobile-message error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="mobile-message" role="status">
          {message}
        </p>
      )}
      <div className="mobile-import-body">
        <section className="mobile-pairing" aria-label="手机配对">
          {state?.status === "receiving" && state.qrCodes[address] ? (
            <img
              className="mobile-qr"
              src={state.qrCodes[address]}
              alt="用手机扫描此二维码连接当前电脑"
            />
          ) : (
            <div className="mobile-qr-placeholder">
              {busy ? "正在开启接收…" : "接收已暂停"}
            </div>
          )}
          <strong>
            {state?.status === "receiving"
              ? state.connected
                ? "手机已连接"
                : "等待手机扫码"
              : state?.status === "expired"
                ? "二维码已过期"
                : "尚未开启接收"}
          </strong>
          {state?.status === "receiving" && (
            <p className="hint">
              本次连接于{" "}
              {new Date(state.expiresAt).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              到期
            </p>
          )}
          {state && state.urls.length > 1 && (
            <label className="field">
              <span>连接地址（无法连接时可切换）</span>
              <select
                aria-label="手机接收网络地址"
                value={address}
                onChange={(event) => setNetwork(Number(event.target.value))}
              >
                {state.urls.map((url, index) => (
                  <option key={url} value={index}>
                    {new URL(url).host}
                  </option>
                ))}
              </select>
            </label>
          )}
          {state?.urls[address] && state.status === "receiving" && (
            <p className="mobile-host">{new URL(state.urls[address]).host}</p>
          )}
          {state?.urls.every(
            (url) => new URL(url).hostname === "127.0.0.1",
          ) && (
            <p className="hint">
              未发现局域网地址，请先让电脑连接 Wi-Fi 或有线网络。
            </p>
          )}
          {state?.status !== "receiving" && (
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  setState(await window.matheca.mobileStart());
                })
              }
            >
              重新开启接收
            </button>
          )}
          <p className="hint">
            若系统询问网络权限，请允许专用网络访问。校园 Wi-Fi
            若隔离设备，可换用允许设备互通的网络。
          </p>
        </section>
        <section className="mobile-received" aria-label="收到的照片">
          <div className="mobile-received-title">
            <h3>收到的照片</h3>
            <span>{state?.files.length || 0} / 20</span>
          </div>
          {state?.files.length ? (
            <div className="mobile-photo-grid">
              {state.files.map((photo, index) => (
                <article key={photo.id} className="mobile-photo">
                  <img
                    src={photo.preview}
                    alt={`第 ${index + 1} 张：${photo.name}`}
                    loading="lazy"
                  />
                  <div>
                    <strong>
                      {index + 1}. {photo.name}
                    </strong>
                    <span>{(photo.size / 1024 / 1024).toFixed(1)} MB</span>
                  </div>
                  <button
                    disabled={busy || state.status === "importing"}
                    aria-label={`移除照片 ${photo.name}`}
                    onClick={() =>
                      void action(async () => {
                        setState(await window.matheca.mobileRemove(photo.id));
                      })
                    }
                  >
                    移除
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="mobile-received-empty">
              <h3>照片会出现在这里</h3>
              <p>在手机确认顺序并发送后，回到电脑开始识别。</p>
            </div>
          )}
        </section>
      </div>
      <footer className="mobile-import-footer">
        <p>
          每张最多 50 MB，每批合计最多 200
          MB。关闭面板会停止接收，未识别照片会保留，重新打开可继续。
        </p>
        <div className="button-row">
          <button disabled={busy} onClick={() => void close()}>
            结束接收
          </button>
          {!!state?.imported && (
            <button disabled={busy} onClick={() => void close(true)}>
              查看识别任务
            </button>
          )}
          <button
            className="primary"
            disabled={
              busy || !state?.files.length || state.status === "importing"
            }
            onClick={() =>
              void action(async () => {
                const count = await window.matheca.mobileConfirm();
                setState(await window.matheca.mobileStatus());
                setMessage(
                  `已将 ${count} 张照片加入识别任务，可继续接收下一批。`,
                );
              })
            }
          >
            {busy
              ? "正在处理…"
              : `开始识别${state?.files.length ? `（${state.files.length} 张）` : ""}`}
          </button>
        </div>
      </footer>
    </dialog>,
    document.body,
  );
}
