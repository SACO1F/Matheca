# Tauri 迁移第 6 阶段：ZIP 题库备份与合并恢复

日期：2026-10-27（北京时间）

本阶段完成。新增 backup:inspect、backup:restore、backup:dismiss、backup:export，53 个业务请求频道中已实现 36 个，剩余 17 个继续返回明确的未开放提示。React 的原有备份入口、导入预览和合并确认界面保留，Rust 接管 ZIP、原图、数据库事务、原生选择器与文件发布。

## 格式与行为

- 导出 MathecaLibraryBackup v1，接受 MathecaLibraryBackup 与旧名 MathectorLibraryBackup v1。清单为 manifest.json，原图为 sources/<SHA256>.<扩展名>。
- 备份包括题目、题集、排序关联、自定义知识点和原图；保留公式、题图、图宽、选项位置、试卷布局和有效解答标记。设置、API Key、任务、历史和本机原图路径不进入清单。
- 使用同一 SQLite 快照读取关联数据。原图先复制到本次专属目录，再计算哈希和压缩，避免哈希与随后读取的文件内容变化。
- “导入题库”使用 Windows 原生文件选择器；浏览器 File 分块拖入和 Tauri 原生路径拖入使用同一个校验入口。ZIP 必须单独导入，无需配置 AI 接口。
- 预览显示题目、题集、原图、自定义知识点和缺图数量。取消释放临时副本，不合并数据。
- 确认时重新读取和校验临时 ZIP。同编号题目和题集保留本地版本；新增题集按备份顺序建立关联；知识点按名称去重。恢复不自动启动 AI 任务。
- 原图路径重建到 restored/<UUID>/，有效解答按新路径重新计算指纹。数据库、关联和批次记录在同一事务内提交；失败回滚并删除本次专属原图目录。
- 导出在目标旁创建唯一 partial 文件，完成同步后通过 Windows 原子替换发布。失败或取消时删除本次临时文件，不先删除原目标。

ZIP 文件处理全部在 Rust 中执行；纯领域编解码复用已有 TypeScript 规则，在只有 worker_reply 权限的本地隐藏 WebView 中运行。该窗口没有题库命令、文件系统权限、网络接口或密钥，也没有新增 Node/Electron 辅助进程。

## 校验与资源管理

限制沿用原版：ZIP 与解压总量各最多 512 MiB、清单 32 MiB、单图 50 MiB；题目 20000、题集 5000、关联 100000、自定义知识点 5000。最多 20001 个 ZIP 条目。

拒绝未知备份版本、坏结构、重复编号、丢失关联、重复排序位置、整数超出范围、重复 ZIP 条目、路径穿越、额外文件、加密 ZIP、符号链接、CRC 错误、原图哈希不符和缺少的声明原图。条目按流读取至 EOF，检查实际长度与声明长度；不直接按 ZIP 路径解压。

预览最多保留两个，使用随机会话令牌。backup-staging/ 和 restored/ 的本次目录都有应用标记和文件租约锁，重启时仅清理有标记、无活动锁、未提交的目录，保留已提交批次及无标记文件。退出先取消并等待当前题库操作结束，再停止任务调度。

## 检查与成品验证

- TypeScript 类型检查、13 个文件的 163 项测试通过。
- Rust 40 项常规测试通过；1 项需独立 Electron 模拟密钥的历史兼容测试按原有标记跳过。新增 4 项测试覆盖 ZIP 路径/哈希/CRC、合并保留本地数据、事务失败回滚、活动与已提交目录保护。
- cargo fmt、release Clippy（-D warnings）及 git diff --check 通过。
- 9 组成品原生备份验证通过：desktop/test-output/tauri-phase6-1793089520002/REPORT.md。实际操作了 Windows 保存和打开对话框，检查了 React 导入预览与取消。
- 原版合成题库 → Tauri 导出 → Electron 导入并再次导出：全部题目字段、图形和布局、题集、排序、自定义知识点与原图字节逐项一致。Electron 实际导入 9 道题、1 个题集、9 个关联、1 个自定义知识点和 1 张原图。证据：desktop/test-output/tauri-phase6-exchange-1793089682566/REPORT.md。
- 备份清单检查确认不包含设置、密钥、任务和本机 sourcePath。全部原图 SHA256 与路径匹配。

最终 ZIP 校验和一致，解压 EXE 与发布 EXE 的 SHA256 相同。全新解压目录实际启动通过：

- 7 组备份回归（含预览后临时副本被篡改、失败不写入及过期令牌拒绝）：desktop/test-output/tauri-phase6-1793089757430/REPORT.md。
- Electron 二次导出 ZIP 的完整 7 组往返回归：desktop/test-output/tauri-phase6-1793089841209/REPORT.md。
- 13 组数据编辑与界面回归：desktop/test-output/tauri-phase6-data-1793089724850/REPORT.md。
- 4 组 PDF 预览与文档校验回归：desktop/test-output/tauri-phase6-1793089724826/REPORT.md。
- 11 组本地 HTTPS、导入、解题、HEIC、暂停、取消、中断和重启回归：desktop/test-output/tauri-phase6-jobs-1793089724930/REPORT.md；24 次本地请求，最大并发 2，渲染器异常 0。

第一次解压回归遇到测试脚本的退出时序问题：应用正常退出发生在 page.evaluate 返回之前，脚本将页面关闭误判为失败。保留 desktop/test-output/tauri-phase6-1793089724855/FAILURE.txt；脚本改为接受页面随正常退出关闭、继续断言进程退出码，重跑通过，没有更改应用行为。

默认 Electron 版也已执行 npm run make:portable，启动成品 e2e 通过（13.1 秒）。证据：desktop/test-output/validation-2026-10-27T08-24-40-775Z-29296/REPORT.md。

## 成品与使用

Tauri：desktop/releases/tauri-preview/v0.1.0/2026-10-27-16-24-36-1793089476886/。

- EXE 14.42 MiB，完整目录 21.02 MiB，ZIP 10.17 MiB。
- ZIP：Matheca-Tauri-Phase6-win32-x64.zip；同目录 SHA256SUMS.txt 用于校验。
- 请保留完整 Matheca-win32-x64 目录、原生 DLL 和许可文件。需要 Windows x64 与系统 WebView2；体积不包含系统 WebView2。

Electron：desktop/releases/v0.1.0/2026-10-27-16-22-46-1793089366327/。完整目录 510.31 MiB，ZIP 199.60 MiB。

在题库或“设置与备份”中选择“备份题库”保存 ZIP；选择“导入题库”或单独拖入 ZIP，检查预览后点击“确认合并导入”。合并不会用备份覆盖同编号的本地修改。原版与 Tauri 的默认资料目录继续独立，没有自动接管正常原版资料。恢复后的 restored/ 原图目录需要与 library.sqlite 一起保留。

本次使用合成题库和独立 MATHECA_TEST_DATA，未更改正常应用资料、系统证书库或用户运行中的应用。最大 512 MiB 压力、真实磁盘耗尽和突然断电未做实机破坏性验证；事务失败使用 SQLite 触发器模拟。手机传图属于第 7 阶段，交互截图属于第 8 阶段。
