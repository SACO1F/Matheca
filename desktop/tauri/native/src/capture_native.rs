use image::{DynamicImage, RgbaImage};
use windows::Win32::{Graphics::Gdi::*, UI::HiDpi::*};
type R<T> = Result<T, String>;
struct Screen(HDC);
impl Drop for Screen {
    fn drop(&mut self) {
        unsafe {
            ReleaseDC(None, self.0);
        }
    }
}
struct Dpi(DPI_AWARENESS_CONTEXT);
impl Drop for Dpi {
    fn drop(&mut self) {
        unsafe {
            SetThreadDpiAwarenessContext(self.0);
        }
    }
}
struct Surface {
    dc: HDC,
    bitmap: HBITMAP,
    old: HGDIOBJ,
}
impl Drop for Surface {
    fn drop(&mut self) {
        unsafe {
            if !self.old.is_invalid() {
                SelectObject(self.dc, self.old);
            }
            let _ = DeleteObject(self.bitmap.into());
            let _ = DeleteDC(self.dc);
        }
    }
}
unsafe fn surface(source: HDC, width: u32, height: u32) -> R<(Surface, *mut u8)> {
    crate::media::dimensions(width, height)?;
    if u64::from(width) * u64::from(height) * 4 > 256 * 1024 * 1024 {
        return Err("屏幕像素过大，请降低分辨率后重试".into());
    }
    let dc = CreateCompatibleDC(Some(source));
    if dc.is_invalid() {
        return Err("无法创建截图设备".into());
    }
    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bits = std::ptr::null_mut();
    let bitmap = match CreateDIBSection(Some(source), &info, DIB_RGB_COLORS, &mut bits, None, 0) {
        Ok(b) => b,
        Err(_) => {
            let _ = DeleteDC(dc);
            return Err("无法分配屏幕图像".into());
        }
    };
    let old = SelectObject(dc, bitmap.into());
    let owned = Surface { dc, bitmap, old };
    if old.is_invalid() || bits.is_null() {
        return Err("无法选择屏幕图像".into());
    }
    Ok((owned, bits.cast()))
}
unsafe fn grab(source: HDC, x: i32, y: i32, width: u32, height: u32) -> R<DynamicImage> {
    let (surface, bits) = surface(source, width, height)?;
    BitBlt(
        surface.dc,
        0,
        0,
        width as i32,
        height as i32,
        Some(source),
        x,
        y,
        SRCCOPY | CAPTUREBLT,
    )
    .map_err(|_| "无法读取屏幕图像，请检查远程桌面或显示器状态")?;
    let raw = std::slice::from_raw_parts(bits, (u64::from(width) * u64::from(height) * 4) as usize);
    let mut rgba = raw.to_vec();
    for p in rgba.chunks_exact_mut(4) {
        p.swap(0, 2);
        p[3] = 255;
    }
    Ok(DynamicImage::ImageRgba8(
        RgbaImage::from_raw(width, height, rgba).ok_or("屏幕图像尺寸无效")?,
    ))
}
pub fn screen(x: i32, y: i32, width: u32, height: u32) -> R<DynamicImage> {
    unsafe {
        let prior = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        if prior.0.is_null() {
            return Err("无法设置截图 DPI 上下文".into());
        }
        let _dpi = Dpi(prior);
        let dc = Screen(GetDC(None));
        if dc.0.is_invalid() {
            return Err("无法读取桌面设备".into());
        }
        grab(dc.0, x, y, width, height)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_bitblt_keeps_top_down_pixels_and_opaque_alpha() {
        unsafe {
            // Capture a private memory DC, never the user's desktop.
            let source = CreateCompatibleDC(None);
            assert!(!source.is_invalid());
            let (surface, bits) = surface(source, 12, 8).unwrap();
            for y in 0..8 {
                for x in 0..12 {
                    let i = (y * 12 + x) * 4;
                    *bits.add(i) = x as u8;
                    *bits.add(i + 1) = y as u8;
                    *bits.add(i + 2) = 123;
                    *bits.add(i + 3) = 0;
                }
            }
            let image = grab(surface.dc, 2, 3, 5, 4).unwrap().to_rgba8();
            assert_eq!(image.get_pixel(0, 0).0, [123, 3, 2, 255]);
            assert_eq!(image.get_pixel(4, 3).0, [123, 6, 6, 255]);
            drop(surface);
            let _ = DeleteDC(source);
        }
    }
}
