# 手机联动第二阶段：交付与系统一致性记录

记录日期：2026-10-20。本记录针对已构建 Windows 便携版和 Android 0.22.0 最终测试包，属于既有产品的普通功能扩展。用户所说“以桌面为标准”指交换数据格式和字段语义；桌面继续采用中性工作台，Android 继续采用既有蓝色 Material 界面。没有新增视觉身份或设计 token，本次不修改 `DESIGN.md`、`.impeccable/design.json` 或已打包说明。

## 交付版本

发布入口为 [latest.txt](../desktop/releases/latest.txt)，指向 `desktop/releases/v0.1.0/2026-10-20-16-33-57-1792485237159/`。完整 Windows 运行目录与 ZIP 保持在同一发布根目录，Android 包位于其中的 `android/` 子目录。

- Windows：[Matheca.exe](../desktop/releases/v0.1.0/2026-10-20-16-33-57-1792485237159/Matheca-win32-x64/Matheca.exe)。必须与同目录运行资源一起使用。
- Windows ZIP：[Matheca-win32-x64-0.1.0.zip](../desktop/releases/v0.1.0/2026-10-20-16-33-57-1792485237159/make/zip/win32/x64/Matheca-win32-x64-0.1.0.zip)。
- Android：[Matheca-android-0.22.0-debug.apk](../desktop/releases/v0.1.0/2026-10-20-16-33-57-1792485237159/android/Matheca-android-0.22.0-debug.apk)。这是本地 debug 签名测试包，最终 APK v2 签名验证通过。
- 三个文件的校验值保存在 [SHA256SUMS.txt](../desktop/releases/v0.1.0/2026-10-20-16-33-57-1792485237159/SHA256SUMS.txt)。

## 系统一致性

桌面“手机联动 → 题库交换”复用既有弹层、按钮、字段、细边界与中性表面。`library-exchange.tsx` 的选择与接收预览使用原生 checkbox、带标签的 select 和明确确认按钮；`mobile-import.css` 的新增预览面复用 `--subtle`，分隔复用 `--line`。截图中的石墨主按钮、白色弹层和低对比层次延续既有工作台，没有把 Android 蓝色推广为桌面新规则。

Android `DesktopLinkScreen.kt` 使用现有 Material 3 的 `Scaffold`、`TopAppBar`、`FilterChip`、`Surface`、`Button` 和 `AlertDialog`，文字使用现有 `MaterialTheme.typography`。蓝色选中态、圆角操作按钮、明暗表面沿用 Android 系统。题目／题集选择整行使用 checkbox 角色，冲突处理整行使用 radio 角色并归入单选组；标签与控件合并语义，内部视觉控件不重复注册点击。最终三类行均有至少 48 dp 高度。

系统摘要：

1. 桌面色彩为中性灰外壳、白色工作区、石墨操作及既有语义色。
2. Android 保留既有蓝色 Material 主题和明暗模式，不要求与桌面视觉同形。
3. 桌面沿用 Segoe UI／Microsoft YaHei 层级，Android 使用现有 Material 文字角色；不新增字体梯度。
4. 延续 `The Restrained Accent Rule` 和 `The Content Leads Rule`：强调当前操作，数学内容与资料名称可读。
5. 延续 `The Flat Rest Rule`：普通资料表面平静，浮层表达层级；本轮不创建新设计规则或 token。

## 功能与数据语义

交换标准是桌面 `MathecaLibraryBackup` v1 ZIP，Android Room schema 升至 5。两端明确选择题目／题集，题集自动包含关联题目及顺序。原图、PNG 插图、插图位置与宽度、题集留白和分页、已有解答及有符号 64 位时间戳保留在交换中。手机照片与资料包进入持久离线队列；已送达状态、排序、移除、重试和手动清理都有明确操作。

接收先显示新增、重复、冲突，再由用户选择保留本机、使用收到版本或冲突另存副本。桌面和手机使用同一处理语义；不自动判断哪端更新，不传播删除，不因接收启动识别或解题。普通备份导入仍默认保留本机版本。

Android 旧文档导出器不能完整呈现桌面插图及题集排版。本轮在 `MathectorApp.kt` 和 `DocumentExporter.kt` 明确阻止这类导出并提示转到电脑导出 PDF／Word；数据保留能力不被表述为手机排版导出等价能力。具体字段与限额见 [MOBILE_LINK_PHASE2.md](MOBILE_LINK_PHASE2.md)。

## 检查证据与本人范围

