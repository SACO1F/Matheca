use crate::{crypto, data, model, repository::Repository};
use serde_json::{json, Value};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
pub struct Config {
    pub endpoint: String,
    pub model: String,
    key: String,
    ca: Option<Vec<u8>>,
}
pub fn endpoint(address: &str) -> Result<String, String> {
    let address = model::trim(address);
    let mut url = url::Url::parse(address).map_err(|_| "接口地址格式不正确")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || address.contains(['?', '#'])
    {
        return Err("请使用不含账号、参数的 HTTPS 接口地址".into());
    }
    let base = url.path().trim_end_matches('/');
    let path = if base.ends_with("/chat/completions") {
        base.into()
    } else if base.is_empty() {
        "/v1/chat/completions".into()
    } else {
        format!("{base}/chat/completions")
    };
    url.set_path(&path);
    Ok(url.into())
}
pub fn config(repo: &Repository) -> Result<Config, String> {
    let _gate = repo.lock()?;
    let db = repo.open()?.ok_or("题库不可用")?;
    let address = data::setting(&db, "address")?;
    let model = data::setting(&db, "model")?;
    let encrypted = data::setting(&db, "encryptedKey")?;
    if address.is_empty() || model.is_empty() || encrypted.is_empty() {
        return Err("请先在设置中配置多模态接口".into());
    }
    let legacy = data::setting(&db, "legacyKeyFile")?;
    let path = std::path::Path::new(&legacy);
    let key_root = if !legacy.is_empty()
        && path
            .canonicalize()
            .ok()
            .zip(repo.root.canonicalize().ok())
            .is_some_and(|(p, r)| p.starts_with(r))
    {
        path.parent().unwrap_or(&repo.root)
    } else {
        &repo.root
    };
    let key = crypto::unprotect(&encrypted, key_root)
        .map_err(|_| "API Key 无法读取，请重新填写后保存")?;
    Ok(Config {
        endpoint: endpoint(&address)?,
        model,
        key,
        ca: std::env::var_os("MATHECA_HTTPS_CA")
            .map(|path| {
                let path = std::path::PathBuf::from(path);
                if !path.is_absolute() {
                    return Err("附加 HTTPS CA 证书需要绝对路径");
                }
                let file = std::fs::File::open(path).map_err(|_| "无法读取附加 HTTPS CA 证书")?;
                if file
                    .metadata()
                    .map_err(|_| "无法读取附加 HTTPS CA 证书")?
                    .len()
                    > 1024 * 1024
                {
                    return Err("附加 HTTPS CA 证书过大");
                }
                let mut bytes = Vec::new();
                use std::io::Read;
                file.take(1024 * 1024 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| "无法读取附加 HTTPS CA 证书")?;
                Ok(bytes)
            })
            .transpose()?,
    })
}
pub fn http_error(code: u16) -> String {
    match code {
        401 | 403 => format!("接口认证失败，请检查 API Key 和模型权限（HTTP {code}）"),
        429 => "服务额度不足或请求频繁，请稍后重试（HTTP 429）".into(),
        300..=399 => format!("接口发生重定向，请填写最终 HTTPS 地址（HTTP {code}）"),
        500..=599 => format!("服务暂时不可用（HTTP {code}）"),
        _ => format!("接口请求失败，请检查地址、模型和服务兼容性（HTTP {code}）"),
    }
}
pub fn completion(bytes: &[u8]) -> Result<String, String> {
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|_| "接口响应格式不正确，请确认使用 Chat Completions 接口")?;
    let choice = value["choices"].get(0).ok_or("接口响应缺少识别结果")?;
    if choice["finish_reason"] == "length" {
        return Err("识别结果被截断，请裁剪后重试".into());
    }
    let m = &choice["message"];
    if !m["refusal"].as_str().unwrap_or("").trim().is_empty() {
        return Err("模型拒绝处理该内容，请更换图片或模型".into());
    }
    let text = if let Some(s) = m["content"].as_str() {
        s.to_string()
    } else if let Some(a) = m["content"].as_array() {
        a.iter()
            .filter_map(|p| p["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        String::new()
    };
    if model::trim(&text).is_empty() {
        return Err("模型返回了空内容".into());
    }
    Ok(text)
}
pub fn complete(
    config: &Config,
    prompt: &str,
    images: &[String],
    cancel: &AtomicBool,
) -> Result<String, String> {
    let mut content = vec![json!({"type":"text","text":prompt})];
    for image in images {
        content.push(json!({"type":"image_url","image_url":{"url":image}}));
    }
    let payload =
        json!({"model":config.model,"stream":false,"messages":[{"role":"user","content":content}]});
    tauri::async_runtime::block_on(async {
        let request = async {
            let mut builder = reqwest::Client::builder()
                .https_only(true)
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(20))
                .read_timeout(Duration::from_secs(120))
                .timeout(Duration::from_secs(150));
            if let Some(pem) = &config.ca {
                builder = builder.add_root_certificate(
                    reqwest::Certificate::from_pem(pem)
                        .map_err(|_| "附加 HTTPS CA 证书格式无效")?,
                );
            }
            let client = builder.build().map_err(|_| "无法初始化 HTTPS 服务")?;
            let mut res = client
                .post(&config.endpoint)
                .bearer_auth(&config.key)
                .json(&payload)
                .send()
                .await
                .map_err(|e| {
                    if e.is_timeout() {
                        "接口请求超时，请重试"
                    } else {
                        "无法连接服务，请检查网络、地址或证书"
                    }
                })?;
            if !res.status().is_success() {
                return Err(http_error(res.status().as_u16()));
            }
            if res.content_length().is_some_and(|n| n > 4 * 1024 * 1024) {
                return Err("接口响应超过 4 MB，请裁剪图片后重试".into());
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = res.chunk().await.map_err(|_| "读取接口响应失败，请重试")?
            {
                if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
                    return Err("接口响应超过 4 MB，请裁剪图片后重试".into());
                }
                bytes.extend_from_slice(&chunk);
            }
            completion(&bytes)
        };
        tokio::pin!(request);
        loop {
            tokio::select! {value=&mut request=>return value,_=tokio::time::sleep(Duration::from_millis(50))=>if cancel.load(Ordering::SeqCst){return Err("任务已停止，可稍后继续".into())}}
        }
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn addresses_match_existing_contract() {
        assert_eq!(
            endpoint("https://example.com").unwrap(),
            "https://example.com/v1/chat/completions"
        );
        assert_eq!(
            endpoint("https://example.com/v1/").unwrap(),
            "https://example.com/v1/chat/completions"
        );
        for a in [
            "http://example.com",
            "https://u:p@example.com",
            "https://example.com?",
            "https://example.com/#x",
        ] {
            assert!(endpoint(a).is_err())
        }
    }
    #[test]
    fn responses_are_bounded_and_do_not_echo_provider_errors() {
        assert_eq!(
            completion(br#"{"choices":[{"message":{"content":[{"text":"ok"}]}}]}"#).unwrap(),
            "ok"
        );
        assert!(completion(
            br#"{"choices":[{"finish_reason":"length","message":{"content":"half"}}]}"#
        )
        .is_err());
        assert!(completion(br#"{"error":"secret"}"#)
            .unwrap_err()
            .find("secret")
            .is_none());
        assert!(http_error(302).contains("重定向"));
    }
}
