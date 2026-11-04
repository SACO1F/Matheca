import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MobileImportState } from "../shared/types";
import "./mobile-import.css";
import { LibraryExchangePanel } from "./library-exchange";

const mobileTabs = ["photos", "incoming", "library", "files", "tasks"] as const;
type MobileTab = (typeof mobileTabs)[number];

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
  const [tab, setTab] = useState<MobileTab>("photos");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [libraryFooter, setLibraryFooter] = useState<HTMLDivElement | null>(
    null,
  );
  useEffect(() => {
    let alive = true;
    let polling = false;
    dialog.current?.showModal();
    void window.matheca
      .mobileStart()
      .then((value) => {
        if (alive) {
          setState(value);
          if (value.libraries.some((item) => item.status === "received"))
            setTab("incoming");
        }
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
        onClose();
      }}
    >
      <header className="mobile-import-heading">
        <div>
          <h2 id="mobile-import-title">手机联动</h2>
          <p>
            连接同一网络，接收手机资料，或将题目与题集发送到手机。
          </p>
        </div>
        <button
          className="ghost"
          aria-label="收起手机联动面板"
          disabled={busy}
          onClick={onClose}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
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
          <div className="mobile-pairing-intro">
            <h3>连接手机</h3>
            <p className="hint">Android 打开“我的 → 连接电脑”扫码。</p>
          </div>
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
          <strong
            className="mobile-connection-status"
            data-connected={state?.connected && state?.pairing?.approved}
          >
            {state?.status === "receiving"
              ? state.connected
                ? state.pairing?.approved
                  ? "手机已连接"
                  : "等待电脑确认"
                : "等待手机扫码"
              : state?.status === "expired"
                ? "二维码已过期"
                : "尚未开启接收"}
          </strong>
          {state?.pairing && !state.pairing.approved && (
            <div className="mobile-approval">
              <p>
                请与手机核对：<strong>{state.pairing.code}</strong>
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    setState(
                      await window.matheca.mobileApprove(state.pairing!.id),
                    );
                  })
                }
              >
                允许连接
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    setState(
                      await window.matheca.mobileReject(state.pairing!.id),
                    );
                  })
                }
              >
                拒绝
              </button>
            </div>
          )}
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
            <>
              {state.urls.length === 1 && (
                <p className="mobile-host">
                  {new URL(state.urls[address]).host}
                </p>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await window.matheca.mobileCopyAddress(address);
                    setMessage(
                      "已复制完整连接地址，可在 Android 的“连接电脑”中粘贴。",
                    );
                  })
                }
              >
                复制连接地址
              </button>
            </>
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
          {!!state?.pairedDevices?.length && (
            <details>
              <summary>已配对手机（{state.pairedDevices.length}）</summary>
              <p className="hint">
                仅在电脑开启手机联动时允许再次连接。移除会立即撤销此手机的连接权限。
              </p>
              {state.pairedDevices.map((device) => (
                <div key={device.id} className="mobile-activity">
                  <strong>{device.name}</strong>
                  <p>核对码 {device.id.slice(-6).toUpperCase()}</p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        setState(
                          await window.matheca.mobileForgetDevice(device.id),
                        );
                      })
                    }
                  >
                    移除配对 · {device.id.slice(-6).toUpperCase()}
                  </button>
                </div>
              ))}
            </details>
          )}
          <p className="hint">
            若系统询问网络权限，请允许专用网络访问。校园 Wi-Fi
            若隔离设备，可换用允许设备互通的网络。
          </p>
        </section>
        <section className="mobile-received" aria-label="联动内容">
          <div
            className="mobile-tabs management-tabs"
            role="tablist"
            aria-label="联动内容"
            onKeyDown={(event) => {
              const keys = mobileTabs;
              const index = keys.indexOf(tab);
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % keys.length
                  : event.key === "ArrowLeft"
                    ? (index + keys.length - 1) % keys.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? keys.length - 1
                        : -1;
              if (next >= 0) {
                event.preventDefault();
                setTab(keys[next]);
                document.getElementById(`mobile-tab-${keys[next]}`)?.focus();
              }
            }}
          >
            {mobileTabs.map((key) => (
              <button
                key={key}
                role="tab"
                aria-label={
                  key === "incoming"
                    ? "来自手机"
                    : key === "library"
                      ? "题目与题库交换"
                      : undefined
                }
                tabIndex={tab === key ? 0 : -1}
                aria-selected={tab === key}
                aria-controls="mobile-tab-panel"
                id={`mobile-tab-${key}`}
                onClick={() => setTab(key)}
              >
                {key === "photos"
                  ? `收到的照片 (${state?.files.length || 0})`
                  : key === "tasks"
                    ? "本次识别"
                    : key === "files"
                      ? "题目资料"
                      : key === "incoming"
                        ? "来自手机"
                        : "题目与题库交换"}
                {key === "incoming" &&
                  !!state?.libraries.filter(
                    (item) => item.status === "received",
                  ).length && (
                    <span className="mobile-tab-count">
                      {
                        state.libraries.filter(
                          (item) => item.status === "received",
                        ).length
                      }
                    </span>
                  )}
              </button>
            ))}
          </div>
          <div
            id="mobile-tab-panel"
            className="mobile-tab-panel"
            role="tabpanel"
            aria-labelledby={`mobile-tab-${tab}`}
          >
            {(tab === "library" || tab === "incoming") && (
              <LibraryExchangePanel
                key={tab}
                mode={tab === "incoming" ? "incoming" : "outgoing"}
                onPrepared={() => {
                  setMessage(
                    "题库已准备好。请在手机的“连接电脑 → 接收题库”中点击下载并预览，再确认接收。",
                  );
                  setTab("files");
                }}
                footerHost={libraryFooter}
                state={state}
                busy={busy}
                action={action}
                refresh={async () => {
                  setState(await window.matheca.mobileStatus());
                }}
              />
            )}
            {tab === "tasks" && (
              <>
                <h3>本次连接的识别任务</h3>
                {!state?.tasks.length && (
                  <p className="hint">
                    尚未提交识别。收到照片后，在电脑点击“开始识别”。
                  </p>
                )}
                {state?.tasks.map((task, index) => (
                  <article className="mobile-activity" key={task.id}>
                    <strong>
                      第 {index + 1} 批 · {task.photos} 张
                    </strong>
                    <p>
                      {(
                        {
                          queued: "等待识别",
                          processing: "正在识别",
                          complete: "识别完成",
                          partial: "部分完成，请到任务页重试",
                          failed: "识别失败，请到任务页重试",
                          paused: "已暂停，请到任务页继续",
                        } as Record<string, string>
                      )[task.status] || "请到任务页查看"}{" "}
                      · {task.completed}/{task.total}
                    </p>
                  </article>
                ))}
              </>
            )}
            {tab === "files" && (
              <>
                <h3>题目资料</h3>
                <p className="hint">
                  已准备好发到手机的题目与题集。手机确认连接后即可下载，结束连接后下载链接失效。
                </p>
                {!state?.transfers.filter(
                  (file) =>
                    file.kind === "library" || /^题库资料-/.test(file.name),
                ).length && (
                  <p className="hint">
                    还没有发送的资料。请在“题目与题库交换”中选择题目或题集发送。
                  </p>
                )}
                {state?.transfers
                  .filter(
                    (file) =>
                      file.kind === "library" || /^题库资料-/.test(file.name),
                  )
                  .map((file) => (
                    <article className="mobile-activity" key={file.id}>
                      <strong>{file.name}</strong>
                      <p>
                        {(file.size / 1024 / 1024).toFixed(1)} MB ·{" "}
                        {
                          {
                            ready: "等待手机下载",
                            downloading: "正在传输",
                            transferred: "已传到手机浏览器",
                            failed: "传输失败，可在手机重试",
                          }[file.status]
                        }
                      </p>
                    </article>
                  ))}
              </>
            )}
            {tab === "photos" && (
              <>
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
                          <span>
                            {(photo.size / 1024 / 1024).toFixed(1)} MB
                          </span>
                        </div>
                        <button
                          disabled={busy || state.status === "importing"}
                          aria-label={`移除照片 ${photo.name}`}
                          onClick={() =>
                            void action(async () => {
                              setState(
                                await window.matheca.mobileRemove(photo.id),
                              );
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
              </>
            )}
          </div>
        </section>
      </div>
      <footer className="mobile-import-footer">
        <p>收起面板可继续收发；结束连接将停止收发。待接收资料会保留。</p>
        <div className="button-row">
          <button disabled={busy} onClick={() => void close()}>
            结束连接
          </button>
          {!!state?.imported && (
            <button disabled={busy} onClick={onTasks}>
              查看识别任务
            </button>
          )}
          {tab === "library" ? (
            <div ref={setLibraryFooter} />
          ) : tab === "photos" ? (
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
          ) : null}
        </div>
      </footer>
    </dialog>,
    document.body,
  );
}
