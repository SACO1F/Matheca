use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, ImageDecoder, ImageReader};
use std::{io::Cursor, path::Path};
pub const MAX_FILE: u64 = 50 * 1024 * 1024;
pub fn dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0
        || height == 0
        || width > 30000
        || height > 30000
        || u64::from(width) * u64::from(height) > 100_000_000
    {
        Err("图片像素过大，请先裁剪".into())
    } else {
        Ok(())
    }
}
pub fn decode(bytes: &[u8]) -> Result<DynamicImage, String> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_FILE {
        return Err("图片为空或超过 50 MB".into());
    }
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "图片格式无效")?;
    let (w, h) = reader.into_dimensions().map_err(|_| "无法读取图片尺寸")?;
    dimensions(w, h)?;
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "图片格式无效")?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(30000);
    limits.max_image_height = Some(30000);
    limits.max_alloc = Some(512 * 1024 * 1024);
    reader.limits(limits);
    let mut decoder = reader
        .into_decoder()
        .map_err(|_| "图片损坏或内存限制，请先转换或裁剪")?;
    let orientation = decoder
        .orientation()
        .map_err(|_| "图片方向信息损坏，请先转换图片")?;
    let mut image =
        DynamicImage::from_decoder(decoder).map_err(|_| "图片损坏或内存限制，请先转换或裁剪")?;
    image.apply_orientation(orientation);
    Ok(image)
}
pub fn png(image: &DynamicImage) -> Result<Vec<u8>, String> {
    let mut out = Cursor::new(Vec::new());
    image
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|_| "图片编码失败")?;
    Ok(out.into_inner())
}
pub fn data_url(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|_| "来源图片已丢失，请重新导入或补全题干")?;
    let image = if matches!(extension(path).as_str(), "heic" | "heif") {
        heic(&bytes)?
    } else {
        decode(&bytes)?
    };
    let resized = image.thumbnail(1400, 2000);
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 92)
        .encode_image(&resized.to_rgb8())
        .map_err(|_| "图片编码失败")?;
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}
pub fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}
pub fn read_owned(root: &Path, path: &Path) -> Result<Vec<u8>, String> {
    let file = path
        .canonicalize()
        .map_err(|_| "任务原图不存在，请重新导入")?;
    if !file.starts_with(root.canonicalize().map_err(|e| e.to_string())?)
        || !file.is_file()
        || file.metadata().map_err(|e| e.to_string())?.len() > MAX_FILE
    {
        return Err("任务资料路径无效或过大".into());
    }
    std::fs::read(file).map_err(|e| e.to_string())
}
pub fn crop(bytes: &[u8], rect: &serde_json::Value) -> Result<String, String> {
    let vals = ["x", "y", "width", "height"].map(|k| {
        rect[k]
            .as_f64()
            .filter(|x| x.is_finite() && (0.0..=1.0).contains(x))
    });
    let [Some(x), Some(y), Some(w), Some(h)] = vals else {
        return Err("框选范围无效".into());
    };
    if w <= 0. || h <= 0. || x + w > 1.00001 || y + h > 1.00001 {
        return Err("框选范围超出原图".into());
    }
    let image = decode(bytes)?;
    let iw = image.width();
    let ih = image.height();
    let left = (x * f64::from(iw)).floor() as u32;
    let top = (y * f64::from(ih)).floor() as u32;
    let width = ((w * f64::from(iw)).ceil() as u32).min(iw.saturating_sub(left));
    let height = ((h * f64::from(ih)).ceil() as u32).min(ih.saturating_sub(top));
    if width < 8 || height < 8 {
        return Err("框选区域至少为 8×8 像素".into());
    }
    let result = png(&image.crop_imm(left, top, width, height))?;
    if result.len() > 5 * 1024 * 1024 {
        return Err("配图超过 5 MB，请缩小框选范围".into());
    }
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(result)))
}
#[repr(C)]
struct HeifError {
    code: i32,
    subcode: i32,
    message: *const std::ffi::c_char,
}
struct Handle {
    ptr: *mut std::ffi::c_void,
    free: unsafe extern "C" fn(*mut std::ffi::c_void),
}
impl Drop for Handle {
    fn drop(&mut self) {
        if !self.ptr.is_null() {
            unsafe { (self.free)(self.ptr) }
        }
    }
}
pub fn heic(bytes: &[u8]) -> Result<DynamicImage, String> {
    use std::ffi::c_void;
    if bytes.is_empty() || bytes.len() as u64 > MAX_FILE {
        return Err("HEIC 文件为空或超过 50 MB".into());
    }
    unsafe {
        let path = std::env::current_exe()
            .map_err(|e| e.to_string())?
            .parent()
            .unwrap()
            .join("heif.dll");
        let lib =
            libloading::Library::new(path).map_err(|_| "缺少 HEIC 运行库，请保留完整便携目录")?;
        macro_rules! sym {
            ($name:literal,$ty:ty) => {
                *lib.get::<$ty>(concat!($name, "\0").as_bytes())
                    .map_err(|_| "HEIC 运行库版本不兼容")?
            };
        }
        let alloc = sym!("heif_context_alloc", unsafe extern "C" fn() -> *mut c_void);
        let context = Handle {
            ptr: alloc(),
            free: sym!("heif_context_free", unsafe extern "C" fn(*mut c_void)),
        };
        if context.ptr.is_null() {
            return Err("HEIC 内存不足".into());
        }
        let set_limit = sym!(
            "heif_context_set_maximum_image_size_limit",
            unsafe extern "C" fn(*mut c_void, i32)
        );
        set_limit(context.ptr, 10000);
        let read = sym!(
            "heif_context_read_from_memory_without_copy",
            unsafe extern "C" fn(*mut c_void, *const c_void, usize, *const c_void) -> HeifError
        );
        let checked = |e: HeifError| {
            if e.code == 0 {
                Ok(())
            } else {
                Err("HEIC 文件损坏、尺寸过大或不受支持".to_string())
            }
        };
        checked(read(
            context.ptr,
            bytes.as_ptr().cast(),
            bytes.len(),
            std::ptr::null(),
        ))?;
        let mut handle = Handle {
            ptr: std::ptr::null_mut(),
            free: sym!(
                "heif_image_handle_release",
                unsafe extern "C" fn(*mut c_void)
            ),
        };
        let primary = sym!(
            "heif_context_get_primary_image_handle",
            unsafe extern "C" fn(*mut c_void, *mut *mut c_void) -> HeifError
        );
        checked(primary(context.ptr, &mut handle.ptr))?;
        let width = sym!(
            "heif_image_handle_get_width",
            unsafe extern "C" fn(*mut c_void) -> i32
        );
        let height = sym!(
            "heif_image_handle_get_height",
            unsafe extern "C" fn(*mut c_void) -> i32
        );
        let w = width(handle.ptr);
        let h = height(handle.ptr);
        if w <= 0 || h <= 0 {
            return Err("HEIC 尺寸无效".into());
        }
        dimensions(w as u32, h as u32)?;
        let mut image = Handle {
            ptr: std::ptr::null_mut(),
            free: sym!("heif_image_release", unsafe extern "C" fn(*mut c_void)),
        };
        let decode = sym!(
            "heif_decode_image",
            unsafe extern "C" fn(
                *mut c_void,
                *mut *mut c_void,
                i32,
                i32,
                *const c_void,
            ) -> HeifError
        );
        checked(decode(handle.ptr, &mut image.ptr, 1, 11, std::ptr::null()))?;
        let mut stride = 0;
        let plane = sym!(
            "heif_image_get_plane_readonly",
            unsafe extern "C" fn(*mut c_void, i32, *mut i32) -> *const u8
        );
        let pixels = plane(image.ptr, 10, &mut stride);
        if pixels.is_null() || stride < w * 4 {
            return Err("HEIC 像素数据无效".into());
        }
        let mut rgba = Vec::with_capacity(w as usize * h as usize * 4);
        for y in 0..h as usize {
            rgba.extend_from_slice(std::slice::from_raw_parts(
                pixels.add(y * stride as usize),
                w as usize * 4,
            ))
        }
        Ok(DynamicImage::ImageRgba8(
            image::RgbaImage::from_raw(w as u32, h as u32, rgba).ok_or("HEIC 像素数据无效")?,
        ))
    }
}
pub fn clipboard() -> Result<Vec<u8>, String> {
    use windows::{
        core::w,
        Win32::{
            Foundation::HGLOBAL,
            System::{
                DataExchange::{
                    CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
                    RegisterClipboardFormatW,
                },
                Memory::{GlobalLock, GlobalSize, GlobalUnlock},
            },
        },
    };
    struct Clipboard;
    impl Drop for Clipboard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }
    struct Locked(HGLOBAL);
    impl Drop for Locked {
        fn drop(&mut self) {
            unsafe {
                let _ = GlobalUnlock(self.0);
            }
        }
    }
    unsafe {
        OpenClipboard(None).map_err(|_| "剪贴板正在使用，请稍后重试")?;
        let _clip = Clipboard;
        let png_format = RegisterClipboardFormatW(w!("PNG"));
        let (format, is_png) = if IsClipboardFormatAvailable(png_format).is_ok() {
            (png_format, true)
        } else if IsClipboardFormatAvailable(8).is_ok() {
            (8, false)
        } else {
            return Err("剪贴板中没有图片，请先截图或复制图片".into());
        };
        let handle = HGLOBAL(
            GetClipboardData(format)
                .map_err(|_| "无法读取剪贴板图片")?
                .0,
        );
        let size = GlobalSize(handle);
        if size == 0 || size as u64 > MAX_FILE {
            return Err("剪贴板图片为空或超过 50 MB".into());
        }
        let ptr = GlobalLock(handle);
        if ptr.is_null() {
            return Err("无法读取剪贴板图片".into());
        }
        let _locked = Locked(handle);
        let raw = std::slice::from_raw_parts(ptr.cast::<u8>(), size);
        let bytes = if is_png {
            raw.to_vec()
        } else {
            dib_to_bmp(raw)?
        };
        png(&decode(&bytes)?)
    }
}
fn dib_to_bmp(dib: &[u8]) -> Result<Vec<u8>, String> {
    if dib.len() < 40 {
        return Err("剪贴板位图无效".into());
    }
    let u32at = |n| u32::from_le_bytes(dib[n..n + 4].try_into().unwrap());
    let header = u32at(0) as usize;
    if header < 40 || header > dib.len() {
        return Err("剪贴板位图无效".into());
    }
    let bpp = u16::from_le_bytes(dib[14..16].try_into().unwrap());
    let colors = if u32at(32) > 0 {
        u32at(32) as usize
    } else if bpp <= 8 {
        1usize << bpp
    } else {
        0
    };
    let masks = if header == 40 && u32at(16) == 3 {
        12
    } else if header == 40 && u32at(16) == 6 {
        16
    } else {
        0
    };
    let offset = 14 + header + masks + colors * 4;
    if offset > dib.len() + 14 {
        return Err("剪贴板位图无效".into());
    }
    let mut bmp = b"BM".to_vec();
    bmp.extend_from_slice(&((dib.len() + 14) as u32).to_le_bytes());
    bmp.extend_from_slice(&[0; 4]);
    bmp.extend_from_slice(&(offset as u32).to_le_bytes());
    bmp.extend_from_slice(dib);
    Ok(bmp)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn limits_and_crop() {
        assert!(dimensions(30001, 1).is_err());
        assert!(decode(b"bad").is_err());
        let bytes = png(&DynamicImage::new_rgb8(100, 100)).unwrap();
        assert!(crop(
            &bytes,
            &serde_json::json!({"x":0.,"y":0.,"width":0.5,"height":0.5})
        )
        .unwrap()
        .starts_with("data:image/png;base64,"));
        assert!(crop(
            &bytes,
            &serde_json::json!({"x":0.8,"y":0.,"width":0.5,"height":0.5})
        )
        .is_err());
        assert!(dib_to_bmp(&[0; 20]).is_err());
        let mut dib = vec![0u8; 44];
        dib[0..4].copy_from_slice(&40u32.to_le_bytes());
        dib[4..8].copy_from_slice(&1u32.to_le_bytes());
        dib[8..12].copy_from_slice(&1u32.to_le_bytes());
        dib[12..14].copy_from_slice(&1u16.to_le_bytes());
        dib[14..16].copy_from_slice(&24u16.to_le_bytes());
        dib[42] = 255;
        let pixel = decode(&dib_to_bmp(&dib).unwrap()).unwrap().to_rgb8();
        assert_eq!(pixel.get_pixel(0, 0).0, [255, 0, 0]);
    }
    #[test]
    fn jpeg_orientation_matches_browser_original_and_crop_coordinates() {
        let image = DynamicImage::new_rgb8(20, 30);
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
            .encode_image(&image)
            .unwrap();
        let exif = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
        let mut rotated = jpeg[..2].to_vec();
        rotated.extend_from_slice(&[0xff, 0xe1]);
        rotated.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
        rotated.extend_from_slice(exif);
        rotated.extend_from_slice(&jpeg[2..]);
        let decoded = decode(&rotated).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (30, 20));
    }
}
