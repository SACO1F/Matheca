use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};
use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, CapturePreviewCompletedHandler};
use windows::{
    core::HSTRING,
    Win32::{
        System::Com::{STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET},
        UI::Shell::SHCreateMemStream,
    },
};
type R<T> = Result<T, String>;
fn receive(rx: mpsc::Receiver<R<Vec<u8>>>, cancel: &AtomicBool) -> R<Vec<u8>> {
    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("应用正在退出，已停止生成文档".into());
        }
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(v) => return v,
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err("文档处理窗口已关闭".into()),
            _ if Instant::now() > deadline => return Err("WebView2 文档处理超时，请重试".into()),
            _ => {}
        }
    }
}
pub fn pdf(window: &WebviewWindow, cancel: &AtomicBool) -> R<Vec<u8>> {
    let (tx, rx) = mpsc::sync_channel(1);
    window.with_webview(move|webview|{
   let immediate=tx.clone();let result=(||->windows::core::Result<()>{unsafe{
     let handler=CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move|status,response|{
       let result=(||{status.map_err(|_|"WebView2 不支持当前 PDF 输出，请更新 WebView2")?;if response.len()>48*1024*1024{return Err("PDF 超过 32 MiB，请拆分题集".into())}let payload:Value=serde_json::from_str(&response).map_err(|_|"PDF 返回格式无效")?;let data=payload["data"].as_str().ok_or("WebView2 未返回 PDF 数据，请更新运行时")?;let bytes=STANDARD.decode(data).map_err(|_|"PDF 数据无效")?;if bytes.len()>32*1024*1024||!bytes.starts_with(b"%PDF-"){return Err("PDF 数据无效或超过 32 MiB".into())}
if !bytes.windows(15).any(|s|s==b"/StructTreeRoot"){return Err("当前 WebView2 未生成 PDF 结构标签，请更新运行时后重试".into())}Ok(bytes)})();let _=tx.send(result);Ok(())
     }));
     let options=json!({"printBackground":true,"displayHeaderFooter":false,"paperWidth":210.0/25.4,"paperHeight":297.0/25.4,"preferCSSPageSize":true,"generateTaggedPDF":true});
     webview.controller().CoreWebView2()?.CallDevToolsProtocolMethod(&HSTRING::from("Page.printToPDF"),&HSTRING::from(options.to_string()),&handler)?;
   }Ok(())})();if let Err(e)=result{let _=immediate.send(Err(format!("WebView2 PDF 输出失败：{e}")));}
 }).map_err(|e|e.to_string())?;
    receive(rx, cancel)
}
pub fn formula(
    window: &WebviewWindow,
    meta: &Value,
    viewport: &Value,
    cancel: &AtomicBool,
) -> R<Vec<u8>> {
    let rect = &meta["rect"];
    let v = [
        rect["x"].as_f64(),
        rect["y"].as_f64(),
        rect["width"].as_f64(),
        rect["height"].as_f64(),
        viewport["width"].as_f64(),
    ];
    let [Some(x), Some(y), Some(width), Some(height), Some(viewport_width)] = v else {
        return Err("公式位置无效".into());
    };
    if ![x, y, width, height, viewport_width]
        .iter()
        .all(|n| n.is_finite())
        || x < 0.
        || y < 0.
        || width <= 0.
        || height <= 0.
        || width > 3000.
        || height > 3000.
        || viewport_width < 1.
    {
        return Err("公式尺寸无效或过大".into());
    }
    let (tx, rx) = mpsc::sync_channel(1);
    window
        .with_webview(move |webview| {
            let immediate = tx.clone();
            let result = (|| -> windows::core::Result<()> {
                unsafe {
                    let stream =
                        SHCreateMemStream(None).ok_or_else(windows::core::Error::from_thread)?;
                    let keep = stream.clone();
                    let handler = CapturePreviewCompletedHandler::create(Box::new(move |status| {
                        let result = (|| {
                            status.map_err(|_| "无法捕获公式图片")?;
                            let mut stat = STATSTG::default();
                            keep.Stat(&mut stat, STATFLAG_NONAME)
                                .map_err(|_| "无法读取公式图片")?;
                            if stat.cbSize > 50 * 1024 * 1024 {
                                return Err("公式截图过大".into());
                            }
                            keep.Seek(0, STREAM_SEEK_SET, None)
                                .map_err(|_| "无法读取公式图片")?;
                            let mut bytes = vec![0; stat.cbSize as usize];
                            let mut read = 0;
                            keep.Read(
                                bytes.as_mut_ptr().cast(),
                                bytes.len() as u32,
                                Some(&mut read),
                            )
                            .ok()
                            .map_err(|_| "无法读取公式图片")?;
                            if read as usize != bytes.len() {
                                return Err("公式图片不完整".into());
                            }
                            Ok(bytes)
                        })();
                        let _ = tx.send(result);
                        Ok(())
                    }));
                    webview.controller().CoreWebView2()?.CapturePreview(
                        COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                        &stream,
                        &handler,
                    )?;
                }
                Ok(())
            })();
            if let Err(e) = result {
                let _ = immediate.send(Err(format!("公式捕获失败：{e}")));
            }
        })
        .map_err(|e| e.to_string())?;
    let bytes = receive(rx, cancel)?;
    let image = crate::media::decode(&bytes)?;
    let scale = f64::from(image.width()) / viewport_width;
    let left = (x * scale).floor() as u32;
    let top = (y * scale).floor() as u32;
    let w = (width * scale).ceil() as u32;
    let h = (height * scale).ceil() as u32;
    if w == 0
        || h == 0
        || left.checked_add(w).is_none_or(|n| n > image.width())
        || top.checked_add(h).is_none_or(|n| n > image.height())
    {
        return Err("公式超出截图范围".into());
    }
    crate::media::png(&image.crop_imm(left, top, w, h))
}
