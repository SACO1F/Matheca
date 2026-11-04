use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
type Response = Result<Value, String>;
#[derive(Default)]
pub struct Replies(pub Mutex<HashMap<(String, String), mpsc::SyncSender<Response>>>);
#[tauri::command]
pub fn worker_reply(
    window: WebviewWindow,
    id: String,
    result: Value,
    error: Option<String>,
) -> Result<(), String> {
    if !window.label().starts_with("worker-") || id.len() > 64 {
        return Err("调用来源无效".into());
    }
    if let Some(sender) = window
        .state::<Replies>()
        .0
        .lock()
        .unwrap()
        .remove(&(window.label().into(), id))
    {
        let _ = sender.send(match error {
            Some(e) => Err(e.chars().take(500).collect()),
            None => Ok(result),
        });
    }
    Ok(())
}
pub struct Worker {
    app: tauri::AppHandle,
    label: String,
}
fn receive(rx: mpsc::Receiver<Response>, cancel: &AtomicBool) -> Response {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("任务已停止，可稍后继续".into());
        }
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(value) => return value,
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err("本地处理窗口已关闭".into()),
            _ if Instant::now() > deadline => return Err("本地图片或 PDF 处理超时，请重试".into()),
            _ => {}
        }
    }
}
impl Worker {
    pub fn window(&self) -> Result<WebviewWindow, String> {
        self.app
            .get_webview_window(&self.label)
            .ok_or("本地处理窗口已关闭".into())
    }
    pub fn document_size(&self) -> Result<(), String> {
        self.window()?
            .set_size(tauri::LogicalSize::new(3200., 3200.))
            .map_err(|e| e.to_string())
    }
    pub fn new(app: &tauri::AppHandle, cancel: &AtomicBool) -> Result<Self, String> {
        let label = format!("worker-{}", uuid::Uuid::new_v4());
        let worker = Self {
            app: app.clone(),
            label: label.clone(),
        };
        let (tx, rx) = mpsc::sync_channel(1);
        app.state::<Replies>()
            .0
            .lock()
            .unwrap()
            .insert((label.clone(), "ready".into()), tx);
        let handle = app.clone();
        app.run_on_main_thread(move || {
            let result = WebviewWindowBuilder::new(
                &handle,
                &label,
                WebviewUrl::App("tauri-worker.html".into()),
            )
            .title("Matheca 本地处理")
            .visible(false)
            .skip_taskbar(true)
            .inner_size(1400., 2000.)
            .data_directory(
                handle
                    .state::<crate::Runtime>()
                    .repository
                    .root
                    .join("webview-profile"),
            )
            .on_navigation(|url| {
                url.scheme() == "http" && url.host_str() == Some("tauri.localhost")
            })
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .build();
            if result.is_err() {
                if let Some(tx) = handle
                    .state::<Replies>()
                    .0
                    .lock()
                    .unwrap()
                    .remove(&(label, "ready".into()))
                {
                    let _ = tx.send(Err("无法创建本地处理窗口".into()));
                }
            }
        })
        .map_err(|e| e.to_string())?;
        receive(rx, cancel)?;
        Ok(worker)
    }
    pub fn call(&self, method: &str, args: Value, cancel: &AtomicBool) -> Response {
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::sync_channel(1);
        let key = (self.label.clone(), id.clone());
        self.app
            .state::<Replies>()
            .0
            .lock()
            .unwrap()
            .insert(key.clone(), tx);
        let result = (|| {
            let window = self
                .app
                .get_webview_window(&self.label)
                .ok_or("本地处理窗口已关闭")?;
            window
                .eval(format!(
                    "window.mathecaWorkerCall({},{},{})",
                    serde_json::to_string(&id).unwrap(),
                    serde_json::to_string(method).unwrap(),
                    args
                ))
                .map_err(|e| e.to_string())?;
            receive(rx, cancel)
        })();
        self.app.state::<Replies>().0.lock().unwrap().remove(&key);
        result
    }
}
impl Drop for Worker {
    fn drop(&mut self) {
        self.app
            .state::<Replies>()
            .0
            .lock()
            .unwrap()
            .retain(|(label, _), _| label != &self.label);
        if let Some(w) = self.app.get_webview_window(&self.label) {
            let _ = w.destroy();
        }
    }
}
