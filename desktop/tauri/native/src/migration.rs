use crate::{
    crypto, data, database,
    repository::{fingerprint, Repository},
};
use rusqlite::{params_from_iter, Connection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::{Path, PathBuf},
};
type R<T> = Result<T, String>;
fn hash(file: &Path) -> R<String> {
    let mut file = std::fs::File::open(file).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}
fn database_signature(root: &Path) -> R<Vec<Option<String>>> {
    [
        "library.sqlite",
        "library.sqlite-wal",
        "library.sqlite-journal",
    ]
    .iter()
    .map(|name| {
        let p = root.join(name);
        if p.exists() {
            hash(&p).map(Some)
        } else {
            Ok(None)
        }
    })
    .collect()
}
fn snapshot(source: &Path, stage: &Path) -> R<Connection> {
    if !source.join("library.sqlite").is_file() {
        return Err("请选择包含 library.sqlite 的原版资料目录".into());
    }
    for _ in 0..3 {
        let copied: R<()> = (|| {
            let before = database_signature(source)?;
            for name in [
                "library.sqlite",
                "library.sqlite-wal",
                "library.sqlite-journal",
            ] {
                let p = source.join(name);
                let target = stage.join(name);
                if p.exists() {
                    if p.metadata().map_err(|e| e.to_string())?.len() > 512 * 1024 * 1024 {
                        return Err("数据库快照超过 512 MiB，请先通过原版整理备份".into());
                    }
                    std::fs::copy(&p, &target).map_err(|e| e.to_string())?;
                } else if target.exists() {
                    std::fs::remove_file(target).map_err(|e| e.to_string())?;
                }
            }
            let after = database_signature(source)?;
            if before != after {
                return Err("源题库正在变化".into());
            }
            Ok(())
        })();
        if copied.is_err() {
            continue;
        }
        let db = Connection::open(stage.join("library.sqlite")).map_err(|e| e.to_string())?;
        database::validate(&db)?;
        database::backup(&db, &stage.join("snapshot.sqlite"))?;
        return Connection::open(stage.join("snapshot.sqlite")).map_err(|e| e.to_string());
    }
    Err("源题库正在变化或无法读取，请完成原版操作后重试，或选择已复制的资料目录".into())
}
fn own_dir(root: &Path, name: &str) -> R<PathBuf> {
    let base = root.join(name);
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    if !base
        .canonicalize()
        .map_err(|e| e.to_string())?
        .starts_with(root.canonicalize().map_err(|e| e.to_string())?)
    {
        return Err("迁移目录位置异常".into());
    }
    Ok(base)
}
struct Copier<'a> {
    source: &'a Path,
    batch: &'a Path,
    files: usize,
    bytes: u64,
    missing: usize,
}
impl Copier<'_> {
    fn rebase(&mut self, value: &str) -> R<String> {
        if value.is_empty() {
            return Ok(String::new());
        }
        let raw = Path::new(value);
        let path = if raw.exists() {
            raw.canonicalize().map_err(|e| e.to_string())?
        } else {
            raw.to_path_buf()
        };
        let source_text = self.source.to_string_lossy();
        let plain = source_text.strip_prefix(r"\\?\").unwrap_or(&source_text);
        let relative = path
            .strip_prefix(self.source)
            .or_else(|_| raw.strip_prefix(Path::new(plain)))
            .map_err(|_| "原图或任务文件位于原版资料目录外，请先通过原版备份整理")?;
        if relative.as_os_str().is_empty()
            || relative
                .components()
                .any(|c| !matches!(c, std::path::Component::Normal(_)))
        {
            return Err("原图路径无效".into());
        }
        let target = self.batch.join(relative);
        if path.exists() {
            self.copy(&path, &target, 0)?;
        } else {
            self.missing += 1;
        }
        Ok(target.to_string_lossy().into_owned())
    }
    fn copy(&mut self, from: &Path, to: &Path, depth: usize) -> R<()> {
        if depth > 64 {
            return Err("原图目录层级过深".into());
        }
        let meta = std::fs::symlink_metadata(from).map_err(|e| e.to_string())?;
        #[cfg(windows)]
        let reparse = {
            use std::os::windows::fs::MetadataExt;
            meta.file_attributes() & 0x400 != 0
        };
        #[cfg(not(windows))]
        let reparse = meta.file_type().is_symlink();
        if reparse
            || !from
                .canonicalize()
                .map_err(|e| e.to_string())?
                .starts_with(self.source)
        {
            return Err("资料包含外部链接，请先通过原版备份整理".into());
        }
        if meta.is_dir() {
            std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
            for entry in std::fs::read_dir(from).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                self.copy(&entry.path(), &to.join(entry.file_name()), depth + 1)?;
            }
            return Ok(());
        }
        if !meta.is_file() {
            return Err("原图或任务文件类型不受支持".into());
        }
        if to.exists() {
            return Ok(());
        }
        if meta.len() > 50 * 1024 * 1024
            || self.bytes + meta.len() > 2 * 1024 * 1024 * 1024
            || self.files >= 100000
        {
            return Err("迁移资料超过大小或数量限制，请分批备份整理".into());
        }
        let before = hash(from)?;
        std::fs::create_dir_all(to.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::copy(from, to).map_err(|e| e.to_string())?;
        if before != hash(from)? || before != hash(to)? {
            return Err("原图正在变化，请完成原版操作后重试".into());
        }
        self.files += 1;
        self.bytes += meta.len();
        Ok(())
    }
    fn record(&mut self, table: &str, value: &mut Value) -> R<()> {
        if !value.is_object() {
            return Err("旧题库记录格式无效".into());
        }
        let current = table == "questions"
            && value["solutionFingerprint"].as_str() == Some(&fingerprint(value));
        if let Some(path) = value["sourcePath"].as_str() {
            value["sourcePath"] = json!(self.rebase(path)?);
        }
        if table == "jobs" {
            if let Some(paths) = value.get_mut("paths").and_then(Value::as_array_mut) {
                for path in paths {
                    *path = json!(self.rebase(path.as_str().ok_or("任务路径无效")?)?);
                }
            }
        }
        if current {
            value["solutionFingerprint"] = json!(fingerprint(value));
        }
        Ok(())
    }
}
impl Repository {
    pub fn copy_legacy(&self, source: &Path) -> R<Value> {
        let _guard = self.lock()?;
        let source = source.canonicalize().map_err(|_| "原版资料目录无法读取")?;
        let root = self.root.canonicalize().map_err(|e| e.to_string())?;
        if source.starts_with(&root) || root.starts_with(&source) {
            return Err("原版与迁移资料目录必须相互独立".into());
        }
        let mut target = self.open()?.ok_or("目标题库不可用")?;
        let mut undo = self.undo.lock().map_err(|_| "撤销状态不可用")?;
        for table in [
            "questions",
            "collections",
            "knowledge",
            "jobs",
            "pages",
            "batches",
        ] {
            let n: i64 = target
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            if n != 0 {
                return Err(
                    "当前独立题库已有内容，不能覆盖；请使用全新独立目录或等待备份合并功能".into(),
                );
            }
        }
        if !data::setting(&target, "encryptedKey")?.is_empty() {
            return Err("当前独立题库已有接口密钥，不能覆盖；请使用全新独立目录".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let stage = own_dir(&self.root, "migration-staging")?.join(&id);
        let batch = own_dir(&self.root, "migrated")?.join(&id);
        std::fs::create_dir(&stage).map_err(|e| e.to_string())?;
        std::fs::create_dir(&batch).map_err(|e| e.to_string())?;
        std::fs::write(batch.join(".pending"), b"matheca-owned-migration-v1")
            .map_err(|e| e.to_string())?;
        let result = (|| {
            let legacy = snapshot(&source, &stage)?;
            let mut copier = Copier {
                source: &source,
                batch: &batch,
                files: 0,
                bytes: 0,
                missing: 0,
            };
            if let Ok(bytes) = std::fs::read(source.join("Local State")) {
                if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                    if let Some(key) = value["os_crypt"]["encrypted_key"].as_str() {
                        std::fs::write(
                            batch.join("legacy-key.json"),
                            json!({"os_crypt":{"encrypted_key":key}}).to_string(),
                        )
                        .map_err(|e| e.to_string())?;
                    }
                }
            }
            let backups = own_dir(&self.root, "backups")?;
            database::backup(&target, &backups.join(format!("before-copy-{id}.sqlite")))?;
            let tx = target
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(|e| e.to_string())?;
            for (table, columns) in [
                ("questions", vec!["id", "createdAt", "data"]),
                ("collections", vec!["id", "createdAt", "data"]),
                ("items", vec!["collectionId", "questionId", "position"]),
                ("knowledge", vec!["name", "data"]),
                ("jobs", vec!["id", "createdAt", "data"]),
                ("pages", vec!["jobId", "fileOrdinal", "pageOrdinal", "data"]),
                ("batches", vec!["id", "path"]),
            ] {
                let names = columns.join(",");
                let mut stmt = legacy
                    .prepare(&format!("SELECT {names} FROM {table}"))
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map([], |row| {
                        (0..columns.len())
                            .map(|i| row.get::<_, rusqlite::types::Value>(i))
                            .collect::<Result<Vec<_>, _>>()
                    })
                    .map_err(|e| e.to_string())?;
                for row in rows {
                    let mut row = row.map_err(|e| e.to_string())?;
                    if let Some(index) = columns.iter().position(|c| *c == "data") {
                        if let rusqlite::types::Value::Text(text) = &row[index] {
                            let mut value: Value =
                                serde_json::from_str(text).map_err(|_| "旧题库文字记录损坏")?;
                            copier.record(table, &mut value)?;
                            if table == "jobs" {
                                if value["type"] == "solution" {
                                    if let Some(qid) = value["questionId"].as_str() {
                                        if let (Some(old), Some(new)) = (
                                            data::get(&legacy, "questions", qid)?,
                                            data::get(&tx, "questions", qid)?,
                                        ) {
                                            if value["fingerprint"] == fingerprint(&old) {
                                                value["fingerprint"] = json!(fingerprint(&new));
                                            }
                                        }
                                    }
                                }
                                if ["queued", "processing"]
                                    .iter()
                                    .any(|s| value["status"] == *s)
                                {
                                    value["status"] = json!("paused");
                                    value["message"] = json!("从原版复制的未完成任务，点击继续");
                                    value["runId"] = Value::Null;
                                }
                            }
                            row[index] = rusqlite::types::Value::Text(value.to_string());
                        } else {
                            return Err("旧题库记录格式无效".into());
                        }
                    }
                    if table == "batches" {
                        if let rusqlite::types::Value::Text(path) = &row[1] {
                            row[1] = rusqlite::types::Value::Text(copier.rebase(path)?);
                        }
                    }
                    tx.execute(
                        &format!(
                            "INSERT INTO {table}({names}) VALUES({})",
                            vec!["?"; columns.len()].join(",")
                        ),
                        params_from_iter(row),
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
            let mut stmt = legacy
                .prepare("SELECT key,value FROM settings")
                .map_err(|e| e.to_string())?;
            for row in stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map_err(|e| e.to_string())?
            {
                let (key, value) = row.map_err(|e| e.to_string())?;
                data::set_setting(&tx, &key, &value)?;
            }
            if batch.join("legacy-key.json").is_file() {
                data::set_setting(
                    &tx,
                    "legacyKeyFile",
                    &batch.join("legacy-key.json").to_string_lossy(),
                )?;
            }
            let encrypted = data::setting(&tx, "encryptedKey")?;
            let mut key_warning = false;
            if !encrypted.is_empty() {
                match crypto::unprotect(&encrypted, &batch) {
                    Ok(secret) => {
                        data::set_setting(&tx, "encryptedKey", &crypto::protect(&secret)?)?
                    }
                    Err(_) => key_warning = true,
                }
            }
            let exists:bool=legacy.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='history')",[],|r|r.get(0)).map_err(|e|e.to_string())?;
            if exists {
                let mut s = legacy
                    .prepare(
                        "SELECT timestamp,title,detail,category,status FROM history ORDER BY id",
                    )
                    .map_err(|e| e.to_string())?;
                for row in s
                    .query_map([], |r| {
                        Ok((
                            r.get::<_, i64>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                            r.get::<_, String>(3)?,
                            r.get::<_, String>(4)?,
                        ))
                    })
                    .map_err(|e| e.to_string())?
                {
                    let (time, title, detail, category, status) = row.map_err(|e| e.to_string())?;
                    tx.execute("INSERT INTO history(timestamp,title,detail,category,status) VALUES(?1,?2,?3,?4,?5)",rusqlite::params![time,title,detail,category,status]).map_err(|e|e.to_string())?;
                }
            }
            let questions: i64 = tx
                .query_row("SELECT COUNT(*) FROM questions", [], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            let collections: i64 = tx
                .query_row("SELECT COUNT(*) FROM collections", [], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            database::validate(&tx)?;
            tx.execute(
                "INSERT INTO tauri_meta VALUES(?1,'committed')",
                [format!("migration:{id}")],
            )
            .map_err(|e| e.to_string())?;
            tx.execute("INSERT INTO tauri_meta VALUES('mutationRevision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(tauri_meta.value AS INTEGER)+1",[]).map_err(|e|e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
            *undo = data::UndoState::default();
            let _ = std::fs::remove_file(batch.join(".pending"));
            let _ = data::audit(
                &target,
                "复制原版题库",
                &format!("{questions} 道题、{collections} 个题集"),
                "operation",
                "done",
            );
            Ok(
                json!({"questions":questions,"collections":collections,"images":copier.files,"missingImages":copier.missing,"keyWarning":key_warning}),
            )
        })();
        let _ = std::fs::remove_dir_all(&stage);
        if result.is_err() {
            let _ = std::fs::remove_dir_all(&batch);
        }
        result
    }
}
// Only directories carrying our explicit pending marker and a UUID name are
// eligible for crash recovery; committed batches always retain their resources.
pub fn recover(root: &Path, db: &Connection) -> R<()> {
    let base = root.join("migrated");
    if !base.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(&base).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if uuid::Uuid::parse_str(&id).is_err()
            || entry.file_type().map_err(|e| e.to_string())?.is_symlink()
        {
            continue;
        }
        let pending = entry.path().join(".pending");
        if std::fs::read(&pending).ok().as_deref() != Some(b"matheca-owned-migration-v1") {
            continue;
        }
        if !entry
            .path()
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(root.canonicalize().map_err(|e| e.to_string())?)
        {
            continue;
        }
        let committed: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM tauri_meta WHERE key=?1 AND value='committed')",
                [format!("migration:{id}")],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if committed {
            let _ = std::fs::remove_file(pending);
        } else {
            std::fs::remove_dir_all(entry.path()).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
