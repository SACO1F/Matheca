use crate::{
    backups::{self, Owned},
    data, media, mobile_http as http, model as m,
    repository::{fingerprint, Repository},
    worker::Worker,
    Runtime,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::Read,
    net::{Shutdown, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use tauri::{Manager, WebviewWindow};
type R<T> = Result<T, String>;
const MAX_FILE: u64 = 50 * 1024 * 1024;
const MAX_TOTAL: u64 = 200 * 1024 * 1024;
fn now() -> u64 {
    m::now().parse().unwrap()
}
fn random() -> R<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "无法创建随机凭据")?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn equal(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |n, (a, b)| n | (a ^ b)) == 0
}
fn hex(s: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&s.len()) && s.bytes().all(|c| c.is_ascii_hexdigit())
}
fn uuid(s: &str) -> bool {
    uuid::Uuid::parse_str(s).is_ok_and(|id| id.to_string() == s)
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Photo {
    id: String,
    name: String,
    size: u64,
    ext: String,
    upload_id: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Device {
    id: String,
    name: String,
    hash: String,
    paired_at: u64,
}
#[derive(Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Saved {
    server_id: String,
    port: u16,
    files: Vec<Photo>,
    devices: Vec<Device>,
    receipts: Vec<(String, String)>,
    libraries: Vec<Value>,
}
impl Default for Saved {
    fn default() -> Self {
        Self {
            server_id: uuid::Uuid::new_v4().to_string(),
            port: 0,
            files: vec![],
            devices: vec![],
            receipts: vec![],
            libraries: vec![],
        }
    }
}
struct Session {
    stop: Arc<AtomicBool>,
    sockets: Arc<Mutex<HashMap<String, TcpStream>>>,
    workers: Arc<Mutex<Vec<JoinHandle<()>>>>,
    listener: Option<JoinHandle<()>>,
}
struct Preview {
    _validated: Owned,
    revision: String,
    local: Value,
    archive_hash: String,
}
struct Inner {
    saved: Saved,
    session: Option<Session>,
    session_id: String,
    token: String,
    urls: Vec<String>,
    qr: Vec<Value>,
    hosts: HashSet<String>,
    expires: u64,
    status: String,
    pairing: Option<Value>,
    connected: bool,
    rejected: HashSet<String>,
    inflight: HashMap<String, u64>,
    importing: bool,
    imported: usize,
    batches: Vec<(String, usize)>,
    transfers: Vec<Value>,
    previews: HashMap<String, Preview>,
    remote: Option<(Value, u64)>,
    uploads: usize,
    load_error: Option<String>,
}
pub struct Mobile {
    inner: Mutex<Inner>,
    gate: Mutex<()>,
    closing: AtomicBool,
    folder: PathBuf,
    _lease: Option<File>,
}
fn persist(repo: &Repository, saved: &Saved) -> R<()> {
    let text = serde_json::to_string(saved).map_err(|e| e.to_string())?;
    repo.task_write(|db| data::set_setting(db, "tauriMobileState", &text))
}
fn photo_path(folder: &Path, p: &Photo) -> PathBuf {
    folder.join(format!("{}.{}", p.id, p.ext))
}
fn regular(path: &Path) -> R<()> {
    use std::os::windows::fs::MetadataExt;
    let meta = fs::symlink_metadata(path).map_err(|_| "文件无法读取")?;
    if meta.file_attributes() & 0x400 != 0 {
        return Err("不支持链接资料".into());
    }
    Ok(())
}
fn owned_folder(root: &Path, name: &str) -> R<PathBuf> {
    let p = root.join(name);
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    regular(&p)?;
    if !p
        .canonicalize()
        .map_err(|e| e.to_string())?
        .starts_with(root.canonicalize().map_err(|e| e.to_string())?)
    {
        return Err("资料路径无效".into());
    }
    Ok(p)
}
impl Mobile {
    pub fn new(repo: &Repository) -> Arc<Self> {
        let folder = repo.root.join("mobile-inbox");
        let mut load_error = None;
        let mut saved = Saved::default();
        let lease = (|| -> R<File> {
            owned_folder(&repo.root, "mobile-inbox")?;
            let file = OpenOptions::new()
                .create(true)
                .truncate(false)
                .read(true)
                .write(true)
                .open(folder.join("service.lock"))
                .map_err(|e| e.to_string())?;
            fs2::FileExt::try_lock_exclusive(&file)
                .map_err(|_| "手机联动正由另一个应用窗口管理")?;
            Ok(file)
        })();
        let lease = match lease {
            Ok(f) => Some(f),
            Err(e) => {
                load_error = Some(e);
                None
            }
        };
        if lease.is_some() {
            let loaded = (|| -> R<()> {
                let text = repo.task_read(|db| data::setting(db, "tauriMobileState"))?;
                if !text.is_empty() {
                    if text.len() > 4 * 1024 * 1024 {
                        return Err("接收记录过大".into());
                    }
                    saved = serde_json::from_str(&text)
                        .map_err(|_| "手机接收记录损坏，请保留资料目录")?;
                }
                if !uuid(&saved.server_id)
                    || saved.files.len() > 20
                    || saved.devices.len() > 10
                    || saved.receipts.len() > 5000
                    || saved.libraries.len() > 20
                {
                    return Err("手机接收记录无效".into());
                }
                for p in &saved.files {
                    if !uuid(&p.id)
                        || !hex(&p.upload_id, 16, 64)
                        || !matches!(p.ext.as_str(), "png" | "jpg" | "webp" | "heic")
                        || p.name.len() > 600
                        || p.size == 0
                        || p.size > MAX_FILE
                    {
                        return Err("照片接收记录无效".into());
                    }
                }
                for d in &saved.devices {
                    if !hex(&d.id, 32, 32) || !hex(&d.hash, 64, 64) || d.name.len() > 240 {
                        return Err("配对记录无效".into());
                    }
                }
                if saved
                    .receipts
                    .iter()
                    .any(|(u, id)| !hex(u, 16, 64) || !uuid(id))
                {
                    return Err("上传回执无效".into());
                }
                for l in &saved.libraries {
                    if !uuid(l["id"].as_str().unwrap_or(""))
                        || !matches!(l["status"].as_str(), Some("received" | "imported"))
                    {
                        return Err("题库收件记录无效".into());
                    }
                }
                let jobs = repo.task_read(|db| data::records(db, "jobs"))?;
                saved.files.retain(|p| {
                    let file = photo_path(&folder, p);
                    let label = file.file_name().unwrap().to_string_lossy();
                    file.metadata()
                        .is_ok_and(|m| m.is_file() && m.len() == p.size)
                        && !jobs.iter().any(|j| {
                            j["labels"]
                                .as_array()
                                .is_some_and(|a| a.iter().any(|v| v == label.as_ref()))
                        })
                });
                for l in &mut saved.libraries {
                    let id = l["id"].as_str().unwrap();
                    if repo.task_read(|db| data::setting(db, &format!("exchange:{id}")))? == "done"
                    {
                        l["status"] = json!("imported");
                    }
                }
                for e in fs::read_dir(&folder).map_err(|e| e.to_string())?.flatten() {
                    let path = e.path();
                    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                    if path.extension().is_some_and(|s| s == "part") && uuid(stem) {
                        regular(&path)?;
                        fs::remove_file(path).map_err(|e| e.to_string())?;
                    }
                }
                persist(repo, &saved)
            })();
            if let Err(e) = loaded {
                load_error = Some(e)
            }
        }
        Arc::new(Self {
            inner: Mutex::new(Inner {
                saved,
                session: None,
                session_id: uuid::Uuid::new_v4().to_string(),
                token: String::new(),
                urls: vec![],
                qr: vec![],
                hosts: HashSet::new(),
                expires: 0,
                status: "closed".into(),
                pairing: None,
                connected: false,
                rejected: HashSet::new(),
                inflight: HashMap::new(),
                importing: false,
                imported: 0,
                batches: vec![],
                transfers: vec![],
                previews: HashMap::new(),
                remote: None,
                uploads: 0,
                load_error,
            }),
            gate: Mutex::new(()),
            closing: AtomicBool::new(false),
            folder,
            _lease: lease,
        })
    }
    pub fn state(&self, repo: &Repository) -> R<Value> {
        let i = self.inner.lock().unwrap();
        self.state_locked(&i, repo)
    }
    fn state_locked(&self, i: &Inner, repo: &Repository) -> R<Value> {
        let jobs = repo.task_read(|db| data::records(db, "jobs"))?;
        let tasks=i.batches.iter().map(|(id,n)|{let j=jobs.iter().find(|j|j["id"]==*id);json!({"id":id,"photos":n,"status":j.and_then(|j|j["status"].as_str()).unwrap_or("unavailable"),"completed":j.map(|j|j["completed"].clone()).unwrap_or(json!(0)),"total":j.map(|j|j["total"].clone()).unwrap_or(json!(n))})}).collect::<Vec<_>>();
        Ok(
            json!({"sessionId":i.session_id,"status":if i.importing{"importing"}else{&i.status},"urls":i.urls,"qrCodes":i.qr,"expiresAt":i.expires,"connected":i.connected,"imported":i.imported,"pairing":i.pairing,"transfers":i.transfers.iter().map(public_transfer).collect::<Vec<_>>(),"tasks":tasks,"libraries":i.saved.libraries,"pairedDevices":i.saved.devices.iter().map(|d|json!({"id":d.id,"name":d.name,"pairedAt":d.paired_at})).collect::<Vec<_>>(),"inventoryReady":i.remote.as_ref().is_some_and(|(_,at)|now()-at<30000),"files":i.saved.files.iter().map(|p|json!({"id":p.id,"name":p.name,"size":p.size,"preview":format!("http://matheca-asset.localhost/mobile/{}/{}",i.session_id,p.id)})).collect::<Vec<_>>() }),
        )
    }
    pub fn start(self: &Arc<Self>, window: &WebviewWindow) -> R<Value> {
        let _gate = self
            .gate
            .try_lock()
            .map_err(|_| "手机联动正在处理，请稍后")?;
        if self.closing.load(Ordering::SeqCst) {
            return Err("应用正在退出".into());
        }
        {
            let i = self.inner.lock().unwrap();
            if let Some(e) = &i.load_error {
                return Err(e.clone());
            }
            if i.status == "receiving" && now() < i.expires {
                return self.state_locked(&i, &window.state::<Runtime>().repository);
            }
        }
        self.pause_inner();
        let outgoing = self.folder.join("outgoing");
        if outgoing.is_dir()
            && fs::read(outgoing.join(".matheca-owned")).ok().as_deref()
                == Some(b"MathecaTauriMobileOutgoing-v1")
        {
            regular(&outgoing)?;
            for e in fs::read_dir(&outgoing)
                .map_err(|e| e.to_string())?
                .flatten()
            {
                let p = e.path();
                if uuid(p.file_stem().and_then(|s| s.to_str()).unwrap_or(""))
                    && matches!(media::extension(&p).as_str(), "pdf" | "docx" | "zip")
                {
                    regular(&p)?;
                    fs::remove_file(p).map_err(|e| e.to_string())?;
                }
            }
        }
        let port = self.inner.lock().unwrap().saved.port;
        let bind = if std::env::var_os("MATHECA_TEST_DATA").is_some() {
            std::env::var("MATHECA_MOBILE_BIND").unwrap_or("0.0.0.0".into())
        } else {
            "0.0.0.0".into()
        };
        if !["0.0.0.0", "127.0.0.1"].contains(&bind.as_str()) {
            return Err("测试监听地址无效".into());
        }
        let listener = TcpListener::bind((bind.as_str(), port))
            .or_else(|_| TcpListener::bind((bind.as_str(), 0)))
            .map_err(|_| "无法开启局域网接收，请检查端口与网络")?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let addresses = if bind == "127.0.0.1" {
            vec!["127.0.0.1".into()]
        } else {
            let v = http::addresses()?;
            if v.is_empty() {
                vec!["127.0.0.1".into()]
            } else {
                v
            }
        };
        let token = random()?;
        let urls = addresses
            .iter()
            .map(|a| format!("http://{a}:{port}/#pair={token}"))
            .collect::<Vec<_>>();
        let stop = Arc::new(AtomicBool::new(false));
        let qr = Worker::new(window.app_handle(), &stop)?.call("mobileQr", json!([urls]), &stop)?;
        let sockets = Arc::new(Mutex::new(HashMap::<String, TcpStream>::new()));
        let workers = Arc::new(Mutex::new(vec![]));
        {
            let mut i = self.inner.lock().unwrap();
            i.saved.port = port;
            persist(&window.state::<Runtime>().repository, &i.saved)?;
            i.session_id = uuid::Uuid::new_v4().to_string();
            i.token = token;
            i.urls = urls;
            i.qr = qr.as_array().ok_or("二维码生成失败")?.clone();
            i.hosts = addresses
                .iter()
                .chain(["127.0.0.1".to_string(), "localhost".to_string()].iter())
                .map(|a| format!("{a}:{port}"))
                .collect();
            i.expires = now() + 15 * 60 * 1000;
            i.status = "receiving".into();
            i.pairing = None;
            i.connected = false;
            i.rejected.clear();
            i.remote = None;
            i.imported = 0;
            i.batches.clear();
            i.transfers.clear();
            i.uploads = 0;
        }
        let mobile = self.clone();
        let app = window.app_handle().clone();
        let cancelled = stop.clone();
        let conns = sockets.clone();
        let joins = workers.clone();
        let thread = thread::spawn(move || {
            while !cancelled.load(Ordering::SeqCst) {
                {
                    let mut i = mobile.inner.lock().unwrap();
                    if now() >= i.expires {
                        i.status = "expired".into();
                        i.token.clear();
                        i.pairing = None;
                        i.connected = false;
                        cancelled.store(true, Ordering::SeqCst);
                    }
                }
                if cancelled.load(Ordering::SeqCst) {
                    break;
                }
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let id = uuid::Uuid::new_v4().to_string();
                        let mut sockets = conns.lock().unwrap();
                        if sockets.len() >= 12 {
                            let _ = stream.shutdown(Shutdown::Both);
                            continue;
                        }
                        let Ok(copy) = stream.try_clone() else {
                            continue;
                        };
                        sockets.insert(id.clone(), copy);
                        drop(sockets);
                        let service = mobile.clone();
                        let app = app.clone();
                        let stop = cancelled.clone();
                        let conns = conns.clone();
                        let handle = thread::spawn(move || {
                            let mut download = None;
                            let response = match http::head(&mut stream, &stop) {
                                Ok(req) => service
                                    .route(&app, &req, &mut stream, &stop, &mut download)
                                    .unwrap_or_else(|e| {
                                        http::Response::json(e.0, json!({"error":e.1}))
                                    }),
                                Err(e) => http::Response::json(400, json!({"error":e})),
                            };
                            let sent = http::send(&mut stream, response, &stop).is_ok();
                            if let Some(id) = download {
                                let mut i = service.inner.lock().unwrap();
                                if let Some(t) = i.transfers.iter_mut().find(|t| t["id"] == id) {
                                    t["status"] =
                                        json!(if sent { "transferred" } else { "failed" });
                                }
                            }
                            http::finish(&mut stream);
                            conns.lock().unwrap().remove(&id);
                        });
                        let mut joins = joins.lock().unwrap();
                        joins.retain(|h: &JoinHandle<()>| !h.is_finished());
                        joins.push(handle);
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(30))
                    }
                    Err(_) => break,
                }
            }
            for stream in conns.lock().unwrap().values() {
                let _ = stream.shutdown(Shutdown::Both);
            }
        });
        self.inner.lock().unwrap().session = Some(Session {
            stop,
            sockets,
            workers,
            listener: Some(thread),
        });
        self.state(&window.state::<Runtime>().repository)
    }
    fn pause_inner(&self) {
        let session = {
            let mut i = self.inner.lock().unwrap();
            i.status = "closed".into();
            i.token.clear();
            i.pairing = None;
            i.connected = false;
            i.remote = None;
            i.session.take()
        };
        if let Some(mut s) = session {
            s.stop.store(true, Ordering::SeqCst);
            for stream in s.sockets.lock().unwrap().values() {
                let _ = stream.shutdown(Shutdown::Both);
            }
            if let Some(h) = s.listener.take() {
                let _ = h.join();
            }
            let handles = std::mem::take(&mut *s.workers.lock().unwrap());
            for h in handles {
                let _ = h.join();
            }
        }
    }
    pub fn pause(&self) {
        let _gate = self.gate.lock().unwrap();
        self.pause_inner()
    }
    pub fn stop(&self) {
        self.closing.store(true, Ordering::SeqCst);
        self.pause();
        self.inner.lock().unwrap().previews.clear();
    }
    pub fn reset(&self) {
        self.closing.store(false, Ordering::SeqCst)
    }
    pub fn control(&self, repo: &Repository, channel: &str, id: &str) -> R<Value> {
        let _gate = self.gate.try_lock().map_err(|_| "手机联动正在处理")?;
        let mut i = self.inner.lock().unwrap();
        match channel {
            "mobile:approve" => {
                if i.status != "receiving"
                    || now() >= i.expires
                    || i.pairing.as_ref().is_none_or(|p| p["id"] != id)
                {
                    return Err("连接请求已失效".into());
                }
                i.pairing.as_mut().unwrap()["approved"] = json!(true);
            }
            "mobile:reject" => {
                if i.pairing.as_ref().is_none_or(|p| p["id"] != id) {
                    return Err("连接请求已失效".into());
                }
                i.rejected.insert(id.into());
                i.pairing = None;
                i.connected = false;
                i.remote = None;
            }
            "mobile:forget-device" => {
                let old = i.saved.devices.clone();
                i.saved.devices.retain(|d| d.id != id);
                if let Err(e) = persist(repo, &i.saved) {
                    i.saved.devices = old;
                    return Err(e);
                }
                if i.pairing.as_ref().is_some_and(|p| p["id"] == id) {
                    i.rejected.insert(id.into());
                    if let Some(s) = &i.session {
                        for stream in s.sockets.lock().unwrap().values() {
                            let _ = stream.shutdown(Shutdown::Both);
                        }
                    }
                    i.pairing = None;
                    i.connected = false;
                    i.remote = None;
                }
            }
            "mobile:remove" => {
                if i.importing || !i.inflight.is_empty() {
                    return Err("正在接收或提交照片，请稍后移除".into());
                }
                let pos = i
                    .saved
                    .files
                    .iter()
                    .position(|p| p.id == id)
                    .ok_or("照片不存在")?;
                let photo = i.saved.files.remove(pos);
                if let Err(e) = persist(repo, &i.saved) {
                    i.saved.files.insert(pos, photo);
                    return Err(e);
                }
                let _ = fs::remove_file(photo_path(&self.folder, &photo));
            }
            _ => return Err("手机操作无效".into()),
        }
        self.state_locked(&i, repo)
    }
    pub fn copy_address(&self, index: usize) -> R<Value> {
        let i = self.inner.lock().unwrap();
        if i.status != "receiving" || now() >= i.expires {
            return Err("连接地址不可用".into());
        }
        http::clipboard(i.urls.get(index).ok_or("网络序号无效")?)?;
        Ok(Value::Null)
    }
    pub fn image(&self, session: &str, id: &str) -> R<(Vec<u8>, &'static str)> {
        let i = self.inner.lock().unwrap();
        if session != i.session_id {
            return Err("照片会话失效".into());
        }
        let p = i
            .saved
            .files
            .iter()
            .find(|p| p.id == id)
            .ok_or("照片不存在")?;
        let path = photo_path(&self.folder, p);
        regular(&path)?;
        let bytes = media::read_owned(self.folder.parent().unwrap(), &path)?;
        if p.ext == "heic" {
            Ok((media::png(&media::heic(&bytes)?)?, "image/png"))
        } else {
            Ok((bytes, mime(&p.ext)))
        }
    }
    pub fn confirm(&self, app: &tauri::AppHandle) -> R<Value> {
        let _gate = self.gate.try_lock().map_err(|_| "手机联动正在处理")?;
        let snapshot = {
            let mut i = self.inner.lock().unwrap();
            if !i.inflight.is_empty() || i.importing {
                return Err("照片正在传输，请稍后开始识别".into());
            }
            if i.saved.files.is_empty() {
                return Err("请先用手机发送照片".into());
            }
            i.importing = true;
            i.saved.files.clone()
        };
        let result = (|| {
            let runtime = app.state::<Runtime>();
            let jobs = runtime
                .repository
                .task_read(|db| data::records(db, "jobs"))?;
            let paths = snapshot
                .iter()
                .map(|p| photo_path(&self.folder, p))
                .filter(|p| {
                    !jobs.iter().any(|j| {
                        j["labels"].as_array().is_some_and(|a| {
                            a.iter()
                                .any(|v| v.as_str() == p.file_name().and_then(|s| s.to_str()))
                        })
                    })
                })
                .collect::<Vec<_>>();
            let id = if paths.is_empty() {
                None
            } else {
                Some(runtime.jobs.intake(app, &paths, None)?)
            };
            let mut i = self.inner.lock().unwrap();
            let old = i.saved.files.clone();
            i.saved
                .files
                .retain(|p| !snapshot.iter().any(|s| s.id == p.id));
            if let Err(e) = persist(&runtime.repository, &i.saved) {
                i.saved.files = old;
                return Err(e);
            }
            if let Some(id) = id {
                i.batches.push((id, paths.len()));
            }
            i.imported += snapshot.len();
            for p in &snapshot {
                let _ = fs::remove_file(photo_path(&self.folder, p));
            }
            Ok(json!(snapshot.len()))
        })();
        self.inner.lock().unwrap().importing = false;
        result
    }
    fn valid_session(i: &Inner, session: &str, device: &str) -> bool {
        i.status == "receiving"
            && now() < i.expires
            && i.session_id == session
            && i.pairing
                .as_ref()
                .is_some_and(|p| p["id"] == device && p["approved"] == true)
            && !i.rejected.contains(device)
    }
    fn route(
        &self,
        app: &tauri::AppHandle,
        req: &http::Request,
        stream: &mut TcpStream,
        stop: &AtomicBool,
        download: &mut Option<String>,
    ) -> Result<http::Response, (u16, String)> {
        let err = |e: String| (400, e);
        let repo = &app.state::<Runtime>().repository;
        let host = req.h("host");
        {
            let i = self.inner.lock().unwrap();
            if !i.hosts.contains(host)
                || (!req.h("origin").is_empty() && req.h("origin") != format!("http://{host}"))
            {
                return Err((403, "连接地址或来源无效".into()));
            }
        }
        if req.method == "GET" && req.path == "/" {
            use base64::Engine;
            let page = include_str!("../../../src/shared/phone-page.html");
            let script = page
                .split("<script>")
                .nth(1)
                .and_then(|s| s.split("</script>").next())
                .unwrap_or("")
                .replace("\r\n", "\n")
                .replace('\r', "\n");
            let digest =
                base64::engine::general_purpose::STANDARD.encode(Sha256::digest(script.as_bytes()));
            return Ok(http::Response{status:200,mime:"text/html; charset=utf-8".into(),body:http::Body::Bytes(page.as_bytes().to_vec()),headers:vec![("Referrer-Policy".into(),"no-referrer".into()),("Content-Security-Policy".into(),format!("default-src 'none'; script-src 'sha256-{digest}'; style-src 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"))]});
        }
        let supplied = req.h("authorization").strip_prefix("Bearer ").unwrap_or("");
        let device = req.h("x-device-id");
        let session;
        {
            let mut i = self.inner.lock().unwrap();
            let remembered = i
                .saved
                .devices
                .iter()
                .any(|d| d.id == device && equal(&d.hash, &hash(supplied.as_bytes())));
            if i.status != "receiving"
                || now() >= i.expires
                || !hex(supplied, 64, 64)
                || i.token.is_empty()
                || (!remembered && !equal(&i.token, supplied))
            {
                return Err((401, "连接已失效，请重新开启并扫码".into()));
            }
            if !hex(device, 32, 32) || i.rejected.contains(device) {
                return Err((403, "设备无效或电脑已拒绝连接".into()));
            }
            if i.pairing.is_none() {
                i.pairing = Some(
                    json!({"id":device,"code":device[26..].to_ascii_uppercase(),"approved":remembered}),
                );
            }
            if i.pairing.as_ref().unwrap()["id"] != device {
                return Err((409, "已有手机连接，请先在电脑结束连接".into()));
            }
            i.connected = true;
            session = i.session_id.clone();
            if i.pairing.as_ref().unwrap()["approved"] != true {
                if req.method != "GET" || req.path != "/api/state" {
                    return Err((403, "请先在电脑确认连接".into()));
                }
                return Ok(http::Response::json(
                    200,
                    json!({"approved":false,"code":i.pairing.as_ref().unwrap()["code"],"expiresAt":i.expires}),
                ));
            }
        }
        match (req.method.as_str(), req.path.as_str()) {
            ("GET", "/api/state") => {
                let i = self.inner.lock().unwrap();
                if !Self::valid_session(&i, &session, device) {
                    return Err((401, "连接已结束".into()));
                }
                let state = self.state_locked(&i, repo).map_err(err)?;
                Ok(http::Response::json(
                    200,
                    json!({"approved":true,"serverId":i.saved.server_id,"remembered":i.saved.devices.iter().any(|d|d.id==device),"inventoryVersion":1,"code":i.pairing.as_ref().unwrap()["code"],"tasks":state["tasks"],"libraries":state["libraries"],"transfers":state["transfers"],"receipts":i.saved.receipts.iter().map(|(upload,id)|json!({"uploadId":upload,"id":id})).collect::<Vec<_>>(),"expiresAt":i.expires,"importing":i.importing,"imported":i.imported,"files":i.saved.files.iter().map(|p|json!({"id":p.id,"name":p.name,"size":p.size,"uploadId":p.upload_id})).collect::<Vec<_>>() }),
                ))
            }
            ("POST", "/api/trust") => {
                let credential = random().map_err(err)?;
                let name = decode(req.h("x-device-name"))
                    .map_err(err)?
                    .chars()
                    .filter(|c| !c.is_control())
                    .take(60)
                    .collect::<String>();
                let mut i = self.inner.lock().unwrap();
                if !Self::valid_session(&i, &session, device) {
                    return Err((401, "连接已结束".into()));
                }
                if i.saved.devices.len() >= 10 && !i.saved.devices.iter().any(|d| d.id == device) {
                    return Err((413, "最多记住 10 台手机".into()));
                }
                let old = i.saved.devices.clone();
                i.saved.devices.retain(|d| d.id != device);
                i.saved.devices.push(Device {
                    id: device.into(),
                    name: if name.is_empty() {
                        "Android 手机".into()
                    } else {
                        name
                    },
                    hash: hash(credential.as_bytes()),
                    paired_at: now(),
                });
                if let Err(e) = persist(repo, &i.saved) {
                    i.saved.devices = old;
                    return Err(err(e));
                }
                Ok(http::Response::json(
                    200,
                    json!({"serverId":i.saved.server_id,"credential":credential}),
                ))
            }
            ("POST", "/api/upload") | ("POST", "/api/library") => {
                self.receive(app, req, stream, stop, &session, device)
            }
            ("GET", "/api/inventory") => {
                let d = portable_snapshot(repo).map_err(err)?;
                let w = app
                    .get_webview_window("main")
                    .ok_or((500, "主窗口已关闭".into()))?;
                let value = Worker::new(app, stop)
                    .and_then(|worker| worker.call("exchangeInventory", json!([d]), stop))
                    .map_err(err)?;
                drop(w);
                Ok(http::Response::json(200, value))
            }
            ("POST", "/api/inventory") => {
                let size = req.length(8 * 1024 * 1024).map_err(|e| (413, e))?;
                let mut bytes = Vec::new();
                req.receive(stream, &mut bytes, size, stop).map_err(err)?;
                let value: Value =
                    serde_json::from_slice(&bytes).map_err(|_| (400, "资料摘要无效".into()))?;
                validate_inventory(&value).map_err(err)?;
                let mut i = self.inner.lock().unwrap();
                if !Self::valid_session(&i, &session, device) {
                    return Err((401, "连接已结束".into()));
                }
                i.remote = Some((value, now()));
                Ok(http::Response::json(200, json!({"received":true})))
            }
            _ if req.method == "GET" && req.path.starts_with("/api/photo/") => {
                let i = self.inner.lock().unwrap();
                let p = i
                    .saved
                    .files
                    .iter()
                    .find(|p| p.id == req.path[11..])
                    .ok_or((404, "照片不存在".into()))?;
                Ok(http::Response::file(
                    photo_path(&self.folder, p),
                    mime(&p.ext),
                ))
            }
            _ if req.method == "GET" && req.path.starts_with("/api/download/") => {
                let mut i = self.inner.lock().unwrap();
                let t = i
                    .transfers
                    .iter_mut()
                    .find(|t| t["id"] == req.path[14..])
                    .ok_or((404, "文件不存在或连接已结束".into()))?;
                if t["status"] == "downloading" {
                    return Err((409, "文件正在传输".into()));
                }
                t["status"] = json!("downloading");
                *download = t["id"].as_str().map(String::from);
                let path = PathBuf::from(t["file"].as_str().unwrap());
                let ext = media::extension(&path);
                let mut response = http::Response::file(path, mime(&ext));
                response.headers.push((
                    "Content-Disposition".into(),
                    format!(
                        "attachment; filename=\"Matheca.{ext}\"; filename*=UTF-8''{}",
                        percent_encoding::utf8_percent_encode(
                            t["name"].as_str().unwrap(),
                            percent_encoding::NON_ALPHANUMERIC
                        )
                    ),
                ));
                Ok(response)
            }
            _ => Err((404, "请求不存在".into())),
        }
    }

    fn receive(
        &self,
        app: &tauri::AppHandle,
        req: &http::Request,
        stream: &mut TcpStream,
        stop: &AtomicBool,
        session: &str,
        device: &str,
    ) -> Result<http::Response, (u16, String)> {
        let err = |e: String| (400, e);
        let library = req.path == "/api/library";
        let upload = req.h("x-upload-id");
        if !(if library {
            uuid(upload)
        } else {
            hex(upload, 16, 64)
        }) {
            return Err((400, "上传编号无效".into()));
        }
        let size = req
            .length(if library { 512 * 1024 * 1024 } else { MAX_FILE })
            .map_err(|e| (413, e))?;
        if req.h("content-type")
            != if library {
                "application/zip"
            } else {
                "application/octet-stream"
            }
        {
            return Err((400, "上传类型无效".into()));
        }
        {
            let mut i = self.inner.lock().unwrap();
            if library {
                if i.saved.libraries.iter().any(|l| l["id"] == upload)
                    || !app
                        .state::<Runtime>()
                        .repository
                        .task_read(|db| data::setting(db, &format!("exchange:{upload}")))
                        .map_err(err)?
                        .is_empty()
                {
                    return Ok(http::Response::json(
                        200,
                        json!({"id":upload,"received":true}),
                    ));
                }
                if !i.inflight.is_empty() {
                    return Err((409, "正在接收其他资料".into()));
                }
                if i.saved
                    .libraries
                    .iter()
                    .filter(|l| l["status"] == "received")
                    .count()
                    >= 10
                {
                    return Err((413, "请先处理待接收题库".into()));
                }
            } else {
                if let Some((_, id)) = i.saved.receipts.iter().find(|(u, _)| u == upload) {
                    return Ok(http::Response::json(200, json!({"id":id})));
                }
                if i.importing {
                    return Err((409, "电脑正在提交识别".into()));
                }
                if i.uploads >= 400 || i.saved.files.len() + i.inflight.len() >= 20 {
                    return Err((413, "每批最多 20 张，本次连接最多 400 张".into()));
                }
                if i.inflight.contains_key(upload) || i.inflight.len() >= 2 {
                    return Err((409, "有照片正在发送，请稍后重试".into()));
                }
                if i.saved.files.iter().map(|p| p.size).sum::<u64>()
                    + i.inflight.values().sum::<u64>()
                    + size
                    > MAX_TOTAL
                {
                    return Err((413, "每批照片合计最多 200 MB".into()));
                }
            }
            i.inflight.insert(upload.into(), size);
        }
        let _flight = Flight {
            mobile: self,
            id: upload.into(),
        };
        let id = uuid::Uuid::new_v4().to_string();
        let temp = Temp(self.folder.join(format!("{id}.part")));
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp.0)
            .map_err(|_| (500, "无法保存接收文件".into()))?;
        req.receive(stream, &mut file, size, stop).map_err(err)?;
        file.sync_all()
            .map_err(|_| (500, "无法保存接收文件".into()))?;
        drop(file);
        if library {
            let _verified = validated(app, &temp.0, stop).map_err(err)?;
            let dir = owned_folder(&self.folder, "libraries").map_err(err)?;
            let target = dir.join(format!("{upload}.zip"));
            let mut i = self.inner.lock().unwrap();
            if !Self::valid_session(&i, session, device) || stop.load(Ordering::SeqCst) {
                return Err((401, "连接已结束".into()));
            }
            fs::rename(&temp.0, &target).map_err(|_| (500, "无法保存题库文件".into()))?;
            let before = i.saved.libraries.clone();
            i.saved.libraries.retain(|l| l["status"] != "imported");
            i.saved.libraries.push(json!({"id":upload,"name":format!("手机 {} 题库资料.zip",&device[26..].to_ascii_uppercase()),"size":size,"status":"received","receivedAt":now()}));
            if let Err(e) = persist(&app.state::<Runtime>().repository, &i.saved) {
                i.saved.libraries = before;
                let _ = fs::remove_file(target);
                return Err(err(e));
            }
            return Ok(http::Response::json(
                201,
                json!({"id":upload,"received":true}),
            ));
        }
        let mut header = [0u8; 64];
        let n = File::open(&temp.0)
            .and_then(|mut f| f.read(&mut header))
            .map_err(|_| (400, "无法读取照片".into()))?;
        let ext = photo_extension(&header[..n]).map_err(err)?;
        // Decode once before committing, enforcing the same pixel limits as desktop intake.
        let bytes = fs::read(&temp.0).map_err(|_| (400, "无法读取照片".into()))?;
        if ext == "heic" {
            media::heic(&bytes).map_err(err)?;
        } else {
            media::decode(&bytes).map_err(err)?;
        }
        let name = decode(req.h("x-file-name"))
            .map_err(err)?
            .chars()
            .map(|c| {
                if c.is_control() || ['/', '\\'].contains(&c) {
                    '_'
                } else {
                    c
                }
            })
            .take(150)
            .collect::<String>();
        let photo = Photo {
            id: id.clone(),
            name: if name.is_empty() {
                "手机照片".into()
            } else {
                name
            },
            size,
            ext: ext.into(),
            upload_id: upload.into(),
        };
        let target = photo_path(&self.folder, &photo);
        let mut i = self.inner.lock().unwrap();
        if !Self::valid_session(&i, session, device) || stop.load(Ordering::SeqCst) {
            return Err((401, "连接已结束，照片未提交".into()));
        }
        if i.saved.files.iter().map(|p| p.size).sum::<u64>() + size > MAX_TOTAL {
            return Err((413, "照片总量超出限制".into()));
        }
        fs::rename(&temp.0, &target).map_err(|_| (500, "无法保存照片".into()))?;
        let receipts = i.saved.receipts.clone();
        i.saved.files.push(photo);
        i.saved.receipts.push((upload.into(), id.clone()));
        if i.saved.receipts.len() > 5000 {
            i.saved.receipts.remove(0);
        }
        if let Err(e) = persist(&app.state::<Runtime>().repository, &i.saved) {
            i.saved.files.retain(|p| p.id != id);
            i.saved.receipts = receipts;
            let _ = fs::remove_file(target);
            return Err(err(e));
        }
        i.uploads += 1;
        Ok(http::Response::json(201, json!({"id":id})))
    }
    pub fn share(&self, window: &WebviewWindow, path: &Path) -> R<Value> {
        let _gate = self.gate.try_lock().map_err(|_| "手机联动正在处理")?;
        let bytes = window.state::<Runtime>().documents.generated_bytes(path)?;
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        self.share_bytes(window, &name, &media::extension(path), &bytes)
    }
    fn share_bytes(&self, window: &WebviewWindow, name: &str, ext: &str, bytes: &[u8]) -> R<Value> {
        let mut i = self.inner.lock().unwrap();
        if i.status != "receiving" || now() >= i.expires {
            return Err("请先开启手机联动".into());
        }
        if i.transfers.len() >= 10 {
            return Err("本次连接最多发送 10 份文件".into());
        }
        let dir = owned_folder(&self.folder, "outgoing")?;
        fs::write(dir.join(".matheca-owned"), b"MathecaTauriMobileOutgoing-v1")
            .map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let file = dir.join(format!("{id}.{ext}"));
        fs::write(&file, bytes).map_err(|_| "无法准备发送文件")?;
        i.transfers.push(json!({"id":id,"name":name,"size":bytes.len(),"status":"ready","kind":"document","file":file.to_string_lossy()}));
        self.state_locked(&i, &window.state::<Runtime>().repository)
    }
    pub fn inspect_library(&self, window: &WebviewWindow, id: &str) -> R<Value> {
        let _gate = self.gate.try_lock().map_err(|_| "题库交换正在处理")?;
        if !uuid(id) {
            return Err("资料编号无效".into());
        }
        let path = self.folder.join("libraries").join(format!("{id}.zip"));
        {
            let i = self.inner.lock().unwrap();
            if !i
                .saved
                .libraries
                .iter()
                .any(|l| l["id"] == id && l["status"] == "received")
            {
                return Err("待接收资料不存在".into());
            }
        }
        let cancel = &self.closing;
        let (own, incoming) = validated(window.app_handle(), &path, cancel)?;
        let local = portable_snapshot(&window.state::<Runtime>().repository)?;
        let revision = local["revision"].as_str().unwrap().to_string();
        let plan = Worker::new(window.app_handle(), cancel)?.call(
            "exchangePlan",
            json!([local, incoming]),
            cancel,
        )?;
        let details = plan["details"].as_array().ok_or("资料预览无效")?;
        let result = json!({"id":id,"questions":incoming["questions"].as_array().unwrap().len(),"collections":incoming["collections"].as_array().unwrap().len(),"missingImages":incoming["missingSources"],"added":details.iter().filter(|d|d["status"]=="new").count(),"repeated":details.iter().filter(|d|d["status"]=="same").count(),"conflicts":details.iter().filter(|d|d["status"]=="conflict").count(),"details":details});
        self.inner.lock().unwrap().previews.insert(
            id.into(),
            Preview {
                _validated: own,
                revision,
                local,
                archive_hash: file_hash(&path)?,
            },
        );
        Ok(result)
    }
    pub fn apply_library(&self, window: &WebviewWindow, id: &str, policy: &str) -> R<Value> {
        let _gate = self.gate.try_lock().map_err(|_| "题库交换正在处理")?;
        if !["keep", "replace", "copy"].contains(&policy) || !uuid(id) {
            return Err("冲突处理方式无效".into());
        }
        let preview = self
            .inner
            .lock()
            .unwrap()
            .previews
            .remove(id)
            .ok_or("请先预览待接收资料")?;
        let path = self.folder.join("libraries").join(format!("{id}.zip"));
        let repo = &window.state::<Runtime>().repository;
        if file_hash(&path)? != preview.archive_hash {
            return Err("待接收资料已变化，请重新预览".into());
        }
        let current = portable_snapshot(repo)?;
        if current != preview.local {
            return Err("本机题库已变化，请重新预览后确认".into());
        }
        // Re-read archive and images at confirmation; no cached decoded data is trusted.
        let (own, incoming) = validated(window.app_handle(), &path, &self.closing)?;
        let plan = Worker::new(window.app_handle(), &self.closing)?.call(
            "exchangePlan",
            json!([current, incoming, policy]),
            &self.closing,
        )?;
        backups::restore_exchange(
            repo,
            &plan["data"],
            &own.path.join("images"),
            &self.closing,
            policy == "replace",
            Some((id, &preview.revision)),
        )?;
        let mut i = self.inner.lock().unwrap();
        if let Some(l) = i.saved.libraries.iter_mut().find(|l| l["id"] == id) {
            l["status"] = json!("imported");
        }
        let _ = persist(repo, &i.saved);
        let _ = fs::remove_file(path);
        drop(i);
        drop(preview);
        crate::jobs::changed(window.app_handle());
        Ok(Value::Null)
    }
    pub fn discard_library(&self, repo: &Repository, id: &str) -> R<Value> {
        let _gate = self.gate.try_lock().map_err(|_| "题库交换正在处理")?;
        if !uuid(id) {
            return Err("资料编号无效".into());
        }
        let mut i = self.inner.lock().unwrap();
        let before = i.saved.libraries.clone();
        i.saved.libraries.retain(|l| l["id"] != id);
        if let Err(e) = persist(repo, &i.saved) {
            i.saved.libraries = before;
            return Err(e);
        }
        i.previews.remove(id);
        let _ = fs::remove_file(self.folder.join("libraries").join(format!("{id}.zip")));
        Ok(Value::Null)
    }
    pub fn send_library(&self, window: &WebviewWindow, selection: &Value) -> R<Value> {
        let _gate = self.gate.try_lock().map_err(|_| "手机联动正在处理")?;
        let mut selected = selection.clone();
        let qs = m::ids(&selection["questionIds"])?;
        let cs = m::ids(&selection["collectionIds"])?;
        if qs.is_empty() && cs.is_empty() {
            return Err("请先选择题目或题集".into());
        }
        let changed = selection
            .get("changedOnly")
            .map(|v| v.as_bool().ok_or("发送方式无效"))
            .transpose()?
            .unwrap_or(false);
        {
            let i = self.inner.lock().unwrap();
            if i.status != "receiving" || now() >= i.expires {
                return Err("请先开启手机联动".into());
            }
        }
        if changed {
            let remote = {
                let i = self.inner.lock().unwrap();
                if !i.pairing.as_ref().is_some_and(|p| p["approved"] == true) {
                    return Err("请先连接手机".into());
                }
                i.remote
                    .as_ref()
                    .filter(|(_, at)| now() - at < 30000)
                    .map(|(v, _)| v.clone())
                    .ok_or("请先在手机检查连接更新资料摘要")?
            };
            let d = portable_snapshot(&window.state::<Runtime>().repository)?;
            let inventory = Worker::new(window.app_handle(), &self.closing)?.call(
                "exchangeInventory",
                json!([d]),
                &self.closing,
            )?;
            let mut qs = qs;
            for item in d["items"].as_array().unwrap() {
                if cs.iter().any(|c| item["collectionId"] == *c) {
                    qs.push(item["questionId"].as_str().unwrap().into());
                }
            }
            let mut unique = HashSet::new();
            qs.retain(|q| unique.insert(q.clone()));
            if qs.iter().any(|q| inventory["questions"].get(q).is_none())
                || cs.iter().any(|c| inventory["collections"].get(c).is_none())
            {
                return Err("所选资料已变化".into());
            }
            selected = json!({"questionIds":qs.into_iter().filter(|q|inventory["questions"][q]!=remote["questions"][q]).collect::<Vec<_>>(),"collectionIds":cs.into_iter().filter(|c|inventory["collections"][c]!=remote["collections"][c]).collect::<Vec<_>>()});
            if selected["questionIds"].as_array().unwrap().is_empty()
                && selected["collectionIds"].as_array().unwrap().is_empty()
            {
                return Err("所选资料与手机一致，无需发送".into());
            }
        }
        let own = Owned::new(&window.state::<Runtime>().repository.root, "backup-staging")?;
        let path = own.path.join("exchange.zip");
        window
            .state::<Runtime>()
            .backups
            .export_selected(window, &path, Some(&selected))?;
        let dir = owned_folder(&self.folder, "outgoing")?;
        fs::write(dir.join(".matheca-owned"), b"MathecaTauriMobileOutgoing-v1")
            .map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let target = dir.join(format!("{id}.zip"));
        let result = (|| {
            backups::copy_bounded(&path, &target, &self.closing, 512 * 1024 * 1024)?;
            let mut i = self.inner.lock().unwrap();
            if i.status != "receiving" || now() >= i.expires {
                return Err("连接已结束，请重新发送".into());
            }
            if i.transfers.len() >= 10 {
                return Err("本次连接最多发送 10 份文件".into());
            }
            let size = target.metadata().map_err(|e| e.to_string())?.len();
            i.transfers.push(json!({"id":id,"name":format!("题库资料-{}.zip",now()),"size":size,"status":"ready","kind":"library","file":target.to_string_lossy()}));
            self.state_locked(&i, &window.state::<Runtime>().repository)
        })();
        if result.is_err() {
            let _ = fs::remove_file(target);
        }
        result
    }
}
fn public_transfer(t: &Value) -> Value {
    let mut t = t.clone();
    t.as_object_mut().unwrap().remove("file");
    t
}
struct Flight<'a> {
    mobile: &'a Mobile,
    id: String,
}
impl Drop for Flight<'_> {
    fn drop(&mut self) {
        self.mobile.inner.lock().unwrap().inflight.remove(&self.id);
    }
}
struct Temp(PathBuf);
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
fn decode(s: &str) -> R<String> {
    percent_encoding::percent_decode_str(s)
        .decode_utf8()
        .map(|s| s.into_owned())
        .map_err(|_| "名称编码无效".into())
}
fn mime(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" => "image/jpeg",
        "webp" => "image/webp",
        "heic" => "image/heic",
        "zip" => "application/zip",
        "pdf" => "application/pdf",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        _ => "application/octet-stream",
    }
}
pub fn photo_extension(b: &[u8]) -> R<&'static str> {
    if b.len() >= 16 && b.starts_with(b"\x89PNG\r\n\x1a\n") && &b[12..16] == b"IHDR" {
        Ok("png")
    } else if b.starts_with(&[255, 216, 255]) {
        Ok("jpg")
    } else if b.len() >= 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Ok("webp")
    } else if b.len() >= 12
        && &b[4..8] == b"ftyp"
        && [b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"]
            .iter()
            .any(|brand| b[8..b.len().min(48)].windows(4).any(|s| s == *brand))
    {
        Ok("heic")
    } else {
        Err("请选择 JPEG、PNG、WebP 或 HEIC 照片".into())
    }
}
fn file_hash(path: &Path) -> R<String> {
    regular(path)?;
    let mut f = File::open(path).map_err(|_| "文件无法读取")?;
    let mut digest = Sha256::new();
    let mut total = 0u64;
    let mut b = [0; 65536];
    loop {
        let n = f.read(&mut b).map_err(|_| "文件读取失败")?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > 512 * 1024 * 1024 {
            return Err("文件超过限制".into());
        }
        digest.update(&b[..n]);
    }
    Ok(format!("{:x}", digest.finalize()))
}
fn revision(repo: &Repository) -> R<String> {
    repo.task_read(|db| {
        db.query_row(
            "SELECT COALESCE((SELECT value FROM tauri_meta WHERE key='mutationRevision'),'0')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())
    })
}
fn portable_snapshot(repo: &Repository) -> R<Value> {
    let before = revision(repo)?;
    let mut d = backups::snapshot(repo)?;
    let mut sources = serde_json::Map::new();
    let mut current = Vec::new();
    for q in d["questions"].as_array().unwrap() {
        let id = m::id(&q["id"])?;
        let raw = q["sourcePath"].as_str().unwrap_or("");
        if !raw.is_empty() && Path::new(raw).try_exists().map_err(|_| "无法读取原图")? {
            let path = Path::new(raw).canonicalize().map_err(|_| "无法读取原图")?;
            if !path.starts_with(repo.root.canonicalize().map_err(|e| e.to_string())?) {
                return Err("原图不在资料目录内".into());
            }
            sources.insert(
                id.into(),
                json!(format!("sources/{}.img", file_hash(&path)?)),
            );
        }
        if !q["solution"].as_str().unwrap_or("").is_empty()
            && q["solutionFingerprint"].as_str() == Some(&fingerprint(q))
        {
            current.push(json!(id));
        }
    }
    if revision(repo)? != before {
        return Err("本机题库已变化，请重试".into());
    }
    d["sources"] = Value::Object(sources);
    d["currentSolutions"] = json!(current);
    d["revision"] = json!(before);
    Ok(d)
}
fn validated(app: &tauri::AppHandle, path: &Path, cancel: &AtomicBool) -> R<(Owned, Value)> {
    let root = &app.state::<Runtime>().repository.root;
    let own = Owned::new(root, "backup-staging")?;
    let text = backups::read_archive(path, &own.path.join("images"), cancel)?;
    let data = Worker::new(app, cancel)?.call("backupDecode", json!([text]), cancel)?;
    backups::validate(&data, &own.path.join("images"))?;
    Ok((own, data))
}
fn validate_inventory(v: &Value) -> R<()> {
    if v["version"] != 1 {
        return Err("资料摘要版本无效".into());
    }
    for (key, max) in [("questions", 20000), ("collections", 5000)] {
        let map = v[key]
            .as_object()
            .filter(|m| m.len() <= max)
            .ok_or("资料摘要数量无效")?;
        if map.iter().any(|(id, v)| {
            id.is_empty() || m::len(id) > 200 || !v.as_str().is_some_and(|s| hex(s, 64, 64))
        }) {
            return Err("资料摘要无效".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn magic_and_inventory_bounds_match_protocol() {
        assert_eq!(
            photo_extension(b"\x89PNG\r\n\x1a\n1234IHDR").unwrap(),
            "png"
        );
        assert_eq!(photo_extension(&[255, 216, 255, 0]).unwrap(), "jpg");
        assert_eq!(photo_extension(b"RIFF1234WEBP").unwrap(), "webp");
        assert_eq!(photo_extension(b"1234ftypheic").unwrap(), "heic");
        assert!(photo_extension(b"not an image").is_err());
        assert!(validate_inventory(
            &json!({"version":1,"questions":{"q":"invalid"},"collections":{}})
        )
        .is_err());
        assert!(validate_inventory(
            &json!({"version":1,"questions":{"q":"a".repeat(64)},"collections":{}})
        )
        .is_ok());
    }
    #[test]
    fn credentials_are_random_and_only_hashes_are_persisted() {
        let a = random().unwrap();
        let b = random().unwrap();
        assert!(hex(&a, 64, 64));
        assert_ne!(a, b);
        assert!(equal(&a, &a));
        assert!(!equal(&a, &b));
        assert!(!equal(&a, ""));
        let saved = Saved {
            devices: vec![Device {
                id: "1".repeat(32),
                name: "测试手机".into(),
                hash: hash(a.as_bytes()),
                paired_at: now(),
            }],
            ..Saved::default()
        };
        let text = serde_json::to_string(&saved).unwrap();
        assert!(!text.contains(&a));
        assert!(text.contains(&hash(a.as_bytes())));
    }
    #[test]
    fn expired_rejected_and_other_session_cannot_commit_uploads() {
        let root =
            std::env::temp_dir().join(format!("matheca-mobile-session-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let repo = Repository::new(root.clone());
        let mobile = Mobile::new(&repo);
        let mut i = mobile.inner.lock().unwrap();
        i.status = "receiving".into();
        i.session_id = "current".into();
        i.expires = now() + 1000;
        i.pairing = Some(json!({"id":"device","approved":true}));
        assert!(Mobile::valid_session(&i, "current", "device"));
        assert!(!Mobile::valid_session(&i, "old", "device"));
        assert!(!Mobile::valid_session(&i, "current", "other"));
        i.expires = now();
        assert!(!Mobile::valid_session(&i, "current", "device"));
        i.expires = now() + 1000;
        i.rejected.insert("device".into());
        assert!(!Mobile::valid_session(&i, "current", "device"));
        i.rejected.clear();
        i.status = "closed".into();
        assert!(!Mobile::valid_session(&i, "current", "device"));
        drop(i);
        drop(mobile);
        drop(repo);
        fs::remove_dir_all(root).unwrap();
    }
}
