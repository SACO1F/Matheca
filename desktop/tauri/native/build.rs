fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_call",
            "bootstrap",
            "frontend_ready",
            "choose_legacy_copy",
            "worker_reply",
            "capture_ready",
            "capture_loaded",
            "capture_confirm",
            "capture_cancel",
        ]),
    ))
    .expect("Tauri build failed");
}
