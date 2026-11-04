use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};
use rusqlite::Connection;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub struct Repository {
    pub root: PathBuf,
    pub(crate) gate: std::sync::Mutex<()>,
    pub(crate) undo: std::sync::Mutex<crate::data::UndoState>,
}
pub(crate) struct RepositoryGuard<'a> {
    _mutex: std::sync::MutexGuard<'a, ()>,
    file: std::fs::File,
}
impl Drop for RepositoryGuard<'_> {
    fn drop(&mut self) {
        let _ = fs2::FileExt::unlock(&self.file);
    }
}
impl Repository {
    pub(crate) fn lock(&self) -> Result<RepositoryGuard<'_>, String> {
        let mutex = self.gate.lock().map_err(|_| "题库操作被中断，请重启")?;
        let file = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(self.root.join("tauri-library.lock"))
            .map_err(|e| e.to_string())?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            match fs2::FileExt::try_lock_exclusive(&file) {
                Ok(()) => {
                    return Ok(RepositoryGuard {
                        _mutex: mutex,
                        file,
                    })
                }
                Err(_) if std::time::Instant::now() < deadline => {
                    std::thread::sleep(std::time::Duration::from_millis(30))
                }
                Err(_) => return Err("题库正由其他窗口处理，请稍后重试".into()),
            }
        }
    }
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            gate: std::sync::Mutex::new(()),
            undo: std::sync::Mutex::new(crate::data::UndoState::default()),
        }
    }
    pub(crate) fn open(&self) -> Result<Option<Connection>, String> {
        crate::database::open(&self.root).map(Some)
    }
    fn records(db: &Connection, table: &str, order: &str) -> Result<Vec<Value>, String> {
        let mut query = db
            .prepare(&format!("SELECT data FROM {table} {order}"))
            .map_err(|e| e.to_string())?;
        let records = query
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .map(|r| {
                serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
            })
            .collect();
        records
    }
    pub fn state(&self, color: &str, close: &str) -> Result<Value, String> {
        let _gate = self.lock()?;
        let mut result = json!({"questions":[],"collections":[],"items":[],"customKnowledge":[],"jobs":[],"settings":{"theme":"LIGHT","colorTheme":color,"closeAction":close,"address":"","model":"","hasApiKey":false,"autoSolveImports":false}});
        let Some(db) = self.open()? else {
            return Ok(result);
        };
        result["settings"] = crate::data::settings(&db, &self.root, color, close)?;
        // Read all related tables from one SQLite snapshot without writing a schema.
        db.execute_batch("BEGIN DEFERRED")
            .map_err(|e| e.to_string())?;
        let mut questions = Self::records(&db, "questions", "ORDER BY createdAt DESC")?;
        for q in &mut questions {
            if q["solutionFingerprint"].as_str() != Some(&fingerprint(q)) {
                q["solution"] = json!("");
                q["solutionLatex"] = json!("");
            }
            let path = q["sourcePath"].as_str().unwrap_or("");
            q["sourcePath"] = json!(if path.is_empty() {
                String::new()
            } else {
                format!(
                    "http://matheca-asset.localhost/question/{}",
                    utf8_percent_encode(q["id"].as_str().unwrap_or(""), NON_ALPHANUMERIC)
                )
            });
        }
        result["questions"] = json!(questions);
        result["collections"] = json!(Self::records(
            &db,
            "collections",
            "ORDER BY createdAt DESC"
        )?);
        result["customKnowledge"] = json!(Self::records(&db, "knowledge", "")?);
        result["jobs"] = json!(Self::records(&db, "jobs", "ORDER BY createdAt DESC")?);
        let mut items = db
            .prepare("SELECT collectionId,questionId,position FROM items ORDER BY position")
            .map_err(|e| e.to_string())?;
        result["items"]=json!(items.query_map([],|r|Ok(json!({"collectionId":r.get::<_,String>(0)?,"questionId":r.get::<_,String>(1)?,"position":r.get::<_,i64>(2)?}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?);
        Ok(result)
    }
    pub fn history(&self, limit: i64, offset: i64, query: &str) -> Result<Value, String> {
        let _gate = self.lock()?;
        let Some(db) = self.open()? else {
            return Ok(json!({"records":[],"total":0}));
        };
        let exists: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='history')",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !exists {
            return Ok(json!({"records":[],"total":0}));
        }
        let scope="((category = 'operation' AND title NOT IN ('保存设置','测试图片接口','继续任务','取消任务','打开导出文档')) OR (category = 'interaction' AND title IN ('筛选题库','筛选题集添加面板')) OR (category = 'task' AND (title LIKE '%处理完成' OR status IN ('failed','cancelled'))))";
        let pattern = format!(
            "%{}%",
            query
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        );
        let filter =
            format!("WHERE {scope} AND (title LIKE ?1 ESCAPE '\\' OR detail LIKE ?1 ESCAPE '\\')");
        let total: i64 = db
            .query_row(
                &format!("SELECT COUNT(*) FROM history {filter}"),
                [&pattern],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let mut stmt=db.prepare(&format!("SELECT id,timestamp,title,detail,category,status FROM history {filter} ORDER BY id DESC LIMIT ?2 OFFSET ?3")).map_err(|e|e.to_string())?;
        let records=stmt.query_map(rusqlite::params![pattern,limit,offset],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"timestamp":r.get::<_,i64>(1)?,"title":r.get::<_,String>(2)?,"detail":r.get::<_,String>(3)?,"category":r.get::<_,String>(4)?,"status":r.get::<_,String>(5)?}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
        Ok(json!({"records":records,"total":total}))
    }
    pub fn asset(&self, path: &str) -> Result<(Vec<u8>, &'static str), String> {
        let _gate = self.lock()?;
        let id = percent_decode_str(path.strip_prefix("/question/").ok_or("unknown asset")?)
            .decode_utf8()
            .map_err(|e| e.to_string())?;
        if id.len() > 128 {
            return Err("invalid id".into());
        }
        let db = self.open()?.ok_or("no library")?;
        let data: String = db
            .query_row(
                "SELECT data FROM questions WHERE id=?",
                [id.as_ref()],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let record: Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
        let file = Path::new(record["sourcePath"].as_str().ok_or("no source")?)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let root = self.root.canonicalize().map_err(|e| e.to_string())?;
        if !file.starts_with(root)
            || !file.is_file()
            || file.metadata().map_err(|e| e.to_string())?.len() > 50 * 1024 * 1024
        {
            return Err("source outside library or too large".into());
        }
        let mime = match file
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase()
            .as_str()
        {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "webp" => "image/webp",
            "gif" => "image/gif",
            "heic" | "heif" => "image/png",
            _ => return Err("source format is not available in this preview".into()),
        };
        let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
        let bytes = if ["heic", "heif"].contains(&crate::media::extension(&file).as_str()) {
            crate::media::png(&crate::media::heic(&bytes)?)?
        } else {
            bytes
        };
        Ok((bytes, mime))
    }
}
pub(crate) fn fingerprint(q: &Value) -> String {
    let mut text = ["title", "body", "latex", "sourcePath"]
        .map(|k| q[k].as_str().unwrap_or(""))
        .join("\0");
    if q["kind"] == "选择题"
        && q["figurePlacements"]
            .as_array()
            .is_some_and(|p| p.iter().any(|v| v != "stem"))
    {
        text.push('\0');
        text.push_str(
            &serde_json::to_string(&json!([q["figurePlacements"], q["figures"]])).unwrap(),
        );
    }
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
pub(crate) fn public_question(mut q: Value) -> Value {
    if q["solutionFingerprint"].as_str() != Some(&fingerprint(&q)) {
        q["solution"] = json!("");
        q["solutionLatex"] = json!("");
    }
    if !q["sourcePath"].as_str().unwrap_or("").is_empty() {
        q["sourcePath"] = json!(format!(
            "http://matheca-asset.localhost/question/{}",
            utf8_percent_encode(q["id"].as_str().unwrap_or(""), NON_ALPHANUMERIC)
        ));
    }
    q
}
