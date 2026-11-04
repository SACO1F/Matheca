use std::{
    collections::HashMap,
    io::{Read, Write},
    net::TcpStream,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
pub type R<T> = Result<T, String>;
pub struct Request {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    prefix: Vec<u8>,
}
pub enum Body {
    Bytes(Vec<u8>),
    File(PathBuf),
}
pub struct Response {
    pub status: u16,
    pub mime: String,
    pub headers: Vec<(String, String)>,
    pub body: Body,
}
impl Response {
    pub fn json(status: u16, value: serde_json::Value) -> Self {
        Self {
            status,
            mime: "application/json; charset=utf-8".into(),
            headers: vec![],
            body: Body::Bytes(value.to_string().into_bytes()),
        }
    }
    pub fn file(path: PathBuf, mime: &str) -> Self {
        Self {
            status: 200,
            mime: mime.into(),
            headers: vec![],
            body: Body::File(path),
        }
    }
}
fn read(
    stream: &mut TcpStream,
    buf: &mut [u8],
    cancel: &AtomicBool,
    deadline: Instant,
) -> R<usize> {
    loop {
        if cancel.load(Ordering::SeqCst) || Instant::now() > deadline {
            return Err("连接已结束或传输超时".into());
        }
        match stream.read(buf) {
            Ok(n) => return Ok(n),
            Err(e)
                if [
                    e.kind() == std::io::ErrorKind::WouldBlock,
                    e.kind() == std::io::ErrorKind::TimedOut,
                ]
                .contains(&true) => {}
            Err(_) => return Err("传输中断".into()),
        }
    }
}
pub fn head(stream: &mut TcpStream, cancel: &AtomicBool) -> R<Request> {
    // Windows accepted sockets inherit the nonblocking listener's mode.
    // Workers use blocking IO with timeouts. Without this, write_all aborts
    // with WSAEWOULDBLOCK once a large response fills the socket buffer.
    stream.set_nonblocking(false).map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(1)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut data = Vec::new();
    let end = loop {
        let mut b = [0; 4096];
        let n = read(stream, &mut b, cancel, deadline)?;
        if n == 0 {
            return Err("请求未完成".into());
        }
        data.extend_from_slice(&b[..n]);
        if let Some(p) = data.windows(4).position(|b| b == b"\r\n\r\n") {
            if p + 4 > 16384 {
                return Err("请求头过大".into());
            }
            break p + 4;
        }
        if data.len() > 16384 {
            return Err("请求头过大".into());
        }
    };
    let mut headers = [httparse::EMPTY_HEADER; 64];
    let mut parsed = httparse::Request::new(&mut headers);
    parsed.parse(&data[..end]).map_err(|_| "请求头无效")?;
    let method = parsed.method.ok_or("请求方法无效")?.to_string();
    let target = parsed.path.ok_or("请求路径无效")?;
    if !target.starts_with('/') || target.starts_with("//") {
        return Err("请求路径无效".into());
    }
    let path = target.split('?').next().unwrap().to_string();
    let mut map = HashMap::new();
    for h in parsed.headers {
        let key = h.name.to_ascii_lowercase();
        let value = std::str::from_utf8(h.value)
            .map_err(|_| "请求头编码无效")?
            .to_string();
        if map.insert(key, value).is_some() {
            return Err("请求头重复".into());
        }
    }
    if map.contains_key("transfer-encoding") {
        return Err("请使用带文件长度的上传".into());
    }
    Ok(Request {
        method,
        path,
        headers: map,
        prefix: data[end..].to_vec(),
    })
}
impl Request {
    pub fn h(&self, key: &str) -> &str {
        self.headers.get(key).map(String::as_str).unwrap_or("")
    }
    pub fn length(&self, max: u64) -> R<u64> {
        let s = self.h("content-length");
        if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
            return Err("文件长度无效".into());
        }
        s.parse::<u64>()
            .ok()
            .filter(|n| *n > 0 && *n <= max)
            .ok_or("文件超过大小限制".into())
    }
    pub fn receive(
        &self,
        stream: &mut TcpStream,
        out: &mut dyn Write,
        size: u64,
        cancel: &AtomicBool,
    ) -> R<()> {
        if self.prefix.len() as u64 > size {
            return Err("数据超过声明长度".into());
        }
        out.write_all(&self.prefix)
            .map_err(|_| "无法保存接收数据")?;
        let mut received = self.prefix.len() as u64;
        let deadline = Instant::now() + Duration::from_secs(90);
        let mut b = [0; 65536];
        while received < size {
            let max = (size - received).min(b.len() as u64) as usize;
            let n = read(stream, &mut b[..max], cancel, deadline)?;
            if n == 0 {
                return Err("上传未完成".into());
            }
            out.write_all(&b[..n]).map_err(|_| "无法保存接收数据")?;
            received += n as u64;
        }
        if cancel.load(Ordering::SeqCst) {
            return Err("连接已结束".into());
        }
        Ok(())
    }
}
pub fn send(stream: &mut TcpStream, response: Response, cancel: &AtomicBool) -> R<()> {
    let file_transfer = matches!(&response.body, Body::File(_));
    // A phone can temporarily stop reading while saving or switching apps.
    // File downloads need a larger bounded budget than small JSON responses.
    stream
        .set_write_timeout(Some(Duration::from_secs(if file_transfer {
            30
        } else {
            5
        })))
        .map_err(|_| "无法配置传输超时")?;
    let (length, mut input): (u64, Box<dyn Read>) = match response.body {
        Body::Bytes(bytes) => (bytes.len() as u64, Box::new(std::io::Cursor::new(bytes))),
        Body::File(p) => {
            let f = std::fs::File::open(p).map_err(|_| "文件无法读取")?;
            (f.metadata().map_err(|e| e.to_string())?.len(), Box::new(f))
        }
    };
    let mut head=format!("HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {length}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n",response.status,if response.status<400{"OK"}else{"Error"},response.mime);
    for (k, v) in response.headers {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("\r\n");
    stream
        .write_all(head.as_bytes())
        .map_err(|_| "连接已断开")?;
    let deadline = Instant::now() + Duration::from_secs(if file_transfer { 600 } else { 90 });
    let mut b = [0; 65536];
    loop {
        if cancel.load(Ordering::SeqCst) || Instant::now() > deadline {
            return Err("连接已结束或传输超时".into());
        }
        let n = input.read(&mut b).map_err(|_| "读取文件失败")?;
        if n == 0 {
            break;
        }
        stream.write_all(&b[..n]).map_err(|_| "连接已断开")?;
    }
    Ok(())
}
// Send FIN before a bounded drain, so rejected uploads receive the error body
// instead of Windows resetting a socket that still has unread request bytes.
pub fn finish(stream: &mut TcpStream) {
    let _ = stream.shutdown(std::net::Shutdown::Write);
    let _ = stream.set_read_timeout(Some(Duration::from_millis(100)));
    let mut buf = [0u8; 8192];
    let deadline = Instant::now() + Duration::from_millis(200);
    for _ in 0..128 {
        if Instant::now() > deadline {
            break;
        }
        match stream.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
    }
}
pub fn addresses() -> R<Vec<String>> {
    use windows::Win32::NetworkManagement::IpHelper::{
        GetBestInterface, GetIpAddrTable, MIB_IPADDRTABLE,
    };
    // Query Windows routing locally; this does not send an Internet request.
    // Lexical IP sorting otherwise puts WSL/virtual adapters ahead of Wi-Fi.
    let mut preferred = 0u32;
    let preferred =
        if unsafe { GetBestInterface(u32::from_ne_bytes([1, 1, 1, 1]), &mut preferred) } == 0 {
            Some(preferred)
        } else {
            None
        };
    let mut size = 16384u32;
    for _ in 0..3 {
        let mut aligned = vec![0u64; (size as usize).div_ceil(8)];
        let table = aligned.as_mut_ptr().cast::<MIB_IPADDRTABLE>();
        let result = unsafe { GetIpAddrTable(Some(table), &mut size, false) };
        if result == 122 {
            if size > 1024 * 1024 {
                return Err("网络接口数量异常".into());
            }
            continue;
        }
        if result != 0 {
            return Err("无法读取本机网络地址".into());
        }
        let count = unsafe { (*table).dwNumEntries as usize };
        let rows = unsafe { std::slice::from_raw_parts((*table).table.as_ptr(), count) };
        let mut out = vec![];
        for row in rows {
            let ip = std::net::Ipv4Addr::from(row.dwAddr.to_ne_bytes());
            if !ip.is_unspecified() && !ip.is_loopback() && !ip.is_link_local() {
                out.push((Some(row.dwIndex) != preferred, ip.to_string()));
            }
        }
        out.sort();
        out.dedup();
        return Ok(out.into_iter().map(|(_, ip)| ip).collect());
    }
    Err("网络地址正在变化，请重试".into())
}
pub fn clipboard(text: &str) -> R<()> {
    use windows::Win32::{
        Foundation::{GlobalFree, HANDLE, HGLOBAL},
        System::{
            DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
            Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
        },
    };
    unsafe {
        OpenClipboard(None).map_err(|_| "剪贴板正在使用")?;
        let result = (|| {
            let data = text.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
            let memory =
                GlobalAlloc(GMEM_MOVEABLE, data.len() * 2).map_err(|_| "无法分配剪贴板内存")?;
            let ptr = GlobalLock(memory);
            if ptr.is_null() {
                let _ = GlobalFree(Some(memory));
                return Err("无法写入剪贴板".into());
            }
            std::ptr::copy_nonoverlapping(data.as_ptr(), ptr.cast::<u16>(), data.len());
            let _ = GlobalUnlock(memory);
            if EmptyClipboard().is_err() || SetClipboardData(13, Some(HANDLE(memory.0))).is_err() {
                let _ = GlobalFree(Some(HGLOBAL(memory.0)));
                return Err("无法写入剪贴板".into());
            }
            Ok(())
        })();
        let _ = CloseClipboard();
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nonblocking_listener_streams_large_response_to_slow_reader() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let payload = vec![42u8; 8 * 1024 * 1024];
        let expected = payload.clone();
        let reader = std::thread::spawn(move || {
            let mut client = TcpStream::connect(address).unwrap();
            client.set_read_timeout(Some(Duration::from_secs(15))).unwrap();
            client.write_all(b"GET /api/download/test HTTP/1.1\r\nHost: localhost\r\n\r\n").unwrap();
            std::thread::sleep(Duration::from_millis(100));
            let mut bytes = Vec::new();
            let mut buffer = [0; 16384];
            loop {
                let n = client.read(&mut buffer).unwrap();
                if n == 0 { break; }
                bytes.extend_from_slice(&buffer[..n]);
                std::thread::sleep(Duration::from_millis(1));
            }
            let end = bytes.windows(4).position(|b| b == b"\r\n\r\n").unwrap() + 4;
            assert_eq!(&bytes[end..], expected);
        });
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(1)),
                Err(e) => panic!("{e}"),
            }
        };
        let cancel = AtomicBool::new(false);
        head(&mut stream, &cancel).unwrap();
        send(&mut stream, Response { status: 200, mime: "application/octet-stream".into(), headers: vec![], body: Body::Bytes(payload) }, &cancel).unwrap();
        finish(&mut stream);
        drop(stream);
        reader.join().unwrap();
    }
    fn request(raw: &[u8]) -> R<Request> {
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let mut client = TcpStream::connect(server.local_addr().unwrap()).unwrap();
        client.write_all(raw).unwrap();
        client.shutdown(std::net::Shutdown::Write).unwrap();
        let (mut stream, _) = server.accept().unwrap();
        head(&mut stream, &AtomicBool::new(false))
    }
    #[test]
    fn rejects_ambiguous_http_framing_and_accepts_exact_headers() {
        for raw in ["POST /api/upload HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\n", "GET / HTTP/1.1\r\nHost: a\r\nHost: b\r\n\r\n", "POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n", "GET http://attacker/ HTTP/1.1\r\nHost: localhost\r\n\r\n"]{assert!(request(raw.as_bytes()).is_err());}
        let r = request(
            b"POST /api/upload HTTP/1.1\r\nHost: localhost:1234\r\nContent-Length: 3\r\n\r\nabc",
        )
        .unwrap();
        assert_eq!(r.length(3).unwrap(), 3);
        assert!(r.length(2).is_err());
        assert_eq!(r.prefix, b"abc");
    }
    #[test]
    fn lists_real_ipv4_interfaces() {
        for address in addresses().unwrap() {
            let a = address.parse::<std::net::Ipv4Addr>().unwrap();
            assert!(!a.is_unspecified() && !a.is_loopback() && !a.is_link_local());
        }
    }
}
