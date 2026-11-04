use crate::{
    data, model as m,
    repository::{fingerprint, Repository},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
pub type R<T> = Result<T, String>;
pub fn bump(db: &Connection) -> R<()> {
    db.execute("INSERT INTO tauri_meta(key,value) VALUES('mutationRevision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1",[]).map_err(|e|e.to_string())?;
    Ok(())
}
pub fn current(db: &Connection, job: &Value) -> R<Value> {
    let value = data::get(db, "jobs", m::id(&job["id"])?)?.ok_or("任务不存在")?;
    if value["runId"] != job["runId"] || value["status"] != "processing" {
        return Err("任务已停止或已由新任务接管".into());
    }
    Ok(value)
}
pub fn page(db: &Connection, id: &str, file: usize, ordinal: usize) -> R<Option<Value>> {
    let s = db
        .query_row(
            "SELECT data FROM pages WHERE jobId=? AND fileOrdinal=? AND pageOrdinal=?",
            params![id, file as i64, ordinal as i64],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    s.map(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
        .transpose()
}
pub fn recover(db: &Connection) -> R<()> {
    for mut job in data::records(db, "jobs")? {
        if ["queued", "processing"].iter().any(|s| job["status"] == *s) {
            job["status"] = json!("paused");
            job["message"] = json!("上次任务未完成，点击继续");
            job["runId"] = Value::Null;
            data::put(db, "jobs", &job)?;
        }
    }
    Ok(())
}
pub fn recover_files(root: &std::path::Path, db: &Connection) -> R<()> {
    crate::backups::recover_files(root, db)?;
    use std::os::windows::fs::MetadataExt;
    use std::{fs, path::Path};
    let canonical = root.canonicalize().map_err(|e| e.to_string())?;
    let questions = data::records(db, "questions")?;
    for (parent, marker) in [
        ("uploads", "MathecaTauriUpload-v1"),
        ("intake", "MathecaTauriIntake-v1"),
    ] {
        let base = root.join(parent);
        let Ok(entries) = fs::read_dir(&base) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if uuid::Uuid::parse_str(&name).is_err() {
                continue;
            }
            let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if !meta.is_dir() || meta.file_attributes() & 0x400 != 0 {
                continue;
            }
            let owned = path.canonicalize().map_err(|e| e.to_string())?;
            if !owned.starts_with(&canonical)
                || fs::read(path.join(".matheca-owned")).ok().as_deref() != Some(marker.as_bytes())
            {
                continue;
            }
            if parent == "intake"
                && (data::get(db, "jobs", &name)?.is_some()
                    || questions.iter().any(|q| {
                        q["sourcePath"]
                            .as_str()
                            .and_then(|p| Path::new(p).canonicalize().ok())
                            .is_some_and(|p| p.starts_with(&owned))
                    }))
            {
                continue;
            }
            fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
impl Repository {
    pub fn task_read<T>(&self, f: impl FnOnce(&Connection) -> R<T>) -> R<T> {
        let _gate = self.lock()?;
        let db = self.open()?.ok_or("题库不可用")?;
        f(&db)
    }
    pub fn task_write<T>(&self, f: impl FnOnce(&Connection) -> R<T>) -> R<T> {
        let _gate = self.lock()?;
        let mut db = self.open()?.ok_or("题库不可用")?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let value = f(&tx)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(value)
    }
}
pub fn commit_page(
    db: &Connection,
    job: &Value,
    position: (usize, usize),
    source: &str,
    drafts: &[Value],
    sources: &[String],
    label: &str,
) -> R<Vec<String>> {
    let (file, ordinal) = position;
    let mut latest = current(db, job)?;
    let id = m::id(&job["id"])?;
    if page(db, id, file, ordinal)?.is_some_and(|p| p["complete"] == true) {
        return Ok(Vec::new());
    }
    if drafts.len() > 100 || drafts.len() != sources.len() {
        return Err("识别题目数量无效".into());
    }
    let custom = data::records(db, "knowledge")?;
    let mut ids = Vec::new();
    for (i, draft) in drafts.iter().enumerate() {
        let qid = format!("{id}-{file}-{ordinal}-{i}");
        ids.push(qid.clone());
        if data::get(db, "questions", &qid)?.is_some() {
            continue;
        }
        let mut base = m::new_question(&qid);
        for k in ["body", "latex", "grade", "kind", "difficulty", "knowledge"] {
            base[k] = draft[k].clone();
        }
        base["title"] = json!(m::clean_title(base["body"].as_str().ok_or("识别题干无效")?)
            .chars()
            .take(70)
            .collect::<String>());
        base["sourcePath"] = json!(sources[i]);
        base["sourceLabel"] = json!(label);
        base["autoSolve"] = json!(job["autoSolve"] == true);
        let q = m::question(&base, &base, &custom, false)?;
        if m::trim(q["body"].as_str().unwrap_or("")).is_empty() {
            return Err("模型返回空题干".into());
        }
        data::put(db, "questions", &q)?;
    }
    let row = json!({"complete":true,"sourcePath":source,"questionIds":ids});
    db.execute("INSERT INTO pages VALUES(?1,?2,?3,?4) ON CONFLICT(jobId,fileOrdinal,pageOrdinal) DO UPDATE SET data=excluded.data",params![id,file as i64,ordinal as i64,row.to_string()]).map_err(|e|e.to_string())?;
    let old = latest["questionIds"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut all = old;
    for id in &ids {
        if !all.contains(&json!(id)) {
            all.push(json!(id));
        }
    }
    latest["questionIds"] = json!(all);
    latest["recognizedCount"] = json!(latest["questionIds"].as_array().unwrap().len());
    data::put(db, "jobs", &latest)?;
    bump(db)?;
    Ok(ids)
}
pub fn commit_solution(db: &Connection, job: &Value, original: &Value, result: &Value) -> R<()> {
    let mut latest = current(db, job)?;
    let mut q =
        data::get(db, "questions", m::id(&job["questionId"])?)?.ok_or("题目已删除，解答未写入")?;
    if fingerprint(&q) != job["fingerprint"].as_str().unwrap_or("")
        || data::setting(db, &format!("solutionTask:{}", m::id(&q["id"])?))? != m::id(&job["id"])?
    {
        return Err("题目已变化，旧解答未写入".into());
    }
    for field in ["solution", "solutionLatex"] {
        let s = m::string(&result[field], 4_200_000)?;
        if field == "solution" && m::trim(s).is_empty() {
            return Err("解答内容为空".into());
        }
        q[field] = json!(s);
    }
    if q["difficulty"] == original["difficulty"]
        && ["基础", "进阶", "挑战"]
            .iter()
            .any(|d| result["difficulty"] == *d)
    {
        q["difficulty"] = result["difficulty"].clone();
    }
    q["solutionFingerprint"] = job["fingerprint"].clone();
    q["solutionError"] = json!("");
    latest["status"] = json!("complete");
    latest["message"] = json!("AI 解答已生成，待核对");
    latest["completed"] = json!(1);
    data::put(db, "questions", &q)?;
    data::put(db, "jobs", &latest)?;
    bump(db)?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::database;
    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(database::SCHEMA).unwrap();
        c
    }
    fn job() -> Value {
        json!({"id":"job","createdAt":"1","type":"import","status":"processing","runId":"run"})
    }
    #[test]
    fn page_commits_once_and_stopped_run_cannot_write() {
        let db = db();
        let j = job();
        data::put(&db, "jobs", &j).unwrap();
        let draft = json!({"body":"测试题干","latex":"","grade":"高一","kind":"解答题","difficulty":"待评估","knowledge":""});
        let ids = commit_page(
            &db,
            &j,
            (0, 0),
            "img",
            &[draft.clone()],
            &["img".into()],
            "测试",
        )
        .unwrap();
        assert_eq!(ids.len(), 1);
        assert!(
            commit_page(&db, &j, (0, 0), "img", &[draft], &["img".into()], "测试")
                .unwrap()
                .is_empty()
        );
        recover(&db).unwrap();
        assert!(current(&db, &j).is_err());
        assert_eq!(data::records(&db, "questions").unwrap().len(), 1);
        assert_eq!(
            data::get(&db, "jobs", "job").unwrap().unwrap()["status"],
            "paused"
        );
    }
    #[test]
    fn solution_rejects_edited_question_and_superseded_task() {
        let db = db();
        let mut q = m::new_question("q");
        q["body"] = json!("原题");
        data::put(&db, "questions", &q).unwrap();
        let j = json!({"id":"solve","createdAt":"2","type":"solution","status":"processing","runId":"run","questionId":"q","fingerprint":fingerprint(&q)});
        data::put(&db, "jobs", &j).unwrap();
        data::set_setting(&db, "solutionTask:q", "solve").unwrap();
        let r = json!({"solution":"答案：1","solutionLatex":""});
        let mut edited = q.clone();
        edited["body"] = json!("新题");
        data::put(&db, "questions", &edited).unwrap();
        assert!(commit_solution(&db, &j, &q, &r).is_err());
        data::put(&db, "questions", &q).unwrap();
        data::set_setting(&db, "solutionTask:q", "newer").unwrap();
        assert!(commit_solution(&db, &j, &q, &r).is_err());
        data::set_setting(&db, "solutionTask:q", "solve").unwrap();
        commit_solution(&db, &j, &q, &r).unwrap();
        assert_eq!(
            data::get(&db, "questions", "q").unwrap().unwrap()["solution"],
            "答案：1"
        );
    }
    #[test]
    fn interrupted_upload_cleanup_preserves_referenced_and_unmarked_files() {
        let root =
            std::env::temp_dir().join(format!("matheca-phase4-cleanup-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let db = db();
        let upload = root.join("uploads").join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&upload).unwrap();
        std::fs::write(upload.join(".matheca-owned"), b"MathecaTauriUpload-v1").unwrap();
        let unmarked = root.join("uploads").join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&unmarked).unwrap();
        std::fs::write(unmarked.join("keep"), b"keep").unwrap();
        let kept_id = uuid::Uuid::new_v4().to_string();
        let kept = root.join("intake").join(&kept_id);
        std::fs::create_dir_all(&kept).unwrap();
        std::fs::write(kept.join(".matheca-owned"), b"MathecaTauriIntake-v1").unwrap();
        let mut j = job();
        j["id"] = json!(kept_id);
        data::put(&db, "jobs", &j).unwrap();
        recover_files(&root, &db).unwrap();
        assert!(!upload.exists());
        assert!(unmarked.join("keep").exists());
        assert!(kept.exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
