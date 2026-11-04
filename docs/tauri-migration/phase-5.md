# Tauri 迁移第 5 阶段：预览、PDF 与 Word 导出

日期：2026-10-27（北京时间）

本阶段已完成。React 工作台保留，Rust 接管题集快照、保存对话框、文档生成和文件发布。53 个业务请求频道中已实现 32 个，剩余 21 个仍返回明确的未开放错误；DesktopAPI 的 57 个方法保持兼容。新增 collection:preview、collection:export、export:open。

## 已实现的行为

- 题集预览复用既有 React PDF 预览界面，支持翻页与返回编辑。
- PDF 使用本地 WebView2 的 A4 排版及原生打印接口，要求生成结构标签。Word 由 Rust 生成 OOXML ZIP，公式通过本地渲染窗口捕获为高分辨率 PNG，保留 LaTeX 替代文字。
- 同一次生成使用稳定数据库快照，按题集顺序输出，保留选项、题干与选项配图、自定义图宽、强制分页和解答空间。
- 未校对题目先提醒；用户在 Windows 保存对话框中选择目标文件。
- 生成结果先保存在内存，再写入本次专属临时文件并原子替换目标。取消、失败、文件锁定时保留原文件，并清理本次临时文件。退出应用时取消正在进行的生成。
- 打开文档仅接受本次会话成功生成且 SHA256 未变化的文件，通过系统关联程序打开。
- 修复共享排版器对超宽块公式的判断：同时检查实际内容宽度，防止公式溢出页面却通过校验。Electron 同步获得此修复。

网络与文件操作在 Rust 中执行。隐藏本地渲染窗口只保留 worker_reply 权限，没有工作台命令、文件系统权限或 API Key。无需 Node/Electron 辅助进程。

## 检查与成品验收

TypeScript 类型检查及 13 个文件的 163 项测试通过。Rust 36 项常规测试通过，另有需独立模拟 Electron 密钥的兼容测试；cargo fmt 和 release Clippy（-D warnings）通过。git diff --check 通过。

原生保存及退出验证共 7 组通过，渲染器异常为 0。覆盖 PDF 预览、空题集与坏公式拒绝、任意文件打开拒绝、配图和长题、Word 保存、未校对提醒、保存取消及退出中止。使用独立 MATHECA_TEST_DATA 和合成资料，没有修改正常应用资料。

对照原 Electron 合成基准：PDF 同为 3 页，逐页规范化文字一致；Word 经同一 LibreOffice 渲染后同为 4 页，逐页文字一致。14 张公式与配图尺寸一致，逐像素平均差为 0。所有基准 PDF、Word 页面均已查看。

新增边界样例包含题干及选项配图、36/25/28 mm 图宽、强制分页、55 行长题和 80 mm 解答空间。PDF 和 Word 分别渲染为 3 页，55 行文字均存在。6 张页面图逐页检查，没有发现裁切或重叠。Word 在本地独立解压的 LibreOffice 中转换，未安装或更改用户办公软件。

首次候选的超宽公式测试发现排版校验漏检，已修复并重建；最终成品重新通过。历史失败证据保留在 test-output/tauri-phase5-1793087956421/FAILURE.txt。不能将此前失败记录当作最终版本结果。

最终 ZIP 已解压到全新目录，EXE 与 ZIP 的 SHA256 校验一致，解压 EXE 与原件一致。实际启动后通过：

- 4 组导出及预览检查：desktop/test-output/tauri-phase5-1793088735290/REPORT.md。
- 13 组编辑、题集、撤销、设置、重启及数据库版本检查：desktop/test-output/tauri-phase5-data-1793088769403/REPORT.md。
- 11 组本地 HTTPS、AI 任务、PDF 导入、HEIC、取消和中断恢复检查：desktop/test-output/tauri-phase5-jobs-1793088769399/REPORT.md。
- 原生保存与取消验收：desktop/test-output/tauri-phase5-1793088344864/REPORT.md。

默认 Electron 便携版也已重新执行 npm run make:portable 并启动通过成品 e2e（14.8 秒）：desktop/test-output/validation-2026-10-27T08-11-54-296Z-11984/REPORT.md。

## 成品

Tauri：desktop/releases/tauri-preview/v0.1.0/2026-10-27-16-05-22-1793088322100/。

- EXE 14.19 MiB；完整应用目录 20.80 MiB；ZIP 10.08 MiB。
- ZIP：Matheca-Tauri-Phase5-win32-x64.zip；同目录 SHA256SUMS.txt 可校验。
- 保留完整 Matheca-win32-x64 目录及 DLL、许可文件。系统需要 Windows x64 和 WebView2；上述大小不包含系统 WebView2。

Electron：desktop/releases/v0.1.0/2026-10-27-16-05-55-1793088355415/。

- 完整目录 510.31 MiB；ZIP 199.60 MiB。
- 默认打包入口仍保持 Electron，Tauri 使用 npm run make:portable -- --tauri。

## 使用与边界

在题集页面选择 PDF 或 Word 导出，查看预览，再确认导出并选择保存位置。预览采用 PDF 排版；Word 最终分页可能随办公软件和字体变化。Word 公式是图片，目前不支持编辑为原生 Word 数学公式。系统关联程序打开成功没有自动化验证；任意路径和无效打开请求已经验证拒绝。

单次最多 2000 道题、1500 个不同公式、32 MiB 输出；请拆分超过限制的题集。老 WebView2 不支持带结构标签的 PDF 时会提示失败，需要更新运行时。

完整 ZIP 题库备份恢复属于第 6 阶段，手机传图属于第 7 阶段，交互截图属于第 8 阶段。当前仍使用独立 MathecaTauriPreview 资料目录，未自动接管原版正常题库。

技术依据：[WebView2 打印接口](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/print)、[zip 2.4.2 写入接口](https://docs.rs/zip/2.4.2/zip/write/struct.ZipWriter.html)。实际行为以工程固定依赖和上述成品验证为准。
