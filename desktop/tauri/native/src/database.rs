use rusqlite::{Connection, OpenFlags, OptionalExtension};
use std::{path::Path, time::Duration};
pub const SCHEMA:&str="CREATE TABLE IF NOT EXISTS questions(id TEXT PRIMARY KEY,createdAt INTEGER NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY,createdAt INTEGER NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS items(collectionId TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,questionId TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,position INTEGER NOT NULL,PRIMARY KEY(collectionId,questionId));
CREATE INDEX IF NOT EXISTS item_questions ON items(questionId);
CREATE TABLE IF NOT EXISTS knowledge(name TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,createdAt INTEGER NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pages(jobId TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,fileOrdinal INTEGER NOT NULL,pageOrdinal INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(jobId,fileOrdinal,pageOrdinal));
CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,path TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY AUTOINCREMENT,timestamp INTEGER NOT NULL,title TEXT NOT NULL,detail TEXT NOT NULL,category TEXT NOT NULL,status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tauri_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);";
pub fn validate(db: &Connection) -> Result<(), String> {
    let version: i64 = db
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if !(0..=1).contains(&version) {
        return Err(format!("题库版本 {version} 暂不受支持，未修改该题库"));
    }
    let integrity: String = db
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|_| "题库文件损坏，请使用备份恢复")?;
    if integrity != "ok" {
        return Err("题库完整性校验失败，请使用备份恢复".into());
    }
    let count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count == 0 && version == 0 {
        return Ok(());
    }
    for (table, columns) in [
        ("questions", vec!["id", "createdAt", "data"]),
        ("collections", vec!["id", "createdAt", "data"]),
        ("items", vec!["collectionId", "questionId", "position"]),
        ("knowledge", vec!["name", "data"]),
        ("settings", vec!["key", "value"]),
        ("jobs", vec!["id", "createdAt", "data"]),
        ("pages", vec!["jobId", "fileOrdinal", "pageOrdinal", "data"]),
        ("batches", vec!["id", "path"]),
    ] {
        let mut stmt = db
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(|e| e.to_string())?;
        let found = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if columns.iter().any(|c| !found.iter().any(|s| s == c)) {
            return Err(format!("题库结构不兼容：{table}，未修改该题库"));
        }
    }
    let mut check = db
        .prepare("PRAGMA foreign_key_check")
        .map_err(|e| e.to_string())?;
    if check.exists([]).map_err(|e| e.to_string())? {
        return Err("题库存在失效关联，请先检查备份".into());
    }
    Ok(())
}
pub fn backup(db: &Connection, file: &Path) -> Result<(), String> {
    db.backup("main", file, None)
        .map_err(|e| format!("题库备份失败：{e}"))
}
pub fn open(root: &Path) -> Result<Connection, String> {
    let file = root.join("library.sqlite");
    let existing = file.is_file() && file.metadata().map_err(|e| e.to_string())?.len() > 0;
    let mut initialized = false;
    if existing {
        let read = Connection::open_with_flags(&file, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|_| "题库无法打开，请检查文件或使用备份")?;
        let version: i64 = read
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if version > 1 {
            return Err(format!("题库版本 {version} 暂不受支持，未修改该题库"));
        }
        let meta:bool=read.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='tauri_meta' AND type='table')",[],|r|r.get(0)).map_err(|e|e.to_string())?;
        if meta {
            initialized = version == 1
                && read
                    .query_row(
                        "SELECT value FROM tauri_meta WHERE key='phase3_ready'",
                        [],
                        |r| r.get::<_, String>(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?
                    .is_some();
        }
        if !initialized {
            validate(&read)?;
            let folder = root.join("backups");
            std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
            backup(
                &read,
                &folder.join(format!("before-tauri-{}.sqlite", uuid::Uuid::new_v4())),
            )?;
        }
    }
    let mut db = Connection::open(&file).map_err(|e| e.to_string())?;
    db.busy_timeout(Duration::from_secs(10))
        .map_err(|e| e.to_string())?;
    db.pragma_update(None, "foreign_keys", true)
        .map_err(|e| e.to_string())?;
    if !initialized {
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        tx.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        tx.pragma_update(None, "user_version", 1)
            .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR REPLACE INTO tauri_meta VALUES('phase3_ready','1')",
            [],
        )
        .map_err(|e| e.to_string())?;
        // Preview preferences are a bridge from phase 2; DB becomes authoritative.
        if let Ok(bytes) = std::fs::read(root.join("preview-settings.json")) {
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                for key in ["colorTheme", "closeAction"] {
                    if let Some(s) = value[key].as_str() {
                        tx.execute("INSERT OR IGNORE INTO settings VALUES(?1,?2)", [key, s])
                            .map_err(|e| e.to_string())?;
                    }
                }
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
    }
    db.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    crate::migration::recover(root, &db)?;
    Ok(db)
}
