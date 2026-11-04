use crate::{
    data,
    docx::{self, Formula},
    model as m,
    repository::Repository,
    worker::Worker,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
type R<T> = Result<T, String>;
#[derive(Default)]
pub struct Documents {
    gate: Mutex<()>,
    cancel: AtomicBool,
    generated: Mutex<HashMap<PathBuf, Vec<u8>>>,
}
pub fn snapshot(repo: &Repository, id: &str) -> R<(Value, Vec<Value>)> {
    repo.task_read(|db|{
    db.execute_batch("BEGIN DEFERRED").map_err(|e|e.to_string())?;
    let raw=data::get(db,"collections",id)?.ok_or("题集不存在")?;let c=m::collection(&raw,Some(&raw))?;
    let mut statement=db.prepare("SELECT q.data FROM items i JOIN questions q ON q.id=i.questionId WHERE i.collectionId=?1 ORDER BY i.position").map_err(|e|e.to_string())?;
    let questions=statement.query_map([id],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?.map(|s|serde_json::from_str(&s.map_err(|e|e.to_string())?).map_err(|e|e.to_string())).collect::<R<Vec<Value>>>()?;
    if questions.is_empty(){return Err("请先加入至少一道题".into())}
if questions.len()>2000{return Err("单次导出最多 2000 道题，请拆分题集".into())}
    Ok((c,questions))
 })
}
pub fn filename(title: &str) -> String {
    let name = title
        .chars()
        .filter(|c| !c.is_control() && !"<>:\"/\\|?*".contains(*c))
        .take(50)
        .collect::<String>()
        .trim()
        .trim_end_matches(['.', ' '])
        .to_string();
    let base = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if name.is_empty() {
        "数学题集".into()
    } else if [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ]
    .contains(&base.as_str())
    {
        format!("题集-{name}")
    } else {
        name
    }
}
pub fn publish(target: &Path, bytes: &[u8], cancel: &AtomicBool) -> R<()> {
    if !target.is_absolute() || target.file_name().is_none() {
        return Err("文档路径无效".into());
    }
    let temp = target.with_file_name(format!(".matheca-{}.partial", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|_| "无法创建临时文档，请检查目录权限与磁盘空间")?;
        file.write_all(bytes)
            .map_err(|_| "写入文档失败，请检查磁盘空间")?;
        file.sync_all().map_err(|_| "保存文档失败")?;
        drop(file);
        if cancel.load(Ordering::SeqCst) {
            return Err("应用正在退出，已停止导出".into());
        }
        use windows::{
            core::HSTRING,
            Win32::Storage::FileSystem::{
                MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
            },
        };
        unsafe {
            MoveFileExW(
                &HSTRING::from(temp.as_os_str()),
                &HSTRING::from(target.as_os_str()),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        }
        .map_err(|_| "无法发布文档，文件可能正在使用；原文件未被删除")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}
impl Documents {
    pub fn stop(&self) {
        self.cancel.store(true, Ordering::SeqCst)
    }
    pub fn reset(&self) {
        self.cancel.store(false, Ordering::SeqCst)
    }
    fn render(
        &self,
        window: &WebviewWindow,
        c: &Value,
        questions: &[Value],
        format: &str,
    ) -> R<Vec<u8>> {
        if self.cancel.load(Ordering::SeqCst) {
            return Err("应用正在退出".into());
        }
        let worker = Worker::new(window.app_handle(), &self.cancel)?;
        worker.document_size()?;
        let plan = worker.call("exportPlan", json!([questions, c]), &self.cancel)?;
        if format == "pdf" {
            return crate::document_native::pdf(&worker.window()?, &self.cancel);
        }
        let mut formulas = HashMap::new();
        for part in plan["parts"].as_array().ok_or("题目排版无效")? {
            let mut runs = part["stem"]
                .as_array()
                .ok_or("题干排版无效")?
                .iter()
                .collect::<Vec<_>>();
            for option in part["options"].as_array().ok_or("选项排版无效")? {
                runs.extend(option.as_array().ok_or("选项排版无效")?);
            }
            for run in runs {
                if run["type"] != "formula" {
                    continue;
                }
                let key = docx::formula_key(run);
                if formulas.contains_key(&key) {
                    continue;
                }
                if formulas.len() >= 1500 {
                    return Err("公式过多，请拆分题集".into());
                }
                let meta = worker.call(
                    "formula",
                    json!([run["latex"], run["display"]]),
                    &self.cancel,
                )?;
                let viewport = worker.call("viewport", json!([]), &self.cancel)?;
                let png = crate::document_native::formula(
                    &worker.window()?,
                    &meta,
                    &viewport,
                    &self.cancel,
                )?;
                formulas.insert(
                    key,
                    Formula {
                        png,
                        width: meta["width"].as_f64().ok_or("公式宽度无效")?,
                        height: meta["height"].as_f64().ok_or("公式高度无效")?,
                    },
                );
            }
        }
        docx::build(questions, c, &plan, &formulas, &self.cancel)
    }
    pub fn preview(&self, window: &WebviewWindow, id: &str) -> R<Value> {
        let _gate = self
            .gate
            .try_lock()
            .map_err(|_| "正在生成其他文档，请稍后重试")?;
        let (c, q) = snapshot(&window.state::<crate::Runtime>().repository, id)?;
        Ok(json!(self.render(window, &c, &q, "pdf")?))
    }
    pub fn export(&self, window: &WebviewWindow, id: &str, format: &str) -> R<Value> {
        if !["pdf", "docx"].contains(&format) {
            return Err("导出格式无效".into());
        }
        let _gate = self
            .gate
            .try_lock()
            .map_err(|_| "正在生成其他文档，请稍后重试")?;
        let (c, q) = snapshot(&window.state::<crate::Runtime>().repository, id)?;
        let pending = q.iter().filter(|q| q["reviewed"] != true).count();
        if pending>0&&!window.app_handle().dialog().message(format!("题集中有 {pending} 道待校对题目。识别和 AI 结果需要核对，继续导出当前保存内容？")).title("导出前确认").kind(MessageDialogKind::Warning).parent(window).buttons(MessageDialogButtons::OkCancelCustom("继续导出".into(),"返回校对".into())).blocking_show(){return Ok(Value::Null)}
        let target = window
            .app_handle()
            .dialog()
            .file()
            .set_parent(window)
            .set_title("导出题集")
            .set_file_name(format!(
                "{}.{}",
                filename(c["title"].as_str().unwrap_or("数学题集")),
                format
            ))
            .add_filter(format.to_uppercase(), &[format])
            .blocking_save_file();
        let Some(target) = target else {
            return Ok(Value::Null);
        };
        let mut target = target.into_path().map_err(|_| "导出路径无效")?;
        if target.extension().is_none() {
            target.set_extension(format);
        }
        if crate::media::extension(&target) != format {
            return Err(format!("导出文件扩展名须为 .{format}"));
        }
        let bytes = self.render(window, &c, &q, format)?;
        publish(&target, &bytes, &self.cancel)?;
        let canonical = target
            .canonicalize()
            .map_err(|_| "文档已生成，但无法验证保存路径")?;
        self.generated
            .lock()
            .unwrap()
            .insert(canonical, Sha256::digest(&bytes).to_vec());
        let _ = window.state::<crate::Runtime>().repository.task_read(|db| {
            data::audit(
                db,
                if format == "pdf" {
                    "导出 PDF"
                } else {
                    "导出 Word"
                },
                c["title"].as_str().unwrap_or("题集"),
                "operation",
                "done",
            )
        });
        Ok(json!({"path":target,"format":format}))
    }
    pub(crate) fn generated_bytes(&self, path: &Path) -> R<Vec<u8>> {
        if !["pdf", "docx"].contains(&crate::media::extension(path).as_str()) {
            return Err("仅可发送本次生成的 PDF 或 Word".into());
        }
        let p = path.canonicalize().map_err(|_| "导出文件不存在")?;
        let generated = self.generated.lock().unwrap();
        let expected = generated.get(&p).ok_or("仅可发送本次生成的文档")?;
        if !p.is_file() || p.metadata().map_err(|e| e.to_string())?.len() > 32 * 1024 * 1024 {
            return Err("导出文件已变化或过大".into());
        }
        let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
        if Sha256::digest(&bytes).as_slice() != expected.as_slice() {
            return Err("导出文件已变化，请重新导出".into());
        }
        Ok(bytes)
    }
    pub fn open(&self, path: &Path) -> R<Value> {
        if !["pdf", "docx"].contains(&crate::media::extension(path).as_str()) {
            return Err("仅可打开本次生成的文档".into());
        }
        let canonical = path.canonicalize().map_err(|_| "导出文件不存在")?;
        let generated = self.generated.lock().unwrap();
        let hash = generated.get(&canonical).ok_or("仅可打开本次生成的文档")?;
        let meta = canonical.metadata().map_err(|_| "无法读取导出文件")?;
        if !meta.is_file() || meta.len() > 32 * 1024 * 1024 {
            return Err("导出文件已变化或过大".into());
        }
        let bytes = std::fs::read(&canonical).map_err(|_| "无法读取导出文件")?;
        if Sha256::digest(bytes).as_slice() != hash.as_slice() {
            return Err("导出文件已变化，请重新导出".into());
        }
        use windows::{
            core::{w, HSTRING},
            Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
        };
        let result = unsafe {
            ShellExecuteW(
                None,
                w!("open"),
                &HSTRING::from(canonical.as_os_str()),
                None,
                None,
                SW_SHOWNORMAL,
            )
        };
        if result.0 as isize <= 32 {
            return Err("无法打开文档，请检查是否已安装对应软件".into());
        }
        Ok(Value::Null)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filename_is_windows_safe() {
        assert_eq!(filename("CON"), "题集-CON");
        assert_eq!(filename("<>:/\\|?*"), "数学题集");
        assert_eq!(filename("数学 . "), "数学");
    }
    #[test]
    fn cancelled_or_locked_publication_preserves_previous_file() {
        let root =
            std::env::temp_dir().join(format!("matheca-export-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let file = root.join("test.pdf");
        std::fs::write(&file, b"old").unwrap();
        let cancel = AtomicBool::new(true);
        assert!(publish(&file, b"new", &cancel).is_err());
        assert_eq!(std::fs::read(&file).unwrap(), b"old");
        cancel.store(false, Ordering::SeqCst);
        use std::os::windows::fs::OpenOptionsExt;
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&file)
            .unwrap();
        assert!(publish(&file, b"new", &cancel).is_err());
        drop(lock);
        assert_eq!(std::fs::read(&file).unwrap(), b"old");
        publish(&file, b"new", &cancel).unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"new");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }
}
