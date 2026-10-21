# Matheca 项目合并记录

> 后续状态（2026-10-21）：旧 Mathector 已完成精简源码及完整 Git 归档，再移入回收站；原合并前 ZIP 备份目录已按用户要求删除。当前恢复入口见 [Mathector 归档记录](MATHECTOR_ARCHIVE.md)。以下为合并时记录。

- [x] 唯一开发入口：`D:/AI/Matheca`，包含 `app/`（Android）与 `desktop/`（Windows）。
- [x] Android 权威基线：`D:/AI/Mathector` 用户修改版，含已提交与未提交的实际文件；没有仅采用 Git HEAD 或旧 App。
- [x] Windows 基线：现有 Matheca 的第一、二阶段功能。规范化换行后，与 Mathector 中桌面的实质差异均为本轮联动改动；保留现有桌面实现。
- [x] 合并前源码独立 ZIP：`D:/AI/Matheca-integration-backups/20261020-175441/Mathector-source.zip` 和 `Matheca-source.zip`。原 Mathector 目录保持原样，不删除、不重置其未提交内容。

## 原 App 保留项

| 用户原有能力 | 合并方式 |
| --- | --- |
| 石墨、雾蓝、陶土、梅紫与明暗模式 | 完整采用原 MathecaTheme、AppearanceSettings、SettingsStore |
| 题干图片、选项图片、裁切与相册／拍照 | 采用原 QuestionFigures、QuestionFigureEditor 和原题目编辑器 |
| 留白与另起一页、选题、滑动菜单 | 保留原 PaperSettings、CollectionItem 布局控制、QuestionPicker、GlideSelect |
| PDF／Word 含图片与选项图片导出 | 使用原 DocumentExporter；移除错误基线中“有图片就禁止手机导出”的限制 |
| 校对状态、自定义知识点、数学渲染 | 采用用户版对应实现 |
| 本地完整备份及旧图片附件 ZIP | 保留原兼容读取与恢复；额外保留桌面宽度／位置等元数据 |

上述 12 个核心文件逐一规范化换行校验一致；题目总界面只接入联动路由，题卡采用原文件。重叠的数据与导出文件做三方合并和桥接，不将旧版 App 整体覆盖回去。

## 联动移植

- [x] 浏览器照片发送、明确配对、待处理确认、识别状态与 PDF／Word 回传继续由桌面第一阶段提供。
- [x] Android 扫码／地址连接、权限、离线照片与题库队列、重试／排序／移除。
- [x] 双向选择题目／题集，预览新增／重复／冲突，保留／替换／另存副本。
- [x] 联动 ZIP 使用桌面标准 PNG data URI、宽度、位置、留白与分页；原生图片文件和题集条目在进出时双向映射，桌面图片进入用户原来的编辑、预览与导出流程。
- [x] “连接电脑 → 选择资料 → 导出桌面交换 ZIP”可手动导出所选资料，再从电脑备份入口导入；原“导出题库”仍用于手机本地完整备份。
- [x] 本机题目编辑不受桌面传输上限限制。超过桌面每题六图等限制时明确拒绝本次发送，原生本地备份仍保留全部内容。
- [x] 桌面单选项图片可超过原生每选项三图上限时，接收会在确认阶段明确拒绝并回滚；不静默裁掉图片。既有桌面宽度元数据保留用于回传，手机导出采用原生导出器自己的图片布局。
- [x] Android 0.23.0，原包名 com.mathector.app 保留，Room schema 9 兼容原 Android 5／6／7、联动分支 5／8 及更早版本链路。不清空用户数据。

## 验证

2026-10-20 最终交付验证：

- [x] 桌面 `npm run verify`：类型检查与 145 个测试通过；`npm run make:portable` 完成 Windows x64 便携目录及 ZIP。
- [x] 新打包 EXE 使用隔离数据启动；手机联动、核心端到端、题集、任务关联四组界面回归通过。报告：`desktop/test-output/validation-2026-10-20T10-33-35-395Z-69724/REPORT.md`。
- [x] Android `assembleDebug assembleDebugAndroidTest testDebugUnitTest lintDebug` 通过；51 个 JVM 测试，Lint 0 错误、23 警告。日志：`app/build/diagnostics/integration-final-build.log`。
- [x] 40 项设备回归通过，覆盖旧数据库迁移、原生图片与桌面格式桥接、备份、含图片 PDF／Word、原有主题、题集、编辑与联动入口。日志：`app/build/diagnostics/integration-final-40-tests.log`。
- [x] 最后新增的手动交换 ZIP 入口构建后，离线界面测试再次通过：`app/build/diagnostics/integration-offline-final.log`。
- [x] 最终 APK 与最终 Windows EXE 的原生界面跨端测试和服务层跨端测试通过，包括明确接收、冲突策略、离线队列、64 位数值、图片位置／宽度、留白／分页、幂等与往返。证据：`desktop/test-output/android-exchange-1792492855424/` 和 `android-exchange-1792492975115/`。
- [x] 用户旧版本 7／8 数据库快照仅在专属模拟器中迁移至 9；逐字段对比原内容和数量（19 题、1 题集、2 条目、1 导入记录），启动与完整性校验通过。私有验证日志：`app/build/diagnostics/merge-private-verify.log`，数据库不放入发布包。
- [x] Android 0.23.0 / versionCode 24，APK v2 签名验证通过，保留原应用包名及本机 debug 签名。最终 EXE、ZIP、APK 的 SHA256 已核对。
- [x] 独立界面审阅通过；范围和证据见 [合并审阅记录](PROJECT_MERGE_REVIEW.md)。

所有验证使用独立测试数据；模拟器 TCP 经 ADB 转发，不扩称实际 Wi-Fi／真机扫码通过。此次未向用户正常手机安装 APK，未修改正常应用数据；专属模拟器已关闭。

## 交付位置

统一源码入口：`D:/AI/Matheca`。原 `D:/AI/Mathector` 保持原样，只作为历史来源保留。

最终发布根目录：`D:/AI/Matheca/desktop/releases/v0.1.0/2026-10-20-18-29-01-1792492141869/`。

- Android：`android/Matheca-android-0.23.0-debug.apk`。
- Windows：`Matheca-win32-x64/Matheca.exe`，须保留同目录的全部运行资源。
- Windows ZIP：`make/zip/win32/x64/Matheca-win32-x64-0.1.0.zip`。
- 校验清单：`SHA256SUMS.txt`；快捷索引：`desktop/releases/latest.txt` 与 `app/releases/latest.txt`。

手机使用：安装上述 APK 后，从设置进入“连接电脑”。同网连接用于直接传输；离线时可在“选择资料”中导出桌面交换 ZIP，再由桌面备份导入入口导入。手机原“导出题库”仍是本地完整备份，两种文件用途不同。
