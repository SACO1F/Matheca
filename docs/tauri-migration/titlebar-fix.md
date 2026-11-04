# 标题栏与迁移提示修订

日期：2026-10-28。

- 取消重复的系统标题栏，后退、前进、侧边栏、历史、中间名称和窗口控制在同一条 36px 标题栏内；保留拖动及双击最大化 / 还原。
- 删除“Tauri 迁移版”提示整行和额外顶部留白。窗口名称改为 Matheca。
- “复制原版题库”入口移到设置与备份的题库导入与备份区域。
- 最小化、最大化、还原和关闭使用真实 Tauri 窗口方法；关闭仍进入原有保存 / 后台 / 退出流程。

## 发布

[运行 EXE](D:/AI/Matheca/desktop/releases/tauri-preview/v0.1.0/2026-10-28-00-23-34-1793118214924/Matheca-win32-x64/Matheca.exe)

[完整 ZIP](D:/AI/Matheca/desktop/releases/tauri-preview/v0.1.0/2026-10-28-00-23-34-1793118214924/Matheca-Tauri-win32-x64.zip)

[新版界面截图](D:/AI/Matheca/desktop/test-output/titlebar-1793118513913/ui-evidence/titlebar-wide.png)

## 验证

- 类型检查及 165 项单元测试通过，Rust fmt 检查通过。执行 npm run make:portable 成功，使用独立 test-output 数据启动新 EXE 验证。
- 完整套件共 14 项。第一轮 13 项通过，数据脚本最后的新库检查仍等待已删除的 .migration-preview-notice 而超时；修改为等待 .window-titlebar 后，数据脚本单独复验通过。应用业务逻辑没有因该测试超时被修改。
- [完整回归及首次失败记录](D:/AI/Matheca/desktop/test-output/validation-2026-10-27T16-28-31-255Z-38388/REPORT.md)。
- [数据回归复验通过](D:/AI/Matheca/desktop/test-output/validation-2026-10-27T16-32-39-649Z-7440/REPORT.md)。
- [标题栏专项通过](D:/AI/Matheca/desktop/test-output/titlebar-1793118513913/REPORT.md)：实际窗口按钮最大化 / 还原、关闭确认取消、导航、960 / 1440 视口、入口迁移及无提示栏。
- 资源审计逐文件及 ZIP 核对通过，771 个文件，完整目录约 21.62 MiB。
- 原生 Computer Use 观察：拖动使真实窗口从 (247,36) 移到 (307,90)；双击最大化到 1920×1032 并还原到 1442×962；点击最小化后工具报告 window is minimized。
- 原生补充脚本等待人工完成标记的 240 秒期限到达而退出，随后 activate_window 返回 foreground window did not report a process id，因此不把该次工具恢复动作计为验证通过。该测试窗口已通过自身关闭流程退出。标准标题栏专项和上述主套件为独立、已完成的验证证据。
- 未写入日常题库或终止用户原先运行的版本。Windows Snap 悬停布局、混合 DPI 不在本次结论中。
