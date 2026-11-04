#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod backups;
mod capture;
mod capture_native;
mod crypto;
mod data;
#[cfg(test)]
mod data_tests;
mod database;
mod document_native;
mod documents;
mod docx;
mod guide;
mod jobs;
mod lifecycle;
mod media;
mod migration;
mod mobile;
mod mobile_http;
mod model;
mod network;
mod repository;
mod tasks_store;
mod worker;

use lifecycle::{Action, Lifecycle};
use repository::Repository;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager, WebviewWindow};

#[derive(Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct Preferences {
    color_theme: String,
    close_action: String,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            color_theme: "GRAPHITE".into(),
            close_action: "ask".into(),
        }
    }
}
struct Runtime {
    repository: Repository,
    documents: documents::Documents,
    backups: backups::Backups,
    mobile: std::sync::Arc<mobile::Mobile>,
    capture: capture::Capture,
    jobs: std::sync::Arc<jobs::Engine>,
    preferences: Mutex<Preferences>,
    lifecycle: Mutex<Lifecycle>,
}
const IMPLEMENTED: &[&str] = &[
    "library:state",
    "history:list",
    "settings:color-theme",
    "settings:close-action",
    "question:manual-prompt",
    "window:close-choice",
    "question:save",
    "question:undo-review",
    "question:delete",
    "deletion:undo",
    "library:examples",
    "collection:save",
    "collection:delete",
    "collection:add",
    "collection:add-undoable",
    "collection:undo-addition",
    "collection:reorder",
    "collection:remove",
    "knowledge:add",
    "history:record",
    "settings:save",
    "settings:test",
    "intake:choose",
    "intake:drop",
    "intake:paste",
    "job:resume",
    "job:cancel",
    "question:solve",
    "question:crop",
    "collection:preview",
    "collection:export",
    "export:open",
    "backup:inspect",
    "backup:restore",
    "backup:dismiss",
    "backup:export",
    "mobile:start",
    "mobile:status",
    "mobile:pause",
    "mobile:forget-device",
    "mobile:copy-address",
    "mobile:remove",
    "mobile:confirm",
    "mobile:approve",
    "mobile:reject",
    "mobile:share",
    "mobile:send-library",
    "mobile:inspect-library",
    "mobile:apply-library",
    "mobile:discard-library",
    "intake:capture",
    "guide:open",
    "guide:copy",
];
fn error(code: &str, message: impl ToString) -> Value {
    json!({"ok":false,"code":code,"error":message.to_string()})
}
fn ok(data: Value) -> Value {
    json!({"ok":true,"data":data})
}
fn emit(window: &WebviewWindow, event: &str, payload: Value) -> Result<(), String> {
    window.emit(event, payload).map_err(|e| e.to_string())
}
fn show(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_skip_taskbar(false);
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
fn execute(window: &WebviewWindow, action: Action) -> Result<(), String> {
    match action {
        Action::None => {}
        Action::Choose => {
            emit(window, "window:close-choice", json!(true))?;
        }
        Action::Hide => {
            window.hide().map_err(|e| e.to_string())?;
            window.set_skip_taskbar(true).map_err(|e| e.to_string())?;
        }
        Action::Exit => {
            let app = window.app_handle().clone();
            std::thread::spawn(move || {
                app.state::<Runtime>().capture.stop(&app);
                app.state::<Runtime>().documents.stop();
                app.state::<Runtime>().backups.stop();
                app.state::<Runtime>().mobile.stop();
                let result = app.state::<Runtime>().jobs.stop(&app);
                if let Err(error) = result {
                    app.state::<Runtime>().capture.reset();
                    app.state::<Runtime>().mobile.reset();
                    app.state::<Runtime>().documents.reset();
                    app.state::<Runtime>().backups.reset();
                    app.state::<Runtime>().lifecycle.lock().unwrap().quitting = false;
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = emit(
                            &w,
                            "bridge:error",
                            json!(format!("任务进度保存失败，已取消退出：{error}")),
                        );
                    }
                } else {
                    app.exit(0);
                }
            });
        }
        Action::Prepare(request) => {
            show(window.app_handle());
            if let Err(e) = emit(window, "window:before-close", json!({"request":request})) {
                window
                    .state::<Runtime>()
                    .lifecycle
                    .lock()
                    .unwrap()
                    .acknowledge(request, false);
                return Err(e);
            }
            let app = window.app_handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(15));
                if app
                    .state::<Runtime>()
                    .lifecycle
                    .lock()
                    .unwrap()
                    .timeout(request)
                {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = emit(
                            &w,
                            "bridge:error",
                            json!("界面尚未确认保存，已取消退出。请检查未保存内容后重试。"),
                        );
                    }
                }
            });
        }
    }
    Ok(())
}
fn request_close(window: &WebviewWindow) {
    if window
        .state::<Runtime>()
        .capture
        .cancel_for_close(window.app_handle())
    {
        show(window.app_handle());
    }
    let runtime = window.state::<Runtime>();
    let preference = runtime.preferences.lock().unwrap().close_action.clone();
    let action = runtime.lifecycle.lock().unwrap().request(&preference);
    if let Err(e) = execute(window, action) {
        let _ = emit(window, "bridge:error", json!(e));
    }
}
fn save_preferences(runtime: &Runtime, preferences: &Preferences) -> Result<(), String> {
    let file = runtime.repository.root.join("preview-settings.json");
    let temp = file.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(
        &temp,
        serde_json::to_vec_pretty(preferences).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(temp, file).map_err(|e| e.to_string())
}
#[tauri::command]
fn bootstrap(window: WebviewWindow, runtime: tauri::State<'_, Runtime>) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("调用来源无效".into());
    }
    let contract: Value =
        serde_json::from_str(include_str!("../../../src/shared/desktop-channels.json")).unwrap();
    Ok(
        json!({"runtime":"tauri","phase":9,"readOnly":false,"hasLibrary":runtime.repository.root.join("library.sqlite").is_file(),"implemented":IMPLEMENTED,"deferred":contract.as_object().unwrap().values().filter(|v|!IMPLEMENTED.contains(&v.as_str().unwrap())).collect::<Vec<_>>(),"version":env!("CARGO_PKG_VERSION")}),
    )
}
#[tauri::command]
fn frontend_ready(window: WebviewWindow, runtime: tauri::State<'_, Runtime>) -> Result<(), String> {
    if window.label() != "main" {
        return Err("调用来源无效".into());
    }
    runtime.lifecycle.lock().unwrap().ready = true;
    Ok(())
}
#[tauri::command]
async fn choose_legacy_copy(window: WebviewWindow) -> Result<Option<Value>, String> {
    if window.label() != "main" {
        return Err("调用来源无效".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let mut picker = window
            .app_handle()
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("选择原版 Matheca 或 Mathector 资料目录");
        if let Some(appdata) = std::env::var_os("APPDATA") {
            for name in ["Matheca", "Mathector"] {
                let candidate = std::path::PathBuf::from(&appdata).join(name);
                if candidate.join("library.sqlite").is_file() {
                    picker = picker.set_directory(candidate);
                    break;
                }
            }
        }
        let source = picker.blocking_pick_folder();
        let Some(source) = source else {
            return Ok(None);
        };
        let source = source.into_path().map_err(|_| "目录路径无效")?;
        let value = window.state::<Runtime>().repository.copy_legacy(&source)?;
        let _ = emit(&window, "state:changed", Value::Null);
        let _ = emit(&window, "history:changed", Value::Null);
        Ok(Some(value))
    })
    .await
    .map_err(|_| "题库复制未完成，请重试".to_string())?
}
#[tauri::command]
async fn desktop_call(window: WebviewWindow, channel: String, args: Vec<Value>) -> Value {
    if window.label() != "main" {
        return error("UNTRUSTED", "调用来源无效");
    }
    let result =
        tauri::async_runtime::spawn_blocking(move || dispatch(&window, &channel, &args)).await;
    match result {
        Ok(value) => value,
        Err(_) => error("INTERNAL", "操作未完成，请重试"),
    }
}
fn dispatch(window: &WebviewWindow, channel: &str, args: &[Value]) -> Value {
    let runtime = window.state::<Runtime>();
    let result = (|| -> Result<Value, String> {
        match channel {
            "intake:capture" => {
                network::config(&runtime.repository)?;
                let Some(png) = runtime.capture.capture(window)? else {
                    return Ok(Value::Null);
                };
                let own = backups::Owned::new(&runtime.repository.root, "backup-staging")?;
                let file = own.path.join(format!("截图-{}.png", model::now()));
                std::fs::write(&file, png).map_err(|_| "无法保存截图，请检查磁盘空间")?;
                runtime.jobs.intake(window.app_handle(), &[file], None)?;
                Ok(json!(true))
            }
            "guide:open" | "guide:copy" => guide::action(
                &runtime.repository.root,
                if channel == "guide:open" {
                    "open"
                } else {
                    "copy"
                },
                model::string(args.first().ok_or("帮助项目无效")?, 40)?,
            ),
            "mobile:start" => runtime.mobile.start(window),
            "mobile:status" => runtime.mobile.state(&runtime.repository),
            "mobile:pause" => {
                runtime.mobile.pause();
                Ok(Value::Null)
            }
            "mobile:copy-address" => runtime
                .mobile
                .copy_address(args.first().and_then(Value::as_u64).ok_or("网络序号无效")? as usize),
            "mobile:remove" | "mobile:approve" | "mobile:reject" | "mobile:forget-device" => {
                runtime.mobile.control(
                    &runtime.repository,
                    channel,
                    model::id(args.first().ok_or("编号无效")?)?,
                )
            }
            "mobile:confirm" => runtime.mobile.confirm(window.app_handle()),
            "mobile:share" => runtime.mobile.share(
                window,
                std::path::Path::new(model::string(args.first().ok_or("文档路径无效")?, 32768)?),
            ),
            "mobile:send-library" => runtime
                .mobile
                .send_library(window, args.first().ok_or("请选择题目或题集")?),
            "mobile:inspect-library" => runtime
                .mobile
                .inspect_library(window, model::id(args.first().ok_or("资料编号无效")?)?),
            "mobile:apply-library" => runtime.mobile.apply_library(
                window,
                model::id(args.first().ok_or("资料编号无效")?)?,
                model::string(args.get(1).ok_or("处理方式无效")?, 10)?,
            ),
            "mobile:discard-library" => runtime.mobile.discard_library(
                &runtime.repository,
                model::id(args.first().ok_or("资料编号无效")?)?,
            ),
            "backup:inspect" => runtime.backups.choose(window),
            "backup:export" => runtime.backups.export(window),
            "backup:restore" => runtime
                .backups
                .restore(window, model::id(args.first().ok_or("预览编号无效")?)?),
            "backup:dismiss" => runtime
                .backups
                .dismiss(model::id(args.first().ok_or("预览编号无效")?)?),
            "collection:preview" => runtime
                .documents
                .preview(window, model::id(args.first().ok_or("题集编号无效")?)?),
            "collection:export" => runtime.documents.export(
                window,
                model::id(args.first().ok_or("题集编号无效")?)?,
                model::string(args.get(1).ok_or("导出格式无效")?, 10)?,
            ),
            "export:open" => runtime.documents.open(std::path::Path::new(model::string(
                args.first().ok_or("文档路径无效")?,
                32768,
            )?)),
            "settings:test" => {
                let cancel = std::sync::atomic::AtomicBool::new(false);
                let config = network::config(&runtime.repository)?;
                let image = image::DynamicImage::new_rgb8(32, 32);
                use base64::Engine;
                let photo = format!(
                    "data:image/png;base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(media::png(&image)?)
                );
                let text =
                    network::complete(&config, "请描述图片的颜色，简短回答。", &[photo], &cancel)?;
                Ok(json!(format!(
                    "图片接口测试成功：{}",
                    text.chars().take(200).collect::<String>()
                )))
            }
            "job:resume" | "job:cancel" | "question:solve" => {
                let id = model::id(args.first().ok_or("缺少任务或题目编号")?)?;
                match channel {
                    "job:resume" => runtime.jobs.resume(window.app_handle(), id)?,
                    "job:cancel" => runtime.jobs.cancel(window.app_handle(), id)?,
                    _ => runtime.jobs.solve(window.app_handle(), id)?,
                };
                Ok(Value::Null)
            }
            "intake:choose" => {
                use tauri_plugin_dialog::DialogExt;
                if let Some(files) = window
                    .app_handle()
                    .dialog()
                    .file()
                    .set_parent(window)
                    .set_title("选择图片或 PDF")
                    .add_filter(
                        "图片和 PDF",
                        &["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf"],
                    )
                    .blocking_pick_files()
                {
                    let paths = files
                        .into_iter()
                        .map(|f| f.into_path().map_err(|_| "文件路径无效".to_string()))
                        .collect::<Result<Vec<_>, _>>()?;
                    runtime.jobs.intake(window.app_handle(), &paths, None)?;
                }
                Ok(Value::Null)
            }
            "intake:drop" => {
                let paths = args
                    .first()
                    .and_then(Value::as_array)
                    .filter(|a| !a.is_empty() && a.len() <= 20)
                    .ok_or("一次最多导入 20 个文件")?
                    .iter()
                    .map(|v| model::string(v, 32768).map(PathBuf::from))
                    .collect::<Result<Vec<_>, _>>()?;
                if paths.iter().any(|p| media::extension(p) == "zip") {
                    if paths.len() != 1 {
                        return Err("题库 ZIP 请单独拖入".into());
                    }
                    return runtime.backups.inspect(window, &paths[0]);
                }
                runtime.jobs.intake(window.app_handle(), &paths, None)?;
                Ok(Value::Null)
            }
            "intake:begin" => Ok(json!(runtime
                .jobs
                .upload_begin(&runtime.repository, args.first().ok_or("文件列表无效")?)?)),
            "intake:chunk" => {
                runtime.jobs.upload_chunk(
                    model::string(args.first().ok_or("上传编号无效")?, 128)?,
                    args.get(1).and_then(Value::as_u64).ok_or("文件序号无效")? as usize,
                    args.get(2).and_then(Value::as_u64).ok_or("文件偏移无效")?,
                    model::string(args.get(3).ok_or("文件内容无效")?, 1_400_000)?,
                )?;
                Ok(Value::Null)
            }
            "intake:commit" => {
                let labels = args
                    .get(1)
                    .and_then(Value::as_array)
                    .filter(|a| a.len() <= 20)
                    .ok_or("文件名称无效")?
                    .iter()
                    .map(|v| model::string(v, 256).map(str::to_owned))
                    .collect::<Result<Vec<_>, _>>()?;
                let result = runtime.jobs.upload_finish(
                    window.app_handle(),
                    model::string(args.first().ok_or("上传编号无效")?, 128)?,
                    labels,
                )?;
                Ok(result)
            }
            "intake:discard" => {
                runtime
                    .jobs
                    .upload_discard(model::string(args.first().ok_or("上传编号无效")?, 128)?);
                Ok(Value::Null)
            }
            "intake:paste" => {
                let png = media::clipboard()?;
                let folder = runtime.repository.root.join("clipboard");
                std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
                let file = folder.join(format!("{}.png", uuid::Uuid::new_v4()));
                std::fs::write(&file, png).map_err(|e| e.to_string())?;
                let result = runtime.jobs.intake(
                    window.app_handle(),
                    std::slice::from_ref(&file),
                    Some(vec!["剪贴板图片.png".into()]),
                );
                let _ = std::fs::remove_file(file);
                result?;
                Ok(Value::Null)
            }
            "question:crop" => {
                let id = model::id(args.first().ok_or("题目编号无效")?)?;
                let bytes = runtime.repository.task_read(|db| {
                    let q = data::get(db, "questions", id)?.ok_or("题目不存在")?;
                    let path =
                        std::path::Path::new(q["sourcePath"].as_str().ok_or("题目没有来源原图")?);
                    let bytes = media::read_owned(&runtime.repository.root, path)?;
                    if ["heic", "heif"].contains(&media::extension(path).as_str()) {
                        media::png(&media::heic(&bytes)?)
                    } else {
                        Ok(bytes)
                    }
                })?;
                Ok(json!(media::crop(
                    &bytes,
                    args.get(1).ok_or("框选范围无效")?
                )?))
            }
            "library:state" => {
                let p = runtime.preferences.lock().unwrap().clone();
                let result = runtime.repository.state(&p.color_theme, &p.close_action)?;
                let mut prefs = runtime.preferences.lock().unwrap();
                prefs.color_theme = result["settings"]["colorTheme"]
                    .as_str()
                    .unwrap_or("GRAPHITE")
                    .into();
                prefs.close_action = result["settings"]["closeAction"]
                    .as_str()
                    .unwrap_or("ask")
                    .into();
                Ok(result)
            }
            "history:list" => {
                let limit = args.first().and_then(Value::as_i64).unwrap_or(100);
                let offset = args.get(1).and_then(Value::as_i64).unwrap_or(0);
                let query = args.get(2).and_then(Value::as_str).unwrap_or("");
                if !(1..=500).contains(&limit) || offset < 0 || query.len() > 1000 {
                    return Err("历史查询参数无效".into());
                }
                runtime.repository.history(limit, offset, query)
            }
            "settings:color-theme" | "settings:close-action" => {
                let value = args.first().and_then(Value::as_str).ok_or("设置格式无效")?;
                let choices = if channel == "settings:color-theme" {
                    &["GRAPHITE", "BLUE", "CLAY", "PLUM"][..]
                } else {
                    &["ask", "quit", "background"][..]
                };
                if !choices.contains(&value) {
                    return Err("设置值无效".into());
                }
                runtime.repository.mutate(channel, args)?;
                let mut prefs = runtime.preferences.lock().unwrap();
                let mut next = prefs.clone();
                if channel == "settings:color-theme" {
                    next.color_theme = value.into();
                } else {
                    next.close_action = value.into();
                }
                let _ = save_preferences(&runtime, &next);
                *prefs = next;
                drop(prefs);
                emit(window, "state:changed", Value::Null)?;
                Ok(Value::Null)
            }
            "question:manual-prompt" => {
                let value = args
                    .first()
                    .and_then(Value::as_bool)
                    .ok_or("状态格式无效")?;
                runtime.lifecycle.lock().unwrap().manual_prompt = value;
                Ok(Value::Null)
            }
            "window:close-choice" => {
                let choice = args.first().and_then(Value::as_str).ok_or("关闭选择无效")?;
                if !["quit", "background", "cancel"].contains(&choice) {
                    return Err("关闭选择无效".into());
                }
                let remember = args
                    .get(1)
                    .and_then(Value::as_bool)
                    .ok_or("关闭选择格式无效")?;
                if !runtime.lifecycle.lock().unwrap().choice {
                    return Ok(Value::Null);
                }
                if remember && choice != "cancel" {
                    runtime
                        .repository
                        .mutate("settings:close-action", &[json!(choice)])?;
                    let mut prefs = runtime.preferences.lock().unwrap();
                    let mut next = prefs.clone();
                    next.close_action = choice.into();
                    let _ = save_preferences(&runtime, &next);
                    *prefs = next;
                    drop(prefs);
                    emit(window, "state:changed", Value::Null)?;
                }
                let action = runtime.lifecycle.lock().unwrap().decide(choice);
                emit(window, "window:close-choice", json!(false))?;
                execute(window, action)?;
                Ok(Value::Null)
            }
            "window:close-ready" => {
                let request = args.first().and_then(Value::as_u64).ok_or("关闭请求无效")?;
                let saved = args.get(1).and_then(Value::as_bool).ok_or("保存确认无效")?;
                let action = runtime
                    .lifecycle
                    .lock()
                    .unwrap()
                    .acknowledge(request, saved);
                execute(window, action)?;
                Ok(Value::Null)
            }
            "window:show" => {
                show(window.app_handle());
                Ok(Value::Null)
            }
            _ if data::CHANNELS.contains(&channel) => {
                let old = if ["question:save", "question:undo-review", "question:delete"]
                    .contains(&channel)
                {
                    let id = if channel == "question:delete" {
                        args.first().and_then(Value::as_str)
                    } else {
                        args.first().and_then(|q| q["id"].as_str())
                    };
                    id.map(|id| {
                        runtime
                            .repository
                            .task_read(|db| data::get(db, "questions", id))
                    })
                    .transpose()?
                    .flatten()
                } else {
                    None
                };
                if channel == "question:delete" {
                    if let Some(q) = &old {
                        runtime
                            .jobs
                            .cancel_question(window.app_handle(), model::id(&q["id"])?)?;
                    }
                }
                let mut value = runtime.repository.mutate(channel, args)?;
                if ["question:save", "question:undo-review"].contains(&channel) {
                    let content_changed = old.as_ref().is_some_and(|q| {
                        repository::fingerprint(q) != repository::fingerprint(&value)
                    });
                    if content_changed
                        || channel == "question:undo-review"
                        || old
                            .as_ref()
                            .is_some_and(|q| q["autoSolve"] == true && value["autoSolve"] != true)
                    {
                        let _ = runtime
                            .jobs
                            .cancel_question(window.app_handle(), model::id(&value["id"])?);
                    }
                    if channel == "question:save"
                        && value["autoSolve"] == true
                        && (content_changed || old.as_ref().is_none_or(|q| q["autoSolve"] != true))
                    {
                        let _ = runtime
                            .jobs
                            .solve(window.app_handle(), model::id(&value["id"])?);
                    }
                }
                if ["question:save", "question:undo-review"].contains(&channel) {
                    value = repository::public_question(value);
                }
                if channel != "history:record" {
                    let _ = emit(window, "state:changed", Value::Null);
                }
                let _ = emit(window, "history:changed", Value::Null);
                Ok(value)
            }
            _ => {
                let contract: Value =
                    serde_json::from_str(include_str!("../../../src/shared/desktop-channels.json"))
                        .unwrap();
                if contract.as_object().unwrap().values().any(|v| v == channel) {
                    return Ok(error("NOT_IMPLEMENTED", deferred_message(channel)));
                }
                Ok(error("UNKNOWN_COMMAND", "此操作不可用"))
            }
        }
    })();
    match result {
        Ok(data) if data.get("ok") == Some(&Value::Bool(false)) => data,
        Ok(data) => ok(data),
        Err(message) => error("OPERATION_FAILED", message),
    }
}
fn deferred_message(channel: &str) -> &'static str {
    if channel.starts_with("mobile:") {
        "手机传图与题库交换尚未在此预览版开放，请继续使用原版。"
    } else if channel.starts_with("intake:") {
        "文件、剪贴板与截图导入尚未在此预览版开放，请继续使用原版。"
    } else if channel.starts_with("backup:")
        || channel.contains("export")
        || channel.contains("preview")
    {
        "备份、预览与文档导出尚未在此预览版开放，请继续使用原版。"
    } else {
        "此功能尚未在迁移预览版开放，请继续使用原版。"
    }
}
fn main() {
    let root = std::env::var_os("MATHECA_TEST_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("LOCALAPPDATA").expect("LOCALAPPDATA missing"))
                .join("MathecaTauriPreview")
        });
    assert!(root.is_absolute(), "MATHECA_TEST_DATA must be absolute");
    std::fs::create_dir_all(&root).expect("cannot create preview data directory");
    let prefs_file = root.join("preview-settings.json");
    let preferences = if prefs_file.is_file() {
        std::fs::read(prefs_file)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    } else {
        Preferences::default()
    };
    let log = root.clone();
    std::panic::set_hook(Box::new(move |info| {
        let _ = std::fs::write(log.join("startup-error.txt"), info.to_string());
    }));
    let repository = Repository::new(root.clone());
    let jobs = jobs::Engine::new(&repository);
    let mobile = mobile::Mobile::new(&repository);
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Runtime {
            repository,
            documents: documents::Documents::default(),
            backups: backups::Backups::default(),
            jobs,
            mobile,
            capture: capture::Capture::default(),
            preferences: Mutex::new(preferences),
            lifecycle: Mutex::new(Lifecycle::default()),
        })
        .manage(worker::Replies::default())
        .invoke_handler(tauri::generate_handler![
            worker::worker_reply,
            capture::capture_ready,
            capture::capture_loaded,
            capture::capture_confirm,
            capture::capture_cancel,
            bootstrap,
            frontend_ready,
            desktop_call,
            choose_legacy_copy
        ])
        .register_uri_scheme_protocol("matheca-asset", |context, request| {
            let runtime = context.app_handle().state::<Runtime>();
            let path = request.uri().path();
            let asset = if let Some(path) = path.strip_prefix("/mobile/") {
                let parts = path.split('/').collect::<Vec<_>>();
                if parts.len() == 2 {
                    runtime.mobile.image(parts[0], parts[1])
                } else {
                    Err("照片路径无效".into())
                }
            } else {
                runtime.repository.asset(path)
            };
            match asset {
                Ok((bytes, mime)) => tauri::http::Response::builder()
                    .header("Content-Type", mime)
                    .header("X-Content-Type-Options", "nosniff")
                    .body(bytes)
                    .unwrap(),
                Err(_) => tauri::http::Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap(),
            }
        })
        .setup(move |app| {
            let window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("tauri.html".into()),
            )
            .title("Matheca")
            .decorations(false)
            .shadow(true)
            .inner_size(1440.0, 960.0)
            .min_inner_size(960.0, 640.0)
            .center()
            .data_directory(root.join("webview-profile"))
            .on_navigation(|url| {
                url.scheme() == "tauri"
                    || (url.host_str() == Some("tauri.localhost")
                        && ["http", "https"].contains(&url.scheme()))
            })
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .build()?;
            let closing = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    request_close(&closing);
                }
            });
            use tauri::{
                menu::{Menu, MenuItem},
                tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
            };
            let open = MenuItem::with_id(app, "show", "打开 Matheca", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            TrayIconBuilder::with_id("matheca-preview-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Matheca")
                .menu(&Menu::with_items(app, &[&open, &quit])?)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        app.state::<Runtime>().capture.cancel(app);
                        show(app)
                    }
                    "quit" => {
                        app.state::<Runtime>().capture.cancel_for_close(app);
                        show(app);
                        if let Some(w) = app.get_webview_window("main") {
                            let action = app.state::<Runtime>().lifecycle.lock().unwrap().prepare();
                            let _ = execute(&w, action);
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        tray.app_handle()
                            .state::<Runtime>()
                            .capture
                            .cancel(tray.app_handle());
                        show(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Matheca Tauri startup failed");
}