文档检查读取了 `PRODUCT.md`、`DESIGN.md`、`.impeccable/design.json`、桌面工作区方向契约、本阶段功能文档，以及桌面交换组件／样式、Android 联动界面、备份编解码、桌面字段适配和导出阻止相关源码。没有重新提取或测量整套设计 token。

本人亲自打开最终版本的以下三张截图：

- [Android 接收预览，字体 1.3 倍](../desktop/test-output/phase2-connected-ui-final48/android-receive-preview.png)：检查三个接收策略、状态计数、明确确认和取消在对话框中可见。
- [Android 资料选择，默认字体](../desktop/test-output/phase2-ui-final48/android-selection-light.png)：检查蓝色 Material 选择态、题目标签与勾选关系、主要加入队列操作。
- [打包桌面接收预览](../desktop/test-output/android-exchange-1792486824182/desktop-exchange-preview.png)：检查中性工作台延续、接收预览和确认操作、滚动区域与连接信息分区。

本人未亲自逐张打开全部截图，也未在本次文档角色中重跑应用或设备测试；以下结果来自已落盘报告、日志与主执行者的最终构建记录：

| 验证 | 最终证据与结果 |
| --- | --- |
| 桌面类型及单元检查 | `npm run verify` 通过，145 个测试；`npm run make:portable` 成功。 |
| 新便携版四组运行回归 | [REPORT.md](../desktop/test-output/validation-2026-10-20T08-46-07-433Z-19952/REPORT.md)：手机联动、核心端到端、题集、任务关联全部退出码 0，使用隔离数据启动最终 EXE。 |
| Android 构建与静态检查 | 最终 Gradle `BUILD SUCCESSFUL`，40 个 JVM 测试；Lint 0 错误、21 警告，未宣称零警告。 |
| 最终 Android 设备测试 | [phase2-final48-native-tests.log](../desktop/test-output/phase2-final48-native-tests.log)：备份 7、解答 6、离线联动界面 1，共 14 个通过。 |
| 最终原生界面与打包 Windows 交互 | [RESULT.md](../desktop/test-output/android-exchange-1792486824182/RESULT.md) 与 [android-instrumentation.log](../desktop/test-output/android-exchange-1792486824182/android-instrumentation.log)：实际 TCP 交换与 1 个 connected UI 测试通过，包含标签点击和选择语义断言。 |
| 最终 APK 服务层交换专项 | [RESULT.md](../desktop/test-output/android-exchange-1792486995655/RESULT.md) 与 [android-instrumentation.log](../desktop/test-output/android-exchange-1792486995655/android-instrumentation.log)：`DesktopExchangeTest` 1 个通过，覆盖离线队列恢复、keep／copy／replace、重复副本与 64 位字段往返。最终三组 instrumentation 合计 16 个通过。 |
| 最终图像证据 | [联网界面，字体 1.3 倍](../desktop/test-output/phase2-connected-ui-final48/) 共 4 张；[离线界面，默认字体](../desktop/test-output/phase2-ui-final48/) 共 5 张；[桌面交换目录](../desktop/test-output/android-exchange-1792486824182/) 含发送、预览、紧凑窗口 3 张。 |

独立 reviewer 的原完整审阅覆盖 7 张截图及相关 UI 抽查，唯一 P2 为标签／控件语义未合并。该问题修复后曾发生 48 dp 最小高度回归，最终版本保留语义合并并恢复三类行的 48 dp 最小高度。reviewer 随后亲自打开最终联网 4 张及资料选择 1 张截图，并核对源码，最终结论为 **ship**，两项均 **resolved**。此轮最终复核只覆盖这两项修复，不扩称新一轮完整产品审计。

## 真实边界与未纳入系统的事项

跨设备验证使用专属 Android 17 模拟器与隔离 Windows 数据，通过 ADB 转发建立实际 TCP 连接，并保留生产 Host 校验。这证明该环境下的协议与原生操作链路，不等于已完成真实手机 Wi-Fi、相机扫屏、厂商权限／防火墙、Android 8.0 实机或大规模性能验收。

本阶段只有临时连接和手动双向交换；无云端、跨网络服务、长期配对、后台同步、增量版本基线或自动合并。无障碍证据针对整行操作、标签语义与最小触摸高度，不构成全面 TalkBack 或无障碍认证。既有桌面 13／15 px 题干字号的 specificity 漂移和紧凑元数据已在原 `DESIGN.md` 记录，本轮未修复，也不将其改写为新增标准；Lint 21 条警告同样未被掩盖或固化为设计规则。
