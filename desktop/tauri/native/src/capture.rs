use crate::{capture_native, media, Runtime};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::DynamicImage;
use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{
    Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
type R<T> = Result<T, String>;
#[derive(Clone, Copy)]
struct Bounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}
struct Frame {
    bounds: Bounds,
    image: DynamicImage,
    png: Vec<u8>,
}
struct Session {
    id: String,
    frames: HashMap<String, Frame>,
    loaded: HashSet<String>,
    shown: bool,
    focus: String,
    sender: mpsc::SyncSender<R<Option<Vec<u8>>>>,
}
#[derive(Default)]
pub struct Capture {
    gate: Mutex<()>,
    session: Mutex<Option<Session>>,
    epoch: AtomicU64,
    running: AtomicBool,
    restore_on_finish: AtomicBool,
    closing: AtomicBool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    viewport_width: f64,
    viewport_height: f64,
}
pub fn crop(image: &DynamicImage, r: &Rect, viewport: (f64, f64)) -> R<Vec<u8>> {
    let values = [
        r.x,
        r.y,
        r.width,
        r.height,
        r.viewport_width,
        r.viewport_height,
    ];
    if values.iter().any(|v| !v.is_finite())
        || r.width < 8.
        || r.height < 8.
        || r.x < 0.
        || r.y < 0.
        || r.viewport_width <= 0.
        || r.viewport_height <= 0.
        || r.x + r.width > r.viewport_width + 1.
        || r.y + r.height > r.viewport_height + 1.
    {
        return Err("请框选至少 8 × 8 像素的区域".into());
    }
    if (viewport.0 - r.viewport_width).abs() > 2. || (viewport.1 - r.viewport_height).abs() > 2. {
        return Err("截图窗口缩放已变化，请重新截图".into());
    }
    let width = image.width();
    let height = image.height();
    let x = ((r.x / r.viewport_width * width as f64).floor() as u32).min(width - 1);
    let y = ((r.y / r.viewport_height * height as f64).floor() as u32).min(height - 1);
    let w = ((r.width / r.viewport_width * width as f64).round() as u32)
        .max(1)
        .min(width - x);
    let h = ((r.height / r.viewport_height * height as f64).round() as u32)
        .max(1)
        .min(height - y);
    let png = media::png(&image.crop_imm(x, y, w, h))?;
    if png.len() as u64 > media::MAX_FILE {
        return Err("截图超过 50 MB，请缩小选区".into());
    }
    Ok(png)
}
fn frames(window: &WebviewWindow) -> R<Vec<Frame>> {
    let mut images = Vec::new();
    if let Some(fixture) = std::env::var_os("MATHECA_CAPTURE_FIXTURE") {
        if std::env::var_os("MATHECA_TEST_DATA").is_none() {
            return Err("截图测试图仅能在独立测试资料中使用".into());
        }
        let root = &window.state::<Runtime>().repository.root;
        let bytes = media::read_owned(root, std::path::Path::new(&fixture))?;
        if bytes.len() > 65536 {
            return Err("截图测试配置过大".into());
        }
        let config: Value = serde_json::from_slice(&bytes).map_err(|_| "截图测试配置无效")?;
        let a = config
            .as_array()
            .filter(|a| !a.is_empty() && a.len() <= 8)
            .ok_or("测试显示器数量无效")?;
        for f in a {
            let file = f["file"].as_str().ok_or("测试图路径无效")?;
            let image = media::decode(&media::read_owned(root, &root.join(file))?)?;
            let x = f["x"]
                .as_i64()
                .and_then(|v| i32::try_from(v).ok())
                .ok_or("测试位置无效")?;
            let y = f["y"]
                .as_i64()
                .and_then(|v| i32::try_from(v).ok())
                .ok_or("测试位置无效")?;
            images.push((
                Bounds {
                    x,
                    y,
                    width: image.width(),
                    height: image.height(),
                },
                image,
            ));
        }
    } else {
        let monitors = window
            .available_monitors()
            .map_err(|_| "无法读取显示器列表")?;
        if monitors.is_empty() || monitors.len() > 8 {
            return Err("截图支持 1–8 个显示器".into());
        }
        let pixels = monitors
            .iter()
            .map(|m| u64::from(m.size().width) * u64::from(m.size().height) * 4)
            .sum::<u64>();
        if pixels > 256 * 1024 * 1024 {
            return Err("屏幕总像素过大，请降低分辨率后重试".into());
        }
        for m in monitors {
            let pos = m.position();
            let size = m.size();
            images.push((
                Bounds {
                    x: pos.x,
                    y: pos.y,
                    width: size.width,
                    height: size.height,
                },
                capture_native::screen(pos.x, pos.y, size.width, size.height)?,
            ));
        }
    }
    let mut total = 0;
    let mut encoded = 0;
    images
        .into_iter()
        .map(|(bounds, image)| {
            media::dimensions(bounds.width, bounds.height)?;
            bounds
                .x
                .checked_add(bounds.width as i32)
                .ok_or("屏幕位置无效")?;
            bounds
                .y
                .checked_add(bounds.height as i32)
                .ok_or("屏幕位置无效")?;
            total += u64::from(bounds.width) * u64::from(bounds.height) * 4;
            if total > 256 * 1024 * 1024 {
                return Err("屏幕总像素过大".into());
            }
            let png = media::png(&image)?;
            encoded += png.len();
            if png.len() as u64 > media::MAX_FILE || encoded > 128 * 1024 * 1024 {
                return Err("屏幕图像过大，请降低分辨率后重试".into());
            }
            Ok(Frame { bounds, image, png })
        })
        .collect()
}
impl Capture {
    fn complete(&self, app: &tauri::AppHandle, id: Option<&str>, result: R<Option<Vec<u8>>>) {
        let session = {
            let mut active = self.session.lock().unwrap();
            if id.is_some_and(|id| active.as_ref().is_none_or(|s| s.id != id)) {
                return;
            }
            active.take()
        };
        if let Some(s) = session {
            for label in s.frames.keys() {
                if let Some(w) = app.get_webview_window(label) {
                    let _ = w.destroy();
                }
            }
            let _ = s.sender.send(result);
        }
    }
    pub fn cancel_for_close(&self, app: &tauri::AppHandle) -> bool {
        let active = self.running.load(Ordering::SeqCst);
        self.restore_on_finish.store(false, Ordering::SeqCst);
        self.cancel(app);
        active
    }
    pub fn cancel(&self, app: &tauri::AppHandle) {
        self.epoch.fetch_add(1, Ordering::SeqCst);
        self.complete(app, None, Ok(None));
    }
    fn cancel_window(&self, window: &WebviewWindow) -> R<()> {
        let id = self
            .session
            .lock()
            .unwrap()
            .as_ref()
            .filter(|s| s.frames.contains_key(window.label()))
            .map(|s| s.id.clone())
            .ok_or("截图窗口已关闭")?;
        self.epoch.fetch_add(1, Ordering::SeqCst);
        self.complete(window.app_handle(), Some(&id), Ok(None));
        Ok(())
    }
    pub fn stop(&self, app: &tauri::AppHandle) {
        self.closing.store(true, Ordering::SeqCst);
        self.cancel(app)
    }
    pub fn reset(&self) {
        self.closing.store(false, Ordering::SeqCst)
    }
    pub fn capture(&self, window: &WebviewWindow) -> R<Option<Vec<u8>>> {
        let _gate = self.gate.try_lock().map_err(|_| "截图正在进行中")?;
        if self.closing.load(Ordering::SeqCst) {
            return Err("应用正在退出".into());
        }
        self.running.store(true, Ordering::SeqCst);
        self.restore_on_finish.store(true, Ordering::SeqCst);
        let epoch = self.epoch.load(Ordering::SeqCst);
        struct Restore<'a> {
            capture: &'a Capture,
            app: tauri::AppHandle,
        }
        impl Drop for Restore<'_> {
            fn drop(&mut self) {
                self.capture.complete(&self.app, None, Ok(None));
                self.capture.running.store(false, Ordering::SeqCst);
                if !self.capture.closing.load(Ordering::SeqCst)
                    && self.capture.restore_on_finish.load(Ordering::SeqCst)
                {
                    crate::show(&self.app);
                }
            }
        }
        let _restore = Restore {
            capture: self,
            app: window.app_handle().clone(),
        };
        window.hide().map_err(|_| "无法隐藏工作台")?;
        std::thread::sleep(Duration::from_millis(180));
        if self.epoch.load(Ordering::SeqCst) != epoch {
            return Ok(None);
        }
        unsafe {
            let _ = windows::Win32::Graphics::Dwm::DwmFlush();
        }
        let images = frames(window)?;
        if self.epoch.load(Ordering::SeqCst) != epoch {
            return Ok(None);
        }
        let (sender, rx) = mpsc::sync_channel(1);
        let id = uuid::Uuid::new_v4().to_string();
        let mut entries = HashMap::new();
        let mut specs = Vec::new();
        for image in images {
            let label = format!("capture-{}", uuid::Uuid::new_v4());
            specs.push((label.clone(), image.bounds));
            entries.insert(label, image);
        }
        let mut focus = specs[0].0.clone();
        let mut point = windows::Win32::Foundation::POINT::default();
        if unsafe { windows::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut point) }.is_ok() {
            if let Some((label, _)) = specs.iter().find(|(_, b)| {
                point.x >= b.x
                    && point.y >= b.y
                    && i64::from(point.x) < i64::from(b.x) + i64::from(b.width)
                    && i64::from(point.y) < i64::from(b.y) + i64::from(b.height)
            }) {
                focus = label.clone();
            }
        }
        *self.session.lock().unwrap() = Some(Session {
            id: id.clone(),
            frames: entries,
            loaded: HashSet::new(),
            shown: false,
            focus,
            sender,
        });
        let app = window.app_handle().clone();
        let session_id = id.clone();
        window
            .app_handle()
            .run_on_main_thread(move || {
                let result = (|| -> R<()> {
                    for (label, bounds) in specs {
                        if app
                            .state::<Runtime>()
                            .capture
                            .session
                            .lock()
                            .unwrap()
                            .as_ref()
                            .is_none_or(|s| s.id != session_id)
                        {
                            return Ok(());
                        }
                        let w = WebviewWindowBuilder::new(
                            &app,
                            &label,
                            WebviewUrl::App("tauri-capture.html".into()),
                        )
                        .title("Matheca 截图导入")
                        .visible(false)
                        .decorations(false)
                        .resizable(false)
                        .maximizable(false)
                        .minimizable(false)
                        .skip_taskbar(true)
                        .always_on_top(true)
                        .data_directory(
                            app.state::<Runtime>()
                                .repository
                                .root
                                .join("webview-profile"),
                        )
                        .on_navigation(|u| {
                            u.scheme() == "http" && u.host_str() == Some("tauri.localhost")
                        })
                        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                        .build()
                        .map_err(|_| "无法创建截图选区窗口")?;
                        let closing = w.clone();
                        w.on_window_event(move |event| match event {
                            tauri::WindowEvent::CloseRequested { api, .. } => {
                                api.prevent_close();
                                let _ = closing.state::<Runtime>().capture.cancel_window(&closing);
                            }
                            tauri::WindowEvent::Destroyed => {
                                let _ = closing.state::<Runtime>().capture.cancel_window(&closing);
                            }
                            _ => {}
                        });
                        w.set_position(PhysicalPosition::new(bounds.x, bounds.y))
                            .map_err(|_| "无法定位截图窗口")?;
                        w.set_size(PhysicalSize::new(bounds.width, bounds.height))
                            .map_err(|_| "无法调整截图窗口")?;
                        w.set_fullscreen(true)
                            .map_err(|_| "无法覆盖显示器，请重试截图")?;
                        if app
                            .state::<Runtime>()
                            .capture
                            .session
                            .lock()
                            .unwrap()
                            .as_ref()
                            .is_none_or(|s| s.id != session_id)
                        {
                            let _ = w.destroy();
                            return Ok(());
                        }
                    }
                    Ok(())
                })();
                if let Err(e) = result {
                    app.state::<Runtime>()
                        .capture
                        .complete(&app, Some(&session_id), Err(e));
                }
            })
            .map_err(|_| "无法启动截图窗口")?;
        let ready = Instant::now() + Duration::from_secs(25);
        let deadline = Instant::now() + Duration::from_secs(300);
        loop {
            if self.epoch.load(Ordering::SeqCst) != epoch || self.closing.load(Ordering::SeqCst) {
                return Ok(None);
            }
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(result) => return result,
                Err(mpsc::RecvTimeoutError::Disconnected) => return Err("截图窗口已关闭".into()),
                _ => {}
            }
            if Instant::now() > deadline {
                return Err("截图等待超时，已返回工作台".into());
            }
            if Instant::now() > ready
                && self
                    .session
                    .lock()
                    .unwrap()
                    .as_ref()
                    .is_some_and(|s| !s.shown)
            {
                return Err("截图窗口加载超时，已返回工作台".into());
            }
        }
    }
    fn ready(&self, window: &WebviewWindow) -> R<String> {
        let active = self.session.lock().unwrap();
        let frame = active
            .as_ref()
            .and_then(|s| s.frames.get(window.label()))
            .ok_or("调用来源无效或截图已结束")?;
        Ok(format!(
            "data:image/png;base64,{}",
            STANDARD.encode(&frame.png)
        ))
    }
    fn loaded(&self, window: &WebviewWindow) -> R<()> {
        let show = {
            let mut active = self.session.lock().unwrap();
            let s = active
                .as_mut()
                .filter(|s| s.frames.contains_key(window.label()))
                .ok_or("截图已结束")?;
            s.loaded.insert(window.label().into());
            if s.loaded.len() == s.frames.len() && !s.shown {
                s.shown = true;
                Some((
                    s.id.clone(),
                    s.frames.keys().cloned().collect::<Vec<_>>(),
                    s.focus.clone(),
                ))
            } else {
                None
            }
        };
        if let Some((id, labels, focus)) = show {
            for label in labels {
                let Some(w) = window.app_handle().get_webview_window(&label) else {
                    self.complete(window.app_handle(), Some(&id), Err("截图窗口已关闭".into()));
                    return Ok(());
                };
                if w.show().is_err() {
                    self.complete(
                        window.app_handle(),
                        Some(&id),
                        Err("无法显示截图窗口".into()),
                    );
                    return Ok(());
                }
            }
            if let Some(w) = window.app_handle().get_webview_window(&focus) {
                let _ = w.set_focus();
            }
        }
        Ok(())
    }
    fn confirm(&self, window: &WebviewWindow, rect: &Rect) -> R<()> {
        let (id, png) = {
            let active = self.session.lock().unwrap();
            let s = active.as_ref().ok_or("截图已结束")?;
            let f = s.frames.get(window.label()).ok_or("调用来源无效")?;
            let size = window.inner_size().map_err(|_| "截图窗口已关闭")?;
            let scale = window.scale_factor().map_err(|_| "无法读取窗口缩放")?;
            let png = crop(
                &f.image,
                rect,
                (size.width as f64 / scale, size.height as f64 / scale),
            )?;
            (s.id.clone(), png)
        };
        self.complete(window.app_handle(), Some(&id), Ok(Some(png)));
        Ok(())
    }
}
#[tauri::command]
pub async fn capture_ready(window: WebviewWindow) -> R<String> {
    tauri::async_runtime::spawn_blocking(move || window.state::<Runtime>().capture.ready(&window))
        .await
        .map_err(|_| "截图读取失败".to_string())?
}
#[tauri::command]
pub async fn capture_loaded(window: WebviewWindow) -> R<()> {
    window.state::<Runtime>().capture.loaded(&window)
}
#[tauri::command]
pub async fn capture_confirm(window: WebviewWindow, rect: Rect) -> R<()> {
    tauri::async_runtime::spawn_blocking(move || {
        window.state::<Runtime>().capture.confirm(&window, &rect)
    })
    .await
    .map_err(|_| "截图裁剪失败".to_string())?
}
#[tauri::command]
pub fn capture_cancel(window: WebviewWindow) -> R<()> {
    window.state::<Runtime>().capture.cancel_window(&window)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn rect() -> Rect {
        Rect {
            x: 10.,
            y: 8.,
            width: 30.,
            height: 20.,
            viewport_width: 100.,
            viewport_height: 80.,
        }
    }
    #[test]
    fn crop_maps_scaled_viewports_to_physical_pixels() {
        let mut img = image::RgbaImage::new(200, 160);
        for (x, y, p) in img.enumerate_pixels_mut() {
            *p = image::Rgba([x as u8, y as u8, 99, 255]);
        }
        let bytes = crop(&DynamicImage::ImageRgba8(img), &rect(), (100., 80.)).unwrap();
        let crop = media::decode(&bytes).unwrap().to_rgba8();
        assert_eq!(crop.dimensions(), (60, 40));
        assert_eq!(crop.get_pixel(0, 0).0, [20, 16, 99, 255]);
        assert_eq!(crop.get_pixel(59, 39).0, [79, 55, 99, 255]);
    }
    #[test]
    fn invalid_small_nonfinite_and_changed_viewports_reject() {
        let img = DynamicImage::new_rgb8(200, 160);
        for r in [
            Rect {
                width: 7.,
                ..rect()
            },
            Rect { x: -1., ..rect() },
            Rect {
                width: f64::NAN,
                ..rect()
            },
            Rect {
                width: 200.,
                ..rect()
            },
        ] {
            assert!(crop(&img, &r, (100., 80.)).is_err())
        }
        assert!(crop(&img, &rect(), (200., 160.)).is_err());
    }
}
