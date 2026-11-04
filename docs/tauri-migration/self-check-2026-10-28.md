# 2026-10-28 自检与修复

结论：确认并修复 1 项可能丢失编辑内容的缺陷。修复版 165 项单元测试及类型检查通过；从完整 ZIP 解压的新 EXE 执行 15 项完整回归，全部退出码 0。本次覆盖场景未再发现未修复的阻断问题，不以测试通过声称软件绝对没有其他缺陷。

## 已修复的问题

慢磁盘、数据库暂时繁忙等情况使保存响应较晚返回时，用户在等待期间继续修改题干，旧 saveQuestion 结果会无条件写回 draft，并清除 dirty 标记，覆盖较晚的输入。

使用独立 test-output 数据库，由真实 SQLite BEGIN IMMEDIATE 写事务暂时持锁复现，未模拟业务 API。修复前，输入“保存过程中继续输入的新题干，不得被旧响应覆盖”，等待旧保存响应后，编辑框却恢复成“保存开始时的题干”。

[修复前复现记录](D:/AI/Matheca/desktop/test-output/save-race-1793119528905/FAILURE.md)。

修复措施：保存请求串行执行，覆盖 Ctrl+S、失焦、切页等重叠调用；响应返回后检查草稿是否已有更新，已有更新则继续保存最新草稿；导航或关闭所等待的保存操作会在最新输入写入后完成。旧响应不能再覆盖新输入，也不能错误清除其待保存状态。

实现：[main.tsx](D:/AI/Matheca/desktop/src/renderer/main.tsx:413)。

## 验证

- 类型检查及 14 个测试文件内的 165 项单元测试通过。
- npm run make:portable 成功，产生全新发布目录；用户的正常资料和运行实例未被修改或终止。
- 新 ZIP 解压至含中文及空格的测试路径后实际启动。
- 新增慢保存回归：保存期间重复 Ctrl+S、继续输入，最新内容保留且自动持久化；切页期间的新输入写入后再完成切页；退出并重启保留最新内容。
- 新回归已接入便携版套件，使用真实 Rust / SQLite。
- 完整 15 项回归全部通过，涵盖标题栏、工作台、慢保存、截图、题库、备份、导出、识别任务、联动协议、导航、题集、滚动、通知及界面。
- 771 个运行资源与 ZIP 内容逐项核对通过；格式检查通过。

[完整回归总报告](D:/AI/Matheca/desktop/test-output/validation-2026-10-27T16-50-41-130Z-24672/REPORT.md)

[慢保存修复验证](D:/AI/Matheca/desktop/test-output/save-race-1793119845604/REPORT.md)

[原始发布目录与 ZIP 审计](D:/AI/Matheca/desktop/test-output/tauri-phase9-release-1793119941379/REPORT.md)

## 修复版

[运行 Matheca.exe](D:/AI/Matheca/desktop/releases/tauri-preview/v0.1.0/2026-10-28-00-49-45-1793119785187/Matheca-win32-x64/Matheca.exe)

[完整 Windows x64 ZIP](D:/AI/Matheca/desktop/releases/tauri-preview/v0.1.0/2026-10-28-00-49-45-1793119785187/Matheca-Tauri-win32-x64.zip)

[SHA256SUMS](D:/AI/Matheca/desktop/releases/tauri-preview/v0.1.0/2026-10-28-00-49-45-1793119785187/SHA256SUMS.txt)

请保留完整应用目录和资源，系统需提供 WebView2。既有标题栏与提示行修改已保留。

## 验证边界

本机 Windows x64 场景。联动与 AI 网络用合成本机服务验证，未覆盖真实手机 Wi-Fi、真实服务识别准确率、混合 DPI / HDR / RDP、不同 Word / WPS 版本。原有 Vite 配置加载与较大分块提示仍在，未影响构建及本轮回归。
