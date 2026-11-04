# Electron 旧版实现

此目录保存 Electron 专属主进程、预加载脚本与 Forge/Vite 配置。

- `main/`：Node/Electron 后端。
- `preload.ts`、`capture-preload.ts`：IPC 桥接。
- `config/`：Forge 和 Electron Vite 配置。
- 从 `desktop/` 执行 `npm run start:electron` 或 `npm run make:portable:electron`。
- 新构建发布到 `desktop/releases/electron/`。

React 界面、业务类型和手机网页保存在公共 `desktop/src/`；共用根依赖与锁文件，避免复制整份界面和 node_modules。
