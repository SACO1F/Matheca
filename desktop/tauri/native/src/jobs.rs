use crate::{
    data, media, model as m, network,
    repository::{fingerprint, Repository},
    tasks_store as store,
    worker::Worker,
    Runtime,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
type R<T> = Result<T, String>;
struct Upload {
    paths: Vec<PathBuf>,
    sizes: Vec<u64>,
    written: Vec<u64>,
    folder: PathBuf,
}
pub struct Engine {
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
    closing: AtomicBool,
    lease: Option<std::fs::File>,
    uploads: Mutex<HashMap<String, Upload>>,
}
pub fn changed(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.emit("state:changed", Value::Null);
        let _ = w.emit("history:changed", Value::Null);
    }
}
impl Engine {
    pub fn new(repo: &Repository) -> Arc<Self> {
        let lease = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(repo.root.join("tauri-tasks.lock"))
            .ok()
            .filter(|f| fs2::FileExt::try_lock_exclusive(f).is_ok());
        if lease.is_some() {
            let _ = repo.task_write(|db| {
                store::recover(db)?;
                store::recover_files(&repo.root, db)
            });
        }
        Arc::new(Self {
            active: Mutex::new(HashMap::new()),
            closing: AtomicBool::new(false),
            lease,
            uploads: Mutex::new(HashMap::new()),
        })
    }
    fn available(&self) -> R<()> {
        if self.closing.load(Ordering::SeqCst) {
            return Err("应用正在退出".into());
        }
        if self.lease.is_none() {
            return Err("另一个 Matheca 窗口正在管理任务，请在该窗口操作".into());
        }
        Ok(())
    }
    pub fn resume(self: &Arc<Self>, app: &tauri::AppHandle, id: &str) -> R<()> {
        self.available()?;
        m::id(&json!(id))?;
        let active = self.active.lock().unwrap();
        if active
            .get(id)
            .is_some_and(|flag| !flag.load(Ordering::SeqCst))
        {
            return Ok(());
        }
        let runtime = app.state::<Runtime>();
        runtime.repository.task_write(|db| {
            let mut j = data::get(db, "jobs", id)?.ok_or("任务不存在")?;
            if j["status"] == "complete" {
                return Ok(());
            }
            if j["type"] != "import" && j["type"] != "solution" {
                return Err("任务类型不受支持".into());
            }
            j["status"] = json!("queued");
            j["message"] = json!("等待处理");
            data::put(db, "jobs", &j)
        })?;
        drop(active);
        self.pump(app);
        changed(app);
        Ok(())
    }
    pub fn cancel(self: &Arc<Self>, app: &tauri::AppHandle, id: &str) -> R<()> {
        self.available()?;
        m::id(&json!(id))?;
        let active = self.active.lock().unwrap();
        if let Some(cancel) = active.get(id) {
            cancel.store(true, Ordering::SeqCst)
        }
        app.state::<Runtime>().repository.task_write(|db| {
            if let Some(mut j) = data::get(db, "jobs", id)? {
                if j["status"] != "complete" {
                    j["status"] = json!("paused");
                    j["runId"] = Value::Null;
                    j["message"] = json!("任务已停止，点击继续");
                    data::put(db, "jobs", &j)?;
                    let _ =
                        data::audit(db, "任务已取消", "已保存完成页的进度", "task", "cancelled");
                }
            }
            Ok(())
        })?;
        drop(active);
        changed(app);
        Ok(())
    }
    pub fn cancel_question(self: &Arc<Self>, app: &tauri::AppHandle, id: &str) -> R<()> {
        if self.lease.is_none() {
            return Ok(());
        }
        let jobs = app
            .state::<Runtime>()
            .repository
            .task_read(|db| data::records(db, "jobs"))?;
        for j in jobs {
            if j["questionId"] == id
                && (["queued", "processing"].iter().any(|s| j["status"] == *s)
                    || self.active.lock().unwrap().contains_key(m::id(&j["id"])?))
            {
                self.cancel(app, m::id(&j["id"])?)?;
            }
        }
        Ok(())
    }
    pub fn solve(self: &Arc<Self>, app: &tauri::AppHandle, id: &str) -> R<()> {
        self.available()?;
        let active = self.active.lock().unwrap();
        app.state::<Runtime>().repository.task_write(|db|{
        let q=data::get(db,"questions",id)?.ok_or("题目不存在")?;
        if m::trim(q["body"].as_str().unwrap_or("")).is_empty()&&m::trim(q["latex"].as_str().unwrap_or("")).is_empty(){return Err("请先填写题干或公式".into())}
        let fp=fingerprint(&q);let mut pending=None;
        for mut j in data::records(db,"jobs")?{if j["type"]!="solution"||j["questionId"]!=id{continue}
            let jid=m::id(&j["id"])?.to_string();
            if j["fingerprint"]==fp&&["queued","processing"].iter().any(|s|j["status"]==*s){return Ok(())}
            if ["queued","processing"].iter().any(|s|j["status"]==*s){if let Some(flag)=active.get(&jid){flag.store(true,Ordering::SeqCst)}j["status"]=json!("paused");j["runId"]=Value::Null;data::put(db,"jobs",&j)?;}
            if j["status"]=="paused"&&j["fingerprint"]==fp&&!active.contains_key(&jid){pending=Some(j);}
        }
        let mut j=pending.unwrap_or_else(||json!({"id":uuid::Uuid::new_v4().to_string(),"createdAt":m::now(),"type":"solution","questionId":id,"completed":0,"total":1,"fingerprint":fp,"questionPreview":q["body"].as_str().unwrap_or("").chars().take(600).collect::<String>(),"questionSource":q["sourceLabel"]}));
        j["status"]=json!("queued");j["message"]=json!("等待解题");data::put(db,"jobs",&j)
    })?;
        drop(active);
        self.pump(app);
        changed(app);
        Ok(())
    }
    pub fn pump(self: &Arc<Self>, app: &tauri::AppHandle) {
        if self.available().is_err() {
            return;
        }
        let mut active = self.active.lock().unwrap();
        if self.available().is_err() {
            return;
        }
        let room = 2usize.saturating_sub(active.len());
        if room == 0 {
            return;
        }
        let selected = app.state::<Runtime>().repository.task_write(|db| {
            let mut jobs = data::records(db, "jobs")?;
            jobs.sort_by_key(|j| {
                j["createdAt"]
                    .as_str()
                    .and_then(|s| s.parse::<i64>().ok())
                    .unwrap_or(0)
            });
            let mut selected = Vec::new();
            for mut j in jobs {
                let id = m::id(&j["id"])?;
                if j["status"] != "queued" || active.contains_key(id) {
                    continue;
                }
                if selected.len() >= room {
                    break;
                }
                if j["type"] == "solution" {
                    let q = data::get(db, "questions", m::id(&j["questionId"])?)?;
                    if q.as_ref()
                        .is_none_or(|q| j["fingerprint"] != fingerprint(q))
                    {
                        j["status"] = json!("failed");
                        j["message"] = json!("题目已变化，请重新生成解答");
                        data::put(db, "jobs", &j)?;
                        continue;
                    }
                    data::set_setting(
                        db,
                        &format!("solutionTask:{}", m::id(&j["questionId"])?),
                        id,
                    )?;
                }
                j["runId"] = json!(uuid::Uuid::new_v4().to_string());
                j["status"] = json!("processing");
                j["message"] = json!("正在读取资料");
                data::put(db, "jobs", &j)?;
                selected.push(j);
            }
            Ok(selected)
        });
        if let Ok(jobs) = selected {
            for j in jobs {
                let id = j["id"].as_str().unwrap().to_string();
                let cancel = Arc::new(AtomicBool::new(false));
                active.insert(id.clone(), cancel.clone());
                let engine = self.clone();
                let app = app.clone();
                std::thread::spawn(move || {
                    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        engine.run(&app, &j, &cancel)
                    }))
                    .unwrap_or_else(|_| Err("任务处理被中断，请重试".into()));
                    let runtime = app.state::<Runtime>();
                    let _ = runtime.repository.task_write(|db| {
                        if let Err(error) = &outcome {
                            if let Ok(mut latest) = store::current(db, &j) {
                                latest["status"] = json!(if cancel.load(Ordering::SeqCst) {
                                    "paused"
                                } else {
                                    "failed"
                                });
                                latest["message"] = json!(error);
                                data::put(db, "jobs", &latest)?;
                                if j["type"] == "solution" {
                                    if let Some(mut q) =
                                        data::get(db, "questions", m::id(&j["questionId"])?)?
                                    {
                                        if j["fingerprint"] == fingerprint(&q) {
                                            q["solutionError"] = json!(error);
                                            data::put(db, "questions", &q)?;
                                        }
                                    }
                                }
                            }
                        }
                        if let Some(latest) = data::get(db, "jobs", &id)? {
                            if latest["runId"] == j["runId"] {
                                let _ = data::audit(
                                    db,
                                    if j["type"] == "import" {
                                        "识别处理完成"
                                    } else {
                                        "解答处理完成"
                                    },
                                    latest["message"].as_str().unwrap_or(""),
                                    "task",
                                    if outcome.is_ok() && latest["status"] == "complete" {
                                        "done"
                                    } else {
                                        "failed"
                                    },
                                );
                            }
                        }
                        Ok(())
                    });
                    engine.active.lock().unwrap().remove(&id);
                    changed(&app);
                    engine.pump(&app);
                });
            }
        }
    }
    pub fn stop(&self, app: &tauri::AppHandle) -> R<()> {
        if self.lease.is_none() {
            return Ok(());
        }
        self.closing.store(true, Ordering::SeqCst);
        {
            let active = self.active.lock().unwrap();
            for cancel in active.values() {
                cancel.store(true, Ordering::SeqCst)
            }
        }
        let repo = &app.state::<Runtime>().repository;
        if self.active.lock().unwrap().is_empty()
            && !repo
                .task_read(|db| {
                    Ok(data::records(db, "jobs")?
                        .iter()
                        .any(|j| ["queued", "processing"].iter().any(|s| j["status"] == *s)))
                })
                .unwrap_or(false)
        {
            return Ok(());
        }
        if let Err(error) = repo.task_write(|db| {
            for mut j in data::records(db, "jobs")? {
                if ["queued", "processing"].iter().any(|s| j["status"] == *s) {
                    j["status"] = json!("paused");
                    j["runId"] = Value::Null;
                    j["message"] = json!("退出前已保存进度，点击继续");
                    data::put(db, "jobs", &j)?;
                }
            }
            Ok(())
        }) {
            self.closing.store(false, Ordering::SeqCst);
            return Err(error);
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        while !self.active.lock().unwrap().is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50))
        }
        Ok(())
    }
    fn run(self: &Arc<Self>, app: &tauri::AppHandle, job: &Value, cancel: &AtomicBool) -> R<()> {
        let runtime = app.state::<Runtime>();
        let config = network::config(&runtime.repository)?;
        let worker = Worker::new(app, cancel)?;
        if job["type"] == "solution" {
            let q = runtime
                .repository
                .task_read(|db| data::get(db, "questions", m::id(&job["questionId"])?))?
                .ok_or("题目已删除")?;
            if job["fingerprint"] != fingerprint(&q) {
                return Err("题目已变化，请重新生成解答".into());
            }
            let path = q["sourcePath"].as_str().unwrap_or("");
            let images = if path.is_empty() {
                Vec::new()
            } else {
                media::read_owned(&runtime.repository.root, Path::new(path))?;
                vec![media::data_url(Path::new(path))?]
            };
            let prompt = worker.call("solutionPrompt", json!([q]), cancel)?;
            let text = network::complete(
                &config,
                prompt.as_str().ok_or("解题提示无效")?,
                &images,
                cancel,
            )?;
            let result = worker.call("decodeSolution", json!([text]), cancel)?;
            if cancel.load(Ordering::SeqCst) {
                return Err("任务已停止".into());
            }
            runtime
                .repository
                .task_write(|db| store::commit_solution(db, job, &q, &result))?;
            changed(app);
            return Ok(());
        }
        self.import(app, job, cancel, &worker, &config)
    }
    fn update(
        &self,
        app: &tauri::AppHandle,
        job: &Value,
        completed: usize,
        total: usize,
        message: &str,
    ) -> R<()> {
        app.state::<Runtime>().repository.task_write(|db| {
            let mut latest = store::current(db, job)?;
            latest["completed"] = json!(completed);
            latest["total"] = json!(total);
            latest["message"] = json!(message);
            data::put(db, "jobs", &latest)
        })?;
        changed(app);
        Ok(())
    }
    fn import(
        self: &Arc<Self>,
        app: &tauri::AppHandle,
        job: &Value,
        cancel: &AtomicBool,
        worker: &Worker,
        config: &network::Config,
    ) -> R<()> {
        let runtime = app.state::<Runtime>();
        let repo = &runtime.repository;
        let paths = job["paths"].as_array().ok_or("任务文件列表无效")?;
        if paths.is_empty() || paths.len() > 20 {
            return Err("任务文件数量无效".into());
        }
        let paths = paths
            .iter()
            .map(|p| m::string(p, 32768).map(PathBuf::from))
            .collect::<R<Vec<_>>>()?;
        let custom = repo.task_read(|db| data::records(db, "knowledge"))?;
        let mut completed = 0;
        let mut total = 0;
        let mut errors = Vec::new();
        for (file, path) in paths.iter().enumerate() {
            if cancel.load(Ordering::SeqCst) {
                return Err("任务已停止，可稍后继续".into());
            }
            let pdf = media::extension(path) == "pdf";
            let mut images = Vec::new();
            let prepared = (|| {
                let bytes = media::read_owned(&repo.root, path)?;
                if pdf {
                    let n = worker
                        .call("openPdf", json!([STANDARD.encode(bytes)]), cancel)?
                        .as_u64()
                        .filter(|n| (1..=20).contains(n))
                        .ok_or("PDF 页数无效，最多 20 页")?;
                    for ordinal in 0..n {
                        let image = worker.call("pdfPage", json!([ordinal + 1]), cancel)?;
                        let output = path
                            .parent()
                            .unwrap()
                            .join(format!("{file}-page-{ordinal}.jpg"));
                        save_image(&output, image.as_str().ok_or("PDF 页面无效")?)?;
                        images.push(output);
                    }
                } else {
                    images.push(path.clone());
                }
                Ok(())
            })();
            if let Err(error) = prepared {
                if cancel.load(Ordering::SeqCst) {
                    return Err(error);
                }
                total += 1;
                errors.push(format!("文件 {}：{error}", file + 1));
                continue;
            }
            let mut photo_first = file;
            let mut photo_last = file;
            if !pdf {
                while photo_first > 0 && media::extension(&paths[photo_first - 1]) != "pdf" {
                    photo_first -= 1
                }
                while photo_last + 1 < paths.len()
                    && media::extension(&paths[photo_last + 1]) != "pdf"
                {
                    photo_last += 1
                }
            }
            let paged = pdf || photo_last > photo_first;
            let final_page = if pdf { images.len() - 1 } else { photo_last };
            let all = if pdf { &images } else { &paths };
            total += images.len();
            for (ordinal, source) in images.iter().enumerate() {
                if cancel.load(Ordering::SeqCst) {
                    return Err("任务已停止，可稍后继续".into());
                }
                if repo
                    .task_read(|db| store::page(db, m::id(&job["id"])?, file, ordinal))?
                    .is_some_and(|p| p["complete"] == true)
                {
                    completed += 1;
                    continue;
                }
                self.update(
                    app,
                    job,
                    completed,
                    total.max(paths.len()),
                    &format!(
                        "正在识别第 {} 个文件，第 {}/{} 页",
                        file + 1,
                        ordinal + 1,
                        images.len()
                    ),
                )?;
                let result = (|| {
                    let target = if pdf { ordinal } else { file };
                    let first = if pdf {
                        target.saturating_sub(1)
                    } else {
                        target.saturating_sub(1).max(photo_first)
                    };
                    let mut last = (target + 1).min(final_page);
                    let drafts = loop {
                        let (prompt, photos) = if paged {
                            (
                                worker.call(
                                    "pagedExtractionPrompt",
                                    json!([custom, target + 1, first + 1, last + 1]),
                                    cancel,
                                )?,
                                (first..=last)
                                    .map(|i| {
                                        media::read_owned(&repo.root, &all[i])?;
                                        media::data_url(&all[i])
                                    })
                                    .collect::<R<Vec<_>>>()?,
                            )
                        } else {
                            (
                                worker.call("extractionPrompt", json!([custom]), cancel)?,
                                vec![media::data_url(source)?],
                            )
                        };
                        let text = network::complete(
                            config,
                            prompt.as_str().ok_or("识别提示无效")?,
                            &photos,
                            cancel,
                        )?;
                        if !paged {
                            break worker.call("decodeDrafts", json!([text, custom]), cancel)?;
                        }
                        let decoded = worker.call(
                            "decodePagedDrafts",
                            json!([text, target + 1, first + 1, last + 1, custom]),
                            cancel,
                        )?;
                        if decoded["needMorePages"] == false {
                            break decoded["drafts"].clone();
                        }
                        if last == final_page {
                            return Err(
                                "文件结束处题目仍不完整，未录入半道题；请补充后续页面".into()
                            );
                        }
                        last += 1;
                        self.update(
                            app,
                            job,
                            completed,
                            total.max(paths.len()),
                            &format!(
                                "正在补齐第 {} 页跨页题目，读取至第 {} 页",
                                target + 1,
                                last + 1
                            ),
                        )?;
                    };
                    let drafts = drafts.as_array().ok_or("识别结果无效")?;
                    let mut sources = Vec::new();
                    for draft in drafts {
                        let start =
                            draft["startPage"].as_u64().unwrap_or((ordinal + 1) as u64) as usize;
                        let end = draft["endPage"].as_u64().unwrap_or(start as u64) as usize;
                        if paged && end > start {
                            if start == 0 || end > all.len() {
                                return Err("跨页范围无效".into());
                            }
                            let photos = (start - 1..end)
                                .map(|i| media::data_url(&all[i]))
                                .collect::<R<Vec<_>>>()?;
                            let joined = worker.call("joinImages", json!([photos]), cancel)?;
                            let output = path
                                .parent()
                                .unwrap()
                                .join(format!("{file}-pages-{start}-{end}.jpg"));
                            save_image(&output, joined.as_str().ok_or("跨页原图无效")?)?;
                            sources.push(output.to_string_lossy().into_owned());
                        } else {
                            sources.push(source.to_string_lossy().into_owned())
                        }
                    }
                    if cancel.load(Ordering::SeqCst) {
                        return Err("任务已停止".into());
                    }
                    let label = format!(
                        "{} · 第 {} 页",
                        job["labels"]
                            .get(file)
                            .and_then(Value::as_str)
                            .unwrap_or("导入资料"),
                        if pdf { ordinal + 1 } else { 1 }
                    );
                    let ids = repo.task_write(|db| {
                        store::commit_page(
                            db,
                            job,
                            (file, ordinal),
                            &source.to_string_lossy(),
                            drafts,
                            &sources,
                            &label,
                        )
                    })?;
                    if job["autoSolve"] == true {
                        for id in ids {
                            let _ = self.solve(app, &id);
                        }
                    }
                    Ok(())
                })();
                match result {
                    Ok(()) => completed += 1,
                    Err(error) => {
                        if cancel.load(Ordering::SeqCst) {
                            return Err(error);
                        }
                        errors.push(format!("文件 {} 第 {} 页：{error}", file + 1, ordinal + 1));
                    }
                }
                self.update(
                    app,
                    job,
                    completed,
                    total.max(paths.len()),
                    "已保存识别进度",
                )?;
            }
        }
        repo.task_write(|db| {
            let mut latest = store::current(db, job)?;
            latest["completed"] = json!(completed);
            latest["total"] = json!(total);
            latest["status"] = json!(if errors.is_empty() {
                "complete"
            } else if completed > 0 {
                "partial"
            } else {
                "failed"
            });
            latest["message"] = json!(if errors.is_empty() {
                format!("识别完成，共 {completed} 页，请校对题目")
            } else {
                format!(
                    "{completed} 页成功，{} 页失败；可重试失败页。{}",
                    errors.len(),
                    errors
                        .iter()
                        .take(3)
                        .cloned()
                        .collect::<Vec<_>>()
                        .join("；")
                )
            });
            data::put(db, "jobs", &latest)
        })?;
        changed(app);
        Ok(())
    }
    pub fn intake(
        self: &Arc<Self>,
        app: &tauri::AppHandle,
        paths: &[PathBuf],
        labels: Option<Vec<String>>,
    ) -> R<String> {
        self.available()?;
        if paths.is_empty() {
            return Err("请先选择照片".into());
        }
        if paths.len() > 20 {
            return Err("一次最多导入 20 个文件".into());
        }
        let runtime = app.state::<Runtime>();
        network::config(&runtime.repository)?;
        let id = uuid::Uuid::new_v4().to_string();
        let folder = runtime.repository.root.join("intake").join(&id);
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        std::fs::write(folder.join(".matheca-owned"), b"MathecaTauriIntake-v1")
            .map_err(|e| e.to_string())?;
        let result = (|| {
            let mut copied = Vec::new();
            let mut total = 0;
            let mut names = Vec::new();
            for (i, path) in paths.iter().enumerate() {
                let ext = media::extension(path);
                if ext == "zip" {
                    return Err(
                        "Windows 题库 ZIP 的预览与恢复在第 6 阶段接入，请使用原版导入".into(),
                    );
                }
                if !["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf"].contains(&ext.as_str()) {
                    return Err("请选择支持的图片或 PDF 文件".into());
                }
                let meta =
                    std::fs::symlink_metadata(path).map_err(|_| "导入文件不存在或无法读取")?;
                use std::os::windows::fs::MetadataExt;
                if !meta.is_file()
                    || meta.file_attributes() & 0x400 != 0
                    || meta.len() == 0
                    || meta.len() > media::MAX_FILE
                {
                    return Err("导入文件为空、不是普通文件或超过 50 MB".into());
                }
                total += meta.len();
                if total > 512 * 1024 * 1024 {
                    return Err("本批资料超过 512 MB，请分批导入".into());
                }
                let target = folder.join(format!("{i}.{ext}"));
                std::fs::copy(path, &target).map_err(|_| "复制文件失败，请检查空间和访问权限")?;
                if target.metadata().map_err(|e| e.to_string())?.len() > media::MAX_FILE {
                    return Err("复制后的文件超过 50 MB".into());
                }
                let target = if ["heic", "heif"].contains(&ext.as_str()) {
                    let image = media::heic(&std::fs::read(&target).map_err(|e| e.to_string())?)?;
                    let png = folder.join(format!("{i}.png"));
                    std::fs::write(&png, media::png(&image)?).map_err(|e| e.to_string())?;
                    png
                } else {
                    target
                };
                if ext != "pdf" {
                    media::decode(&std::fs::read(&target).map_err(|e| e.to_string())?)?;
                }
                copied.push(target.to_string_lossy().into_owned());
                names.push(
                    labels
                        .as_ref()
                        .and_then(|n| n.get(i))
                        .cloned()
                        .unwrap_or_else(|| {
                            path.file_name()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .into_owned()
                        }),
                );
            }
            runtime.repository.task_write(|db|{let j=json!({"id":id,"createdAt":m::now(),"type":"import","status":"queued","message":"等待识别","completed":0,"total":copied.len(),"paths":copied,"labels":names,"autoSolve":data::setting(db,"autoSolveImports")?=="true"});data::put(db,"jobs",&j)})
        })();
        if result.is_err() {
            let _ = std::fs::remove_dir_all(&folder);
        }
        result?;
        self.pump(app);
        changed(app);
        Ok(id)
    }
    pub fn upload_begin(&self, repo: &Repository, files: &Value) -> R<String> {
        self.available()?;
        let files = files
            .as_array()
            .filter(|a| !a.is_empty() && a.len() <= 20)
            .ok_or("一次最多导入 20 个文件")?;
        let is_zip = files.len() == 1
            && files[0]["name"]
                .as_str()
                .is_some_and(|n| media::extension(Path::new(n)) == "zip");
        if !is_zip {
            network::config(repo)?;
        }
        let mut paths = Vec::new();
        let mut sizes = Vec::new();
        let mut total = 0;
        let token = uuid::Uuid::new_v4().to_string();
        let folder = repo.root.join("uploads").join(&token);
        for (i, f) in files.iter().enumerate() {
            let name = m::string(&f["name"], 256)?;
            let ext = media::extension(Path::new(name));
            if !(is_zip
                || ["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf"].contains(&ext.as_str()))
            {
                return Err("题库 ZIP 请单独拖入，或选择图片/PDF".into());
            }
            let size = f["size"]
                .as_u64()
                .filter(|n| {
                    *n > 0
                        && *n
                            <= if is_zip {
                                512 * 1024 * 1024
                            } else {
                                media::MAX_FILE
                            }
                })
                .ok_or("单文件为空或超过 50 MB")?;
            total += size;
            if !is_zip && total > 100 * 1024 * 1024 {
                return Err("直接拖入内容超过 100 MB，请分批导入".into());
            }
            paths.push(folder.join(format!("{i}.{ext}")));
            sizes.push(size);
        }
        let mut uploads = self.uploads.lock().unwrap();
        if uploads.len() >= 2 {
            return Err("请等待当前文件上传完成".into());
        }
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        std::fs::write(folder.join(".matheca-owned"), b"MathecaTauriUpload-v1")
            .map_err(|e| e.to_string())?;
        uploads.insert(
            token.clone(),
            Upload {
                written: vec![0; paths.len()],
                paths,
                sizes,
                folder,
            },
        );
        Ok(token)
    }
    pub fn upload_chunk(&self, token: &str, index: usize, offset: u64, base64: &str) -> R<()> {
        self.available()?;
        if base64.len() > 1_400_000 {
            return Err("文件分块过大".into());
        }
        let bytes = STANDARD.decode(base64).map_err(|_| "文件分块无效")?;
        let mut uploads = self.uploads.lock().unwrap();
        let u = uploads.get_mut(token).ok_or("文件上传已失效，请重新拖入")?;
        if index >= u.paths.len()
            || offset != u.written[index]
            || offset + bytes.len() as u64 > u.sizes[index]
            || bytes.is_empty()
        {
            return Err("文件分块顺序或大小无效".into());
        }
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&u.paths[index])
            .map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        u.written[index] += bytes.len() as u64;
        Ok(())
    }
    pub fn upload_finish(
        self: &Arc<Self>,
        app: &tauri::AppHandle,
        token: &str,
        labels: Vec<String>,
    ) -> R<Value> {
        let upload = self
            .uploads
            .lock()
            .unwrap()
            .remove(token)
            .ok_or("文件上传已失效")?;
        let result = if upload.sizes != upload.written {
            Err("文件内容未完整传入".into())
        } else if upload.paths.len() == 1 && media::extension(&upload.paths[0]) == "zip" {
            let window = app.get_webview_window("main").ok_or("主窗口已关闭")?;
            app.state::<Runtime>()
                .backups
                .inspect(&window, &upload.paths[0])
        } else {
            self.intake(app, &upload.paths, Some(labels))
                .map(|_| Value::Null)
        };
        let _ = std::fs::remove_dir_all(upload.folder);
        result
    }
    pub fn upload_discard(&self, token: &str) {
        if let Some(u) = self.uploads.lock().unwrap().remove(token) {
            let _ = std::fs::remove_dir_all(u.folder);
        }
    }
}
fn save_image(path: &Path, data: &str) -> R<()> {
    let encoded = data
        .strip_prefix("data:image/jpeg;base64,")
        .or_else(|| data.strip_prefix("data:image/png;base64,"))
        .ok_or("页面图片格式无效")?;
    if encoded.len() > 70 * 1024 * 1024 {
        return Err("页面图片过大".into());
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| "页面图片无效")?;
    media::decode(&bytes)?;
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}
