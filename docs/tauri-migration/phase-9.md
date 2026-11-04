# 第 9 阶段：全量回归与 Windows x64 便携交付

日期：2026-10-27。按原迁移计划开展全量回归、工作台兼容检查、资源打包和隔离成品验收。保留 React 前端，业务由 Tauri/Rust 执行，57 个 DesktopAPI 方法和 53 个业务请求频道保持兼容。

结论：本阶段开发、本机全量回归和 Windows x64 便携成品交付完成。原计划的九个开发阶段已完成本地交付；下列特殊硬件、其他运行时和实体手机网络边界仍需对应环境验收。

## 本阶段改动

1. 便携目录新增 PORTABLE_FILES.sha256，记录 EXE、原生 DLL、说明和许可文件的完整 SHA256。构建阶段验证六个 Windows x64 PE 文件、必需资源和许可目录，并拒绝题库、缓存、开发调试文件及 Node/Electron 运行时混入。
2. 新增独立成品审计：验证每个目录文件及 ZIP 条目与原件一致；在独立副本中故意篡改 DLL、移走 DLL 和注入假数据库，确认完整性检查确实拒绝。哈希清单用于发现资源丢失和意外改动，不是代码签名或发布者身份认证。
3. 补齐 Tauri 工作台端到端检查：本地字体、公式、原图解码，四主题真实控件操作，未保存接口草稿保留，125 条历史记录的搜索与分页、最近五次操作与键盘关闭，紧凑/宽屏视口、减少动态效果、无效拖放反馈及重启持久化。
4. 正常退出后检查本次 WebView2 进程编号全部消失，并重命名再恢复独立 SQLite 文件，确认句柄释放。只观察测试子进程，不终止用户原有应用。
5. 更新正式使用说明、仓库入口和桥接错误文案。保留资料目录和应用标识，避免既有迁移题库被另一个默认目录隔开。运行版本信息进入第 9 阶段；已有第 8 阶段专项脚本接受后续兼容阶段，继续保留原业务断言。

## 构建与检查

- Node 24.22.1，Rust 1.97.1，Windows x64。
- `npm run verify`：类型检查通过，14 个文件、165 项测试通过。
- Rust 常规测试：50 项通过；历史密钥测试默认跳过，但已用 test-output/tauri-phase3-key-proof 中的合成 Electron 密钥单独执行 `--ignored --exact`，通过。合计 51 项 Rust 测试实际通过。
- cargo fmt 与 release Clippy（-D warnings）通过；新增脚本格式及语法检查通过。
- 已运行 desktop/ 下的 `npm run make:portable`，最终包验证记录见后续成品验收部分。

工作台初轮脚本错误地要求当前 DOM 中已有配图，而虚拟列表没有渲染到配图题，断言失败；已改为读取隔离题库返回的受控原图 URL 并直接解码。修改后预回归通过，原失败记录保留在 test-output 中。该问题属于验收脚本假设，未据此修改应用渲染行为。

## 数据与运行方式

默认题库继续使用 `%LOCALAPPDATA%/MathecaTauriPreview`，不因正式交付而搬移或改名。Electron 的 `%APPDATA%/Matheca` 或旧 Mathector 资料保持独立。可在空迁移库通过“复制原版题库”复制，或使用 ZIP 合并。不会自动覆盖原版题库。

保持完整解压目录后运行 Matheca.exe；原生 DLL 可以替换，许可和重建说明随包保留。React、字体、PDF.js 等浏览器资源嵌入 EXE。运行无需 Node 或 Electron，依赖系统 WebView2；包体积不计系统共享运行时。

## 验收边界

所有题库、图片、API Key 和服务均为独立合成样本。模拟 AI 服务与手机协议客户端使用回环地址；没有修改用户正常数据、系统证书库、防火墙或剪贴板。

截图端到端使用合成显示器画面；GDI 像素通道通过私有内存 DC 测试，真实桌面捕获的早期技术验证见第 1 阶段。本阶段的视口尺寸检查不等同于物理多屏与混合 DPI 验收。HDR、受保护视频、远程桌面、其他 Windows/WebView2 版本和实体手机跨 Wi-Fi 仍需对应环境验证。帮助操作使用隔离记录验证，未打开真实默认浏览器或改用户剪贴板。

