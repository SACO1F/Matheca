use crate::{
    data, model as m,
    repository::{fingerprint, Repository},
    worker::Worker,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
type R<T> = Result<T, String>;
const ARCHIVE: u64 = 512 * 1024 * 1024;
const MANIFEST: u64 = 32 * 1024 * 1024;
const IMAGE: u64 = 50 * 1024 * 1024;
const MARKER: &[u8] = b"MathecaTauriBackup-v1";
#[derive(Default)]
pub struct Backups {
    gate: Mutex<()>,
    cancel: AtomicBool,
    previews: Mutex<HashMap<String, Owned>>,
}
pub(crate) struct Owned {
    pub(crate) path: PathBuf,
    lease: Option<File>,
    keep: bool,
}
fn ordinary(path: &Path) -> R<fs::Metadata> {
    use std::os::windows::fs::MetadataExt;
    let meta = fs::symlink_metadata(path).map_err(|_| "文件不存在或无法读取")?;
    if meta.file_attributes() & 0x400 != 0 {
        return Err("不支持链接或重解析路径".into());
    }
    Ok(meta)
}
impl Owned {
    pub(crate) fn new(root: &Path, parent: &str) -> R<Self> {
        let base = root.join(parent);
        fs::create_dir_all(&base).map_err(|e| e.to_string())?;
        if !ordinary(&base)?.is_dir()
            || !base
                .canonicalize()
                .map_err(|e| e.to_string())?
                .starts_with(root.canonicalize().map_err(|e| e.to_string())?)
        {
            return Err("临时目录不在资料目录中".into());
        }
        let path = base.join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&path).map_err(|e| e.to_string())?;
        let lease = OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(path.join(".lease"))
            .map_err(|e| e.to_string())?;
        fs2::FileExt::lock_exclusive(&lease).map_err(|e| e.to_string())?;
        fs::write(path.join(".matheca-owned"), MARKER).map_err(|e| e.to_string())?;
        Ok(Self {
            path,
            lease: Some(lease),
            keep: false,
        })
    }
}
impl Drop for Owned {
    fn drop(&mut self) {
        drop(self.lease.take());
        if !self.keep {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}
fn check(cancel: &AtomicBool) -> R<()> {
    if cancel.load(Ordering::SeqCst) {
        Err("应用正在退出，已取消题库操作".into())
    } else {
        Ok(())
    }
}
pub fn source_entry(name: &str) -> bool {
    let Some(s) = name.strip_prefix("sources/") else {
        return false;
    };
    let Some((hash, ext)) = s.split_once('.') else {
        return false;
    };
    hash.len() == 64
        && hash
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        && ["jpg", "jpeg", "png", "webp", "heic", "heif", "img"].contains(&ext)
}
// Read through EOF so zip validates each CRC. Never extract archive paths.
pub fn read_archive(file: &Path, stage: &Path, cancel: &AtomicBool) -> R<String> {
    let meta = ordinary(file)?;
    if !meta.is_file() || meta.len() > ARCHIVE {
        return Err("备份不是普通文件或超过 512 MB".into());
    }
    fs::create_dir(stage).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(File::open(file).map_err(|e| e.to_string())?)
        .map_err(|_| "无法读取 ZIP 备份")?;
    if zip.len() > 20001 {
        return Err("ZIP 条目过多".into());
    }
    let mut names = HashSet::new();
    let mut total = 0;
    let mut manifest = None;
    for i in 0..zip.len() {
        check(cancel)?;
        let mut entry = zip.by_index(i).map_err(|_| "ZIP 条目无效、加密或损坏")?;
        let name = std::str::from_utf8(entry.name_raw())
            .map_err(|_| "ZIP 路径编码无效")?
            .to_string();
        let max = if name == "manifest.json" {
            MANIFEST
        } else {
            IMAGE
        };
        if !names.insert(name.clone())
            || !(name == "manifest.json" || source_entry(&name))
            || entry.size() > max
            || entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
        {
            return Err("ZIP 条目重复、路径无效或超过限制".into());
        }
        total += entry.size();
        if total > ARCHIVE {
            return Err("备份解压内容超过 512 MB".into());
        }
        let mut bytes = Vec::new();
        let mut buf = [0u8; 65536];
        loop {
            check(cancel)?;
            let n = entry
                .read(&mut buf)
                .map_err(|_| "备份 CRC 或压缩数据校验失败")?;
            if n == 0 {
                break;
            }
            if bytes.len() as u64 + n as u64 > max || bytes.len() as u64 + n as u64 > entry.size() {
                return Err("备份条目长度无效".into());
            }
            bytes.extend_from_slice(&buf[..n]);
        }
        if bytes.len() as u64 != entry.size() {
            return Err("备份条目长度无效".into());
        }
        if name == "manifest.json" {
            manifest = Some(String::from_utf8(bytes).map_err(|_| "清单不是有效 UTF-8")?)
        } else {
            let basename = name.strip_prefix("sources/").unwrap();
            if format!("{:x}", Sha256::digest(&bytes)) != basename.split('.').next().unwrap() {
                return Err("原图哈希校验失败".into());
            }
            fs::write(stage.join(basename), bytes).map_err(|e| e.to_string())?;
        }
    }
    manifest
        .filter(|s| !s.is_empty())
        .ok_or("备份缺少清单".into())
}
fn array<'a>(v: &'a Value, key: &str, max: usize) -> R<&'a Vec<Value>> {
    v[key]
        .as_array()
        .filter(|a| a.len() <= max)
        .ok_or(format!("备份字段 {key} 数量无效"))
}
// Pure shared decoder validates figures, layout, numeric ranges and domain rules;
// Rust also checks every identity, source mapping and relational constraint.
pub(crate) fn validate(data: &Value, stage: &Path) -> R<()> {
    let qs = array(data, "questions", 20000)?;
    let cs = array(data, "collections", 5000)?;
    let items = array(data, "items", 100000)?;
    array(data, "customKnowledge", 5000)?;
    let mut qids = HashSet::new();
    let mut cids = HashSet::new();
    for (records, ids) in [(qs, &mut qids), (cs, &mut cids)] {
        for v in records {
            if !ids.insert(m::id(&v["id"])?) {
                return Err("备份有重复编号".into());
            }
            m::string(&v["createdAt"], 32)?
                .parse::<i64>()
                .map_err(|_| "时间超出范围")?;
        }
    }
    let mut pairs = HashSet::new();
    let mut positions = HashSet::new();
    for i in items {
        let c = m::id(&i["collectionId"])?;
        let q = m::id(&i["questionId"])?;
        let n = i["position"]
            .as_i64()
            .filter(|n| *n >= 0 && *n <= i32::MAX as i64)
            .ok_or("排序数据无效")?;
        if !qids.contains(q)
            || !cids.contains(c)
            || !pairs.insert((c, q))
            || !positions.insert((c, n))
        {
            return Err("题集关联数据不完整或重复".into());
        }
    }
    let sources = data["sources"].as_object().ok_or("原图映射无效")?;
    let mut expected = HashSet::new();
    for (id, name) in sources {
        let name = name.as_str().ok_or("原图路径无效")?;
        if !qids.contains(id.as_str()) || !source_entry(name) {
            return Err("原图映射无效".into());
        }
        expected.insert(name.strip_prefix("sources/").unwrap().to_string());
    }
    let actual = fs::read_dir(stage)
        .map_err(|e| e.to_string())?
        .map(|e| {
            e.map(|e| e.file_name().to_string_lossy().into_owned())
                .map_err(|e| e.to_string())
        })
        .collect::<R<HashSet<_>>>()?;
    if actual != expected {
        return Err("备份缺少原图或包含额外文件".into());
    }
    Ok(())
}
pub(crate) fn snapshot(repo: &Repository) -> R<Value> {
    repo.task_read(|db|{
 db.execute_batch("BEGIN DEFERRED").map_err(|e|e.to_string())?;
 let mut stmt=db.prepare("SELECT collectionId,questionId,position FROM items ORDER BY position").map_err(|e|e.to_string())?;
 let items=stmt.query_map([],|r|Ok(json!({"collectionId":r.get::<_,String>(0)?,"questionId":r.get::<_,String>(1)?,"position":r.get::<_,i64>(2)?}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
 Ok(json!({"questions":data::records(db,"questions")?,"collections":data::records(db,"collections")?,"items":items,"customKnowledge":data::records(db,"knowledge")?,"sources":{},"currentSolutions":[],"missingSources":0}))
})
}
pub fn restore(repo: &Repository, data: &Value, stage: &Path, cancel: &AtomicBool) -> R<Value> {
    restore_exchange(repo, data, stage, cancel, false, None)
}
pub(crate) fn restore_exchange(
    repo: &Repository,
    data: &Value,
    stage: &Path,
    cancel: &AtomicBool,
    replace: bool,
    guard: Option<(&str, &str)>,
) -> R<Value> {
    validate(data, stage)?;
    let mut batch = Owned::new(&repo.root, "restored")?;
    let result=repo.task_write(|db|{
  if let Some((receipt,revision))=guard {
   if !data::setting(db,&format!("exchange:{receipt}"))?.is_empty(){return Err("此资料已经导入".into())}
   let current:String=db.query_row("SELECT COALESCE((SELECT value FROM tauri_meta WHERE key='mutationRevision'),'0')",[],|r|r.get(0)).map_err(|e|e.to_string())?;
   if current!=revision{return Err("本机题库已变化，请重新预览后确认".into())}
  }
  let qs=data["questions"].as_array().unwrap();let cs=data["collections"].as_array().unwrap();let mut nq=0;let mut nc=0;let mut nk=0;
  let mut new_c=HashSet::new();
  for original in qs{check(cancel)?;let id=m::id(&original["id"])?;if !replace && data::get(db,"questions",id)?.is_some(){continue}
   let mut q=original.clone();q["sourcePath"]=json!("");
   if let Some(entry)=data["sources"][id].as_str(){let name=entry.strip_prefix("sources/").ok_or("原图路径无效")?;let target=batch.path.join(name);if !target.exists(){fs::copy(stage.join(name),&target).map_err(|e|e.to_string())?;}q["sourcePath"]=json!(target.to_string_lossy());}
   q["solutionFingerprint"]=json!(if data["currentSolutions"].as_array().is_some_and(|a|a.iter().any(|v|v==id)){fingerprint(&q)}else{String::new()});
   if replace {for mut job in data::records(db,"jobs")?{if job["type"]=="solution" && job["questionId"]==id && ["queued","processing"].iter().any(|s|job["status"]==*s){job["status"]=json!("paused");job["runId"]=Value::Null;job["message"]=json!("题库交换已更新题目，旧解答停止");data::put(db,"jobs",&job)?;}}}
   data::put(db,"questions",&q)?;nq+=1;
  }
  for c in cs{check(cancel)?;let id=m::id(&c["id"])?;if replace || data::get(db,"collections",id)?.is_none(){if replace {db.execute("DELETE FROM items WHERE collectionId=?1",[id]).map_err(|e|e.to_string())?;}data::put(db,"collections",c)?;new_c.insert(id);nc+=1;}}
  let mut items=data["items"].as_array().unwrap().iter().collect::<Vec<_>>();items.sort_by_key(|i|i["position"].as_i64().unwrap());let mut positions:HashMap<&str,i64>=HashMap::new();
  for i in items{let c=i["collectionId"].as_str().unwrap();if new_c.contains(c){let pos=positions.entry(c).or_default();db.execute("INSERT INTO items VALUES(?1,?2,?3)",rusqlite::params![c,i["questionId"].as_str().unwrap(),*pos]).map_err(|e|e.to_string())?;*pos+=1;}}
  let mut points=data::records(db,"knowledge")?;
  for p in data["customKnowledge"].as_array().unwrap(){if !points.iter().any(|v|v["name"]==p["name"]){let point=m::point(p,&points)?;db.execute("INSERT INTO knowledge(name,data) VALUES(?1,?2)",rusqlite::params![point["name"].as_str().unwrap(),point.to_string()]).map_err(|e|e.to_string())?;points.push(point);nk+=1;}}
  check(cancel)?;
  db.execute("INSERT INTO batches VALUES(?1,?2)",rusqlite::params![batch.path.file_name().unwrap().to_string_lossy(),batch.path.to_string_lossy()]).map_err(|e|e.to_string())?;
  if let Some((receipt,_))=guard {data::set_setting(db,&format!("exchange:{receipt}"),"done")?;}
  crate::tasks_store::bump(db)?;data::audit(db,"导入题库备份",&format!("新增 {nq} 道题、{nc} 个题集"),"operation","success")?;
  Ok(json!({"questions":nq,"collections":nc,"skippedQuestions":qs.len()-nq,"skippedCollections":cs.len()-nc,"knowledgePoints":nk}))
 })?;
    batch.keep = true;
    Ok(result)
}
pub(crate) fn copy_bounded(source: &Path, target: &Path, cancel: &AtomicBool, max: u64) -> R<()> {
    let meta = ordinary(source)?;
    if !meta.is_file() || meta.len() > max {
        return Err("文件不是普通文件或超过大小限制".into());
    }
    let mut input = File::open(source).map_err(|e| e.to_string())?;
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(target)
        .map_err(|e| e.to_string())?;
    let mut total = 0;
    let mut buf = [0; 65536];
    loop {
        check(cancel)?;
        let n = input.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > max {
            return Err("文件读取超过大小限制".into());
        }
        output.write_all(&buf[..n]).map_err(|e| e.to_string())?;
    }
    output.sync_all().map_err(|e| e.to_string())?;
    Ok(())
}
fn publish(temp: &Path, target: &Path) -> R<()> {
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
    .map_err(|_| "无法保存备份，文件可能被占用；原文件未删除".into())
}
impl Backups {
    pub fn stop(&self) {
        self.cancel.store(true, Ordering::SeqCst);
        if let Ok(_gate) = self.gate.lock() {
            self.previews.lock().unwrap().clear();
        }
    }
    pub fn reset(&self) {
        self.cancel.store(false, Ordering::SeqCst)
    }
    pub fn inspect(&self, window: &WebviewWindow, source: &Path) -> R<Value> {
        let _gate = self.gate.try_lock().map_err(|_| "请等待当前题库操作完成")?;
        check(&self.cancel)?;
        let mut previews = self.previews.lock().unwrap();
        if previews.len() >= 2 {
            return Err("请先确认或取消已有题库预览".into());
        }
        let repo = &window.state::<crate::Runtime>().repository;
        let own = Owned::new(&repo.root, "backup-staging")?;
        copy_bounded(source, &own.path.join("archive.zip"), &self.cancel, ARCHIVE)?;
        let text = read_archive(
            &own.path.join("archive.zip"),
            &own.path.join("images"),
            &self.cancel,
        )?;
        let worker = Worker::new(window.app_handle(), &self.cancel)?;
        let data = worker.call("backupDecode", json!([text]), &self.cancel)?;
        validate(&data, &own.path.join("images"))?;
        let token = uuid::Uuid::new_v4().to_string();
        let preview = json!({"token":token,"questions":data["questions"].as_array().unwrap().len(),"collections":data["collections"].as_array().unwrap().len(),"images":data["sources"].as_object().unwrap().values().collect::<HashSet<_>>().len(),"knowledgePoints":data["customKnowledge"].as_array().unwrap().len(),"missingImages":data["missingSources"]});
        previews.insert(token, own);
        Ok(preview)
    }
    pub fn dismiss(&self, token: &str) -> R<Value> {
        let _gate = self.gate.try_lock().map_err(|_| "请等待当前题库操作完成")?;
        self.previews.lock().unwrap().remove(token);
        Ok(Value::Null)
    }
    pub fn restore(&self, window: &WebviewWindow, token: &str) -> R<Value> {
        let _gate = self.gate.try_lock().map_err(|_| "请等待当前题库操作完成")?;
        check(&self.cancel)?;
        let own = self
            .previews
            .lock()
            .unwrap()
            .remove(token)
            .ok_or("备份预览已过期，请重新选择")?;
        let text = read_archive(
            &own.path.join("archive.zip"),
            &own.path.join("validated"),
            &self.cancel,
        )?;
        let worker = Worker::new(window.app_handle(), &self.cancel)?;
        let data = worker.call("backupDecode", json!([text]), &self.cancel)?;
        let result = restore(
            &window.state::<crate::Runtime>().repository,
            &data,
            &own.path.join("validated"),
            &self.cancel,
        )?;
        let _ = window.emit("state:changed", Value::Null);
        let _ = window.emit("history:changed", Value::Null);
        Ok(result)
    }
    pub fn choose(&self, window: &WebviewWindow) -> R<Value> {
        let Some(file) = window
            .app_handle()
            .dialog()
            .file()
            .set_parent(window)
            .set_title("选择 Matheca 题库备份")
            .add_filter("Matheca 题库", &["zip"])
            .blocking_pick_file()
        else {
            return Ok(Value::Null);
        };
        self.inspect(window, &file.into_path().map_err(|_| "文件路径无效")?)
    }
    pub fn export(&self, window: &WebviewWindow) -> R<Value> {
        let Some(file) = window
            .app_handle()
            .dialog()
            .file()
            .set_parent(window)
            .set_title("备份题库")
            .set_file_name(format!("Matheca-题库-{}.zip", m::now()))
            .add_filter("题库备份", &["zip"])
            .blocking_save_file()
        else {
            return Ok(Value::Null);
        };
        let target = file.into_path().map_err(|_| "文件路径无效")?;
        let missing = self.export_selected(window, &target, None)?;
        Ok(json!({"path":target.to_string_lossy(),"missingImages":missing}))
    }
    pub(crate) fn export_selected(
        &self,
        window: &WebviewWindow,
        target: &Path,
        selection: Option<&Value>,
    ) -> R<u64> {
        let _gate = self.gate.try_lock().map_err(|_| "请等待当前题库操作完成")?;
        check(&self.cancel)?;
        if !target.is_absolute() || crate::media::extension(target) != "zip" {
            return Err("请选择 ZIP 保存路径".into());
        }
        let repo = &window.state::<crate::Runtime>().repository;
        let own = Owned::new(&repo.root, "backup-staging")?;
        let mut data = snapshot(repo)?;
        if let Some(s) = selection {
            let cs = m::ids(&s["collectionIds"])?;
            let mut qs = m::ids(&s["questionIds"])?;
            for i in data["items"].as_array().unwrap() {
                if cs.iter().any(|c| i["collectionId"] == *c) {
                    qs.push(i["questionId"].as_str().unwrap().into());
                }
            }
            if qs.iter().any(|id| {
                !data["questions"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|q| q["id"] == *id)
            }) || cs.iter().any(|id| {
                !data["collections"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|c| c["id"] == *id)
            }) {
                return Err("所选资料已变化，请重新选择".into());
            }
            data["questions"]
                .as_array_mut()
                .unwrap()
                .retain(|q| qs.iter().any(|id| q["id"] == *id));
            data["collections"]
                .as_array_mut()
                .unwrap()
                .retain(|c| cs.iter().any(|id| c["id"] == *id));
            data["items"]
                .as_array_mut()
                .unwrap()
                .retain(|i| cs.iter().any(|id| i["collectionId"] == *id));
        }
        let mut sources = serde_json::Map::new();
        let mut files: HashMap<String, PathBuf> = HashMap::new();
        let mut current = Vec::new();
        let mut missing = 0u64;
        let mut total = 0u64;
        for q in data["questions"].as_array().unwrap() {
            check(&self.cancel)?;
            let id = m::id(&q["id"])?;
            if !q["solution"].as_str().unwrap_or("").is_empty()
                && q["solutionFingerprint"].as_str() == Some(&fingerprint(q))
            {
                current.push(json!(id));
            }
            let raw = q["sourcePath"].as_str().unwrap_or("");
            if raw.is_empty() {
                continue;
            }
            let source = Path::new(raw);
            if !source.try_exists().map_err(|_| "无法检查原图")? {
                missing += 1;
                continue;
            }
            let canonical = source.canonicalize().map_err(|_| "原图无法读取")?;
            if !canonical.starts_with(repo.root.canonicalize().map_err(|e| e.to_string())?) {
                return Err("原图不在题库资料目录内".into());
            }
            let copy = own.path.join(format!("source-{}", files.len()));
            copy_bounded(source, &copy, &self.cancel, IMAGE)?;
            let bytes = fs::read(&copy).map_err(|e| e.to_string())?;
            let ext = crate::media::extension(source);
            let ext = if ["jpg", "jpeg", "png", "webp", "heic", "heif"].contains(&ext.as_str()) {
                ext.as_str()
            } else {
                "img"
            };
            let name = format!("sources/{:x}.{ext}", Sha256::digest(&bytes));
            if !files.contains_key(&name) {
                total += bytes.len() as u64;
                if total > ARCHIVE {
                    return Err("备份内容超过 512 MB".into());
                }
                files.insert(name.clone(), copy);
            } else {
                fs::remove_file(copy).map_err(|e| e.to_string())?;
            }
            sources.insert(id.into(), json!(name));
        }
        data["sources"] = Value::Object(sources);
        data["currentSolutions"] = json!(current);
        data["missingSources"] = json!(missing);
        let worker = Worker::new(window.app_handle(), &self.cancel)?;
        let text = worker
            .call(
                "backupEncode",
                json!([data, env!("CARGO_PKG_VERSION")]),
                &self.cancel,
            )?
            .as_str()
            .ok_or("备份编码失败")?
            .to_string();
        if text.len() as u64 > MANIFEST || total + text.len() as u64 > ARCHIVE {
            return Err("备份内容超过限制".into());
        }
        let temp = target.with_file_name(format!(".matheca-{}.partial", uuid::Uuid::new_v4()));
        let result = (|| {
            let file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .read(true)
                .open(&temp)
                .map_err(|e| e.to_string())?;
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            zip.start_file("manifest.json", options)
                .map_err(|e| e.to_string())?;
            zip.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
            for (name, path) in files {
                check(&self.cancel)?;
                zip.start_file(name, options).map_err(|e| e.to_string())?;
                let mut file = File::open(path).map_err(|e| e.to_string())?;
                let mut buf = [0; 65536];
                loop {
                    check(&self.cancel)?;
                    let n = file.read(&mut buf).map_err(|e| e.to_string())?;
                    if n == 0 {
                        break;
                    }
                    zip.write_all(&buf[..n]).map_err(|e| e.to_string())?;
                }
            }
            let file = zip.finish().map_err(|e| e.to_string())?;
            if file.metadata().map_err(|e| e.to_string())?.len() > ARCHIVE {
                return Err("备份文件超过 512 MB".into());
            }
            file.sync_all().map_err(|e| e.to_string())?;
            drop(file);
            check(&self.cancel)?;
            publish(&temp, target)
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result?;
        Ok(missing)
    }
}
use tauri::Emitter;
pub fn recover_files(root: &Path, db: &rusqlite::Connection) -> R<()> {
    for parent in ["backup-staging", "restored"] {
        let base = root.join(parent);
        if !base.exists() {
            continue;
        }
        if !ordinary(&base)?.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&base).map_err(|e| e.to_string())?.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if uuid::Uuid::parse_str(&name).is_err() || !ordinary(&path)?.is_dir() {
                continue;
            }
            if !path
                .canonicalize()
                .map_err(|e| e.to_string())?
                .starts_with(root.canonicalize().map_err(|e| e.to_string())?)
                || fs::read(path.join(".matheca-owned")).ok().as_deref() != Some(MARKER)
            {
                continue;
            }
            if parent == "restored" {
                let exists: bool = db
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM batches WHERE id=?1)",
                        [&name],
                        |r| r.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                if exists {
                    continue;
                }
            }
            let lease_path = path.join(".lease");
            if ordinary(&lease_path).is_err() {
                continue;
            }
            let lease = OpenOptions::new()
                .read(true)
                .write(true)
                .open(lease_path)
                .map_err(|e| e.to_string())?;
            if fs2::FileExt::try_lock_exclusive(&lease).is_err() {
                continue;
            }
            drop(lease);
            fs::remove_dir_all(path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        let p = std::env::temp_dir().join(format!("matheca-phase6-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&p).unwrap();
        p
    }
    fn fixture() -> Value {
        let mut q = m::new_question("q");
        q["body"] = json!("备份题干");
        q["solution"] = json!("答案：1");
        json!({"questions":[q],"collections":[{"id":"c","createdAt":"1","title":"题集"}],"items":[{"collectionId":"c","questionId":"q","position":8}],"customKnowledge":[],"sources":{},"currentSolutions":["q"],"missingSources":0})
    }
    fn zip(root: &Path, names: &[(&str, &[u8])]) -> PathBuf {
        let p = root.join(format!("{}.zip", uuid::Uuid::new_v4()));
        let mut z = zip::ZipWriter::new(File::create(&p).unwrap());
        for (name, bytes) in names {
            z.start_file(
                *name,
                zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Stored),
            )
            .unwrap();
            z.write_all(bytes).unwrap();
        }
        z.finish().unwrap();
        p
    }
    #[test]
    fn archive_rejects_paths_extra_files_hash_and_crc() {
        let r = root();
        let cancel = AtomicBool::new(false);
        for name in [
            "../escape",
            "sources/../../escape",
            "/absolute",
            "C:/escape",
            "other.txt",
        ] {
            let p = zip(&r, &[(name, b"x")]);
            assert!(read_archive(&p, &r.join(uuid::Uuid::new_v4().to_string()), &cancel).is_err());
        }
        let name = format!("sources/{}.png", "0".repeat(64));
        let p = zip(&r, &[("manifest.json", b"{}"), (&name, b"wrong hash")]);
        assert!(read_archive(&p, &r.join("hash"), &cancel)
            .unwrap_err()
            .contains("哈希"));
        let p = zip(&r, &[("manifest.json", b"unique-crc-body")]);
        let mut bytes = fs::read(&p).unwrap();
        let at = bytes
            .windows(15)
            .position(|b| b == b"unique-crc-body")
            .unwrap();
        bytes[at] ^= 1;
        fs::write(&p, bytes).unwrap();
        assert!(read_archive(&p, &r.join("crc"), &cancel)
            .unwrap_err()
            .contains("CRC"));
        fs::remove_dir_all(r).unwrap();
    }
    #[test]
    fn merge_preserves_local_and_orders_new_collection_without_auto_jobs() {
        let r = root();
        let repo = Repository::new(r.clone());
        let stage = r.join("images");
        fs::create_dir(&stage).unwrap();
        let data = fixture();
        let cancel = AtomicBool::new(false);
        let first = restore(&repo, &data, &stage, &cancel).unwrap();
        assert_eq!(first["questions"], 1);
        repo.task_write(|db| {
            let mut q = data::get(db, "questions", "q")?.unwrap();
            q["body"] = json!("本地编辑");
            data::put(db, "questions", &q)
        })
        .unwrap();
        let second = restore(&repo, &data, &stage, &cancel).unwrap();
        assert_eq!(second["skippedQuestions"], 1);
        assert_eq!(second["skippedCollections"], 1);
        repo.task_read(|db| {
            assert_eq!(
                data::get(db, "questions", "q")?.unwrap()["body"],
                "本地编辑"
            );
            assert!(data::records(db, "jobs")?.is_empty());
            assert_eq!(
                db.query_row("SELECT position FROM items", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                0
            );
            Ok(())
        })
        .unwrap();
        fs::remove_dir_all(r).unwrap();
    }
    #[test]
    fn restore_failure_rolls_back_questions_and_files() {
        let r = root();
        let repo = Repository::new(r.clone());
        let stage = r.join("images");
        fs::create_dir(&stage).unwrap();
        let data = fixture();
        repo.task_write(|db|db.execute_batch("CREATE TRIGGER fail_restore BEFORE INSERT ON collections BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END;").map_err(|e|e.to_string())).unwrap();
        assert!(restore(&repo, &data, &stage, &AtomicBool::new(false)).is_err());
        repo.task_read(|db| {
            assert!(data::records(db, "questions")?.is_empty());
            Ok(())
        })
        .unwrap();
        assert_eq!(fs::read_dir(r.join("restored")).unwrap().count(), 0);
        fs::remove_dir_all(r).unwrap();
    }
    #[test]
    fn recovery_keeps_live_and_committed_batches_and_unmarked_directories() {
        let r = root();
        let repo = Repository::new(r.clone());
        let live = Owned::new(&r, "backup-staging").unwrap();
        let mut orphan = Owned::new(&r, "backup-staging").unwrap();
        orphan.keep = true;
        let dead = orphan.path.clone();
        drop(orphan);
        let unknown = r
            .join("backup-staging")
            .join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&unknown).unwrap();
        let mut committed = Owned::new(&r, "restored").unwrap();
        committed.keep = true;
        repo.task_write(|db| {
            db.execute(
                "INSERT INTO batches VALUES(?1,?2)",
                rusqlite::params![
                    committed.path.file_name().unwrap().to_string_lossy(),
                    committed.path.to_string_lossy()
                ],
            )
            .map_err(|e| e.to_string())?;
            recover_files(&r, db)
        })
        .unwrap();
        assert!(live.path.exists());
        assert!(committed.path.exists());
        assert!(unknown.exists());
        assert!(!dead.exists());
        drop(live);
        drop(committed);
        fs::remove_dir_all(r).unwrap();
    }
    #[test]
    fn exchange_replace_guards_revision_receipt_and_stops_old_solutions() {
        let r = root();
        let repo = Repository::new(r.clone());
        let stage = r.join("images");
        fs::create_dir(&stage).unwrap();
        let mut d = fixture();
        let cancel = AtomicBool::new(false);
        restore(&repo, &d, &stage, &cancel).unwrap();
        repo.task_write(|db|data::put(db,"jobs",&json!({"id":"solve","createdAt":"1","type":"solution","questionId":"q","status":"processing","runId":"old"}))).unwrap();
        d["questions"][0]["body"] = json!("手机修改");
        assert!(
            restore_exchange(&repo, &d, &stage, &cancel, true, Some(("package", "0")))
                .unwrap_err()
                .contains("变化")
        );
        let revision = repo
            .task_read(|db| {
                db.query_row(
                    "SELECT value FROM tauri_meta WHERE key='mutationRevision'",
                    [],
                    |r| r.get::<_, String>(0),
                )
                .map_err(|e| e.to_string())
            })
            .unwrap();
        restore_exchange(
            &repo,
            &d,
            &stage,
            &cancel,
            true,
            Some(("package", &revision)),
        )
        .unwrap();
        repo.task_read(|db| {
            assert_eq!(
                data::get(db, "questions", "q")?.unwrap()["body"],
                "手机修改"
            );
            assert_eq!(data::get(db, "jobs", "solve")?.unwrap()["status"], "paused");
            assert_eq!(data::setting(db, "exchange:package")?, "done");
            Ok(())
        })
        .unwrap();
        assert!(restore_exchange(
            &repo,
            &d,
            &stage,
            &cancel,
            true,
            Some(("package", &revision))
        )
        .unwrap_err()
        .contains("已经导入"));
        fs::remove_dir_all(r).unwrap();
    }
}
