# Tauri 当前实现

- `native/`：Rust 后端、Cargo 锁文件、Tauri 配置及权限。
- `vite.config.ts`：Tauri 前端构建配置。
- `runtime/windows-x64/`：经哈希校验的 HEIF 与 VC++ 原生运行文件。
- `runtime/licenses/`：原生组件许可证。运行文件属于打包输入，请勿作为缓存删除。
- 从 `desktop/` 执行 `npm run make:portable` 或 `npm run make:portable:tauri`。
- 新构建发布到 `desktop/releases/tauri/`，不再写入 Electron 发布目录。

React 界面、业务类型和平台适配层共用 `desktop/src/`。根部三份 `tauri*.html` 是 WebView 页面入口，保留文件名以兼容 Rust 内部页面地址。
默认可直接使用本目录原生运行文件打包，不再依赖 `test-output` 中的 DLL。
