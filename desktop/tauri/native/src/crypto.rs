use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::Path;
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{LocalFree, HLOCAL},
        Security::Cryptography::*,
    },
};

const PREFIX: &[u8] = b"matheca-dpapi-v1:";
fn dpapi(bytes: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: bytes.len().try_into().map_err(|_| "密钥过长")?,
            pbData: bytes.as_ptr().cast_mut(),
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        let result = if protect {
            CryptProtectData(&input, PCWSTR::null(), None, None, None, 1, &mut output)
        } else {
            CryptUnprotectData(&input, None, None, None, None, 1, &mut output)
        };
        result.map_err(|_| "Windows 凭据保护不可用，请重新填写 API Key".to_string())?;
        let value = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        std::slice::from_raw_parts_mut(output.pbData, output.cbData as usize).fill(0);
        LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(value)
    }
}
pub fn protect(secret: &str) -> Result<String, String> {
    let mut bytes = PREFIX.to_vec();
    bytes.extend(dpapi(secret.as_bytes(), true)?);
    Ok(STANDARD.encode(bytes))
}
pub fn unprotect(encoded: &str, root: &Path) -> Result<String, String> {
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "旧密钥格式无效，请重新填写 API Key")?;
    let secret = if let Some(payload) = bytes.strip_prefix(PREFIX) {
        dpapi(payload, false)?
    } else if bytes.starts_with(b"v10") {
        let file = if root.join("legacy-key.json").exists() {
            root.join("legacy-key.json")
        } else {
            root.join("Local State")
        };
        let state: serde_json::Value = serde_json::from_slice(
            &std::fs::read(file).map_err(|_| "缺少旧版密钥资料，请重新填写 API Key")?,
        )
        .map_err(|_| "旧版密钥资料无效")?;
        let key = STANDARD
            .decode(
                state["os_crypt"]["encrypted_key"]
                    .as_str()
                    .ok_or("缺少旧版密钥资料")?,
            )
            .map_err(|_| "旧版密钥资料无效")?;
        let mut raw = dpapi(
            key.strip_prefix(b"DPAPI")
                .ok_or("旧版密钥保护格式不受支持")?,
            false,
        )?;
        let result = decrypt_gcm(&raw, bytes.get(3..).ok_or("旧密钥无效")?);
        raw.fill(0);
        result?
    } else {
        dpapi(&bytes, false)?
    };
    String::from_utf8(secret).map_err(|_| "密钥内容无效，请重新填写 API Key".into())
}
fn decrypt_gcm(secret: &[u8], payload: &[u8]) -> Result<Vec<u8>, String> {
    unsafe {
        if secret.len() != 32 || payload.len() < 28 {
            return Err("旧密钥格式无效".into());
        }
        let mut algorithm = BCRYPT_ALG_HANDLE::default();
        BCryptOpenAlgorithmProvider(
            &mut algorithm,
            BCRYPT_AES_ALGORITHM,
            PCWSTR::null(),
            BCRYPT_OPEN_ALGORITHM_PROVIDER_FLAGS(0),
        )
        .ok()
        .map_err(|_| "AES 服务不可用")?;
        let mut key = BCRYPT_KEY_HANDLE::default();
        let result = (|| {
            let mode: Vec<u8> = "ChainingModeGCM\0"
                .encode_utf16()
                .flat_map(u16::to_le_bytes)
                .collect();
            BCryptSetProperty(BCRYPT_HANDLE(algorithm.0), BCRYPT_CHAINING_MODE, &mode, 0)
                .ok()
                .map_err(|_| "AES 模式不可用")?;
            BCryptGenerateSymmetricKey(algorithm, &mut key, None, secret, 0)
                .ok()
                .map_err(|_| "AES 密钥不可用")?;
            let nonce = &payload[..12];
            let tag = &payload[payload.len() - 16..];
            let ciphertext = &payload[12..payload.len() - 16];
            let info = BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO {
                cbSize: std::mem::size_of::<BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO>() as u32,
                dwInfoVersion: 1,
                pbNonce: nonce.as_ptr().cast_mut(),
                cbNonce: 12,
                pbTag: tag.as_ptr().cast_mut(),
                cbTag: 16,
                ..Default::default()
            };
            let mut output = vec![0; ciphertext.len()];
            let mut count = 0;
            BCryptDecrypt(
                key,
                Some(ciphertext),
                Some((&info as *const BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO).cast()),
                None,
                Some(&mut output),
                &mut count,
                BCRYPT_FLAGS(0),
            )
            .ok()
            .map_err(|_| "旧密钥无法验证，请重新填写 API Key")?;
            output.truncate(count as usize);
            Ok(output)
        })();
        if !key.0.is_null() {
            let _ = BCryptDestroyKey(key);
        }
        let _ = BCryptCloseAlgorithmProvider(algorithm, 0);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn current_user_roundtrip_and_tamper() {
        let encoded = protect("synthetic-secret").unwrap();
        assert_eq!(
            unprotect(&encoded, Path::new(".")).unwrap(),
            "synthetic-secret"
        );
        let mut bytes = STANDARD.decode(encoded).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        assert!(unprotect(&STANDARD.encode(bytes), Path::new(".")).is_err());
    }
    #[test]
    #[ignore = "Run with MATHECA_LEGACY_KEY_FIXTURE pointing at the synthetic Electron test directory"]
    fn electron_44_key_compatibility() {
        let root = std::env::var_os("MATHECA_LEGACY_KEY_FIXTURE")
            .map(std::path::PathBuf::from)
            .expect("fixture directory required");
        let bytes = std::fs::read(root.join("electron-key.bin")).unwrap();
        let value = unprotect(&STANDARD.encode(bytes), &root.join("appdata")).unwrap();
        assert_eq!(value, "matheca-phase3-synthetic-key");
    }
}