本次交付为本地 Windows x64 便携包，没有对外发布 GitHub Release、安装包签名或自动更新服务。不能把本机通过的功能路径扩大为所有硬件和网络环境已验收。

## 最终成品

发布目录：`desktop/releases/tauri-preview/v0.1.0/2026-10-27-19-44-47-1793101487735/`。目录名 tauri-preview 为迁移期间沿用的输出位置，不会改变正常资料位置。

| 项目         | 结果                                                             |
| ------------ | ---------------------------------------------------------------- |
| 主程序       | Matheca-win32-x64/Matheca.exe，14.93 MiB                         |
| 完整应用目录 | 771 个文件，21.62 MiB                                            |
| 压缩包       | Matheca-Tauri-win32-x64.zip，10.37 MiB                           |
| EXE SHA256   | 8e7511a404c03d93b1ac86027644f8f021087f73a31e499b5c0422bf536d612c |
| ZIP SHA256   | 6bc0a8c9d3acae63fd64dbeaa1a1c5bdcde7455a37a1d1bcd7a58c99ed398efb |

原始发布目录的逐文件资源与 ZIP 字节核对通过：[资源审计报告](../../desktop/test-output/tauri-phase9-release-1793101526508/REPORT.md)。完整目录和 ZIP 放在同一发布目录，附 SHA256SUMS.txt。与第 8 阶段的 Electron 完整目录 510.31 MiB 比较，减少约 95.8%，系统 WebView2 占用未计入。

已解压到 `desktop/test-output/tauri-phase9-final-unzip-1793101487735/中文 空格/Matheca-win32-x64/`，解压 EXE SHA256 与原件一致。包含中文与空格的路径用于验证成品启动路径兼容。

## 最终成品验收

从上述解压目录实际启动 EXE，执行 `npm run test:portable -- --suite full --exe <解压 EXE>`，8 个脚本全部退出码 0：[完整回归总报告](../../desktop/test-output/validation-2026-10-27T11-45-32-532Z-4296/REPORT.md)。七项业务脚本共 61 组检查，另有一项资源审计；未把重复执行累计为更多通过项。

| 范围                                 | 检查组数 | 最终结果                                            |
| ------------------------------------ | -------: | --------------------------------------------------- |
| 完整目录与资源清单                   | 独立审计 | 通过；解压目录逐文件校验，原始发布 ZIP 另外完整比对 |
| 工作台、主题、历史、布局与进程退出   |        7 | 通过                                                |
| 截图、帮助、权限、取消与后台/退出    |        9 | 通过                                                |
| 数据编辑、撤销、设置、重启与版本保护 |       13 | 通过                                                |
| ZIP 预览、恢复与失败保护             |        7 | 通过                                                |
| 文档预览与导出                       |        4 | 通过                                                |
| HTTPS、AI、图片/PDF/HEIC 与任务恢复  |       11 | 通过                                                |
| 手机网页、配对、上传、回传与题库交换 |       10 | 通过                                                |

最终解压包另经原生 Windows 文件夹选择器实际确认，复制合成旧库的 9 道题及原图。源 SQLite SHA256 不变，旧 processing 任务变为 paused、runId 清空，指纹按新路径重建；正常退出并重启后保留 9 题，渲染异常为 0。[原生迁移报告](../../desktop/test-output/tauri-phase8-migration-1793101650976/MIGRATION-REPORT.md)。本次使用 [computer-use 技能](C:/Users/10052/.codex/plugins/cache/openai-bundled/computer-use/26.1021.31345/skills/computer-use/SKILL.md) 操作合成题库的本机选择器，没有触及正常资料。

工作台最终证据：[REPORT.md](../../desktop/test-output/tauri-phase9-workbench-1793101534683/REPORT.md)，同目录包含 library.png、history.png、settings-plum.png 及 900/1440 像素视口截图，已检查历史列表及紧凑设置页。测试结束后未发现本次最终解压包或原生迁移测试的残留应用/WebView2 进程。

默认打包仍为 `npm run make:portable`。Electron 回退构建可用 `npm run make:portable -- --electron`；本阶段没有修改其运行代码，保留第 8 阶段已经启动验证的回退成品。当前 Tauri 完整应用、ZIP、说明和校验文件已保留在新的发布目录，没有覆盖或终止运行中的旧版本。
