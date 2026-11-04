use serde_json::Value;
use std::path::Path;
const DATA: &str = include_str!("../../../src/shared/guide-data.json");
pub fn value(kind: &str, key: &str) -> Result<String, String> {
    let data: Value = serde_json::from_str(DATA).map_err(|_| "帮助配置无效")?;
    if key.len() > 40 {
        return Err("帮助项目无效".into());
    }
    data[kind]
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or("帮助项目无效".into())
}
fn test_action(root: &Path, kind: &str, value: &str) -> Result<bool, String> {
    if std::env::var_os("MATHECA_TEST_DATA").is_some()
        && std::env::var("MATHECA_TEST_NATIVE_ACTIONS").as_deref() == Ok("1")
    {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(root.join("native-actions.jsonl"))
            .map_err(|e| e.to_string())?;
        writeln!(f, "{}", serde_json::json!({"kind":kind,"value":value}))
            .map_err(|e| e.to_string())?;
        return Ok(true);
    }
    Ok(false)
}
pub fn action(root: &Path, kind: &str, key: &str) -> Result<Value, String> {
    if !["open", "copy"].contains(&kind) {
        return Err("帮助操作无效".into());
    }
    let text = value(if kind == "open" { "links" } else { "values" }, key)?;
    if test_action(root, kind, &text)? {
        return Ok(Value::Null);
    }
    if kind == "copy" {
        crate::mobile_http::clipboard(&text)?;
    } else if kind == "open" {
        use windows::{
            core::{w, HSTRING},
            Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
        };
        let url = url::Url::parse(&text).map_err(|_| "帮助链接无效")?;
        if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
            return Err("帮助链接无效".into());
        }
        let result = unsafe {
            ShellExecuteW(
                None,
                w!("open"),
                &HSTRING::from(text),
                None,
                None,
                SW_SHOWNORMAL,
            )
        };
        if result.0 as isize <= 32 {
            return Err("无法打开浏览器，请检查系统默认浏览器设置".into());
        }
    } else {
        return Err("帮助操作无效".into());
    }
    Ok(Value::Null)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_fixed_keys_are_allowed() {
        assert!(value("links", "https://evil.invalid").is_err());
        assert!(value("values", "__proto__").is_err());
        assert!(value("links", "../../file").is_err());
        assert_eq!(
            value("values", "address").unwrap(),
            "https://api.deepseek.com"
        );
        let data: Value = serde_json::from_str(DATA).unwrap();
        for v in data["links"].as_object().unwrap().values() {
            let u = url::Url::parse(v.as_str().unwrap()).unwrap();
            assert_eq!(u.scheme(), "https");
            assert!(u.username().is_empty());
        }
    }
}
