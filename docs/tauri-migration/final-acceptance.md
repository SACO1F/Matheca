# Matheca Tauri 最终验收报告

验收日期：2026-10-27 至 2026-10-28（北京时间）。结论：本机 Windows x64 验收范围内通过，最终解压成品 13 项完整回归全部通过，另完成原生 PDF / Word 导出验证。未发现本次覆盖范围内尚未修复的阻断问题。设备与第三方服务范围见文末。

## 交付成品

- [运行 Matheca.exe](D:/AI/Matheca/desktop/releases/tauri-preview/v0.1.0/2026-10-27-23-59-19-1793116759313/Matheca-win32-x64/Matheca.exe)
- [完整便携 ZIP](D:/AI/Matheca/desktop/releases/tauri-preview/v0.1.0/2026-10-27-23-59-19-1793116759313/Matheca-Tauri-win32-x64.zip)
- [SHA256SUMS.txt](D:/AI/Matheca/desktop/releases/tauri-preview/v0.1.0/2026-10-27-23-59-19-1793116759313/SHA256SUMS.txt)
- 完整目录 21.62 MiB，EXE 14.93 MiB，ZIP 10.37 MiB，资源文件 771 个。EXE 必须和目录内 DLL、许可证与其他资源一起保留；不要单独复制 EXE。
- 系统需提供 WebView2 Runtime；包内没有 Electron / Node 运行时。体积数字未计系统 WebView2。
- EXE SHA256：`1ce7a4cdfc27beffd07f0645940b9032a8627790d93221abbb430ba5c88fbab5`
- ZIP SHA256：`1b64c545702d8d5fec88b4a456988ad82755db6e7c2309d4727519341ef65a6d`

最终 ZIP 解压到包含“中文 空格”的独立路径后实际启动，测试全程使用 test-output 内合成题库和文件，未写入日常应用数据，也未终止用户运行实例。最终检查未发现本轮测试 Matheca.exe 遗留进程。

## 检查与证据

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| TypeScript 类型检查与 Vitest | 通过 | 14 个文件、165 项测试 |
| Rust 单元测试 | 通过 | 50 项常规测试；默认忽略的 Electron 历史密钥测试使用合成密钥另跑通过，共 51 项实际通过 |
| Rust fmt / release Clippy | 通过 | Clippy 使用 -D warnings |
| 本次修改文件的 Prettier | 通过 | 渲染器、弹窗组件与新增验收脚本 |
| Impeccable 静态检测 | 通过 | 指定主界面与样式文件的确定性检测无发现；不以此替代截图与交互检查 |
| 解压 EXE 完整回归 | 通过 | 13 项脚本全部退出码 0 |
| 发布目录与 ZIP 审计 | 通过 | 771 文件 SHA256；EXE 与 5 个原生 DLL 为 x64；ZIP 每一项与目录内容一致；篡改、缺失 DLL、混入题库均被拒绝 |
| 原生导出 | 通过 | 实际操作 Windows 保存对话框，保存一份 PDF 与两份 DOCX |

[完整回归报告](D:/AI/Matheca/desktop/test-output/validation-2026-10-27T16-00-15-567Z-50260/REPORT.md) · [资源审计](D:/AI/Matheca/desktop/test-output/tauri-phase9-release-1793116866682/REPORT.md) · [原生导出报告](D:/AI/Matheca/desktop/test-output/tauri-phase8-export-1793117029756/REPORT.md) · [导出文件校验](D:/AI/Matheca/desktop/test-output/tauri-phase8-export-1793117029756/FILE-VALIDATION.md)。

构建中的 Vite 配置加载提示及较大 JS 分块提示仍存在，不影响本次成功构建和运行，不把它们记作零警告构建。没有为减少提示修改依赖或放宽测试。

## 功能验收

| 范围 | 已验证行为 |
| --- | --- |
| 题库与校对 | 新建、保存、收藏、筛选、校对、连续确认后的撤销；防止旧撤销覆盖后续编辑；删除及恢复题集位置；重启持久化 |
| 手动录入 | 空白不入库；保存 / 放弃 / 取消；切页确认；退出时等待 16 秒仍可取消并保留草稿；重启保留已保存题目 |
| 题集 | 创建 / 取消、加入去重、排序、移除、设置、选择器、24 项长列表与长标题、校对后回原题集 |
| 知识点与历史 | 13 模块、自定义添加与搜索、无结果反馈；操作记录、查询、分页与导航历史 |
| 识别任务 | 真实 Rust 网络与任务链路连接本机 HTTPS 合成服务；图片 / PDF / HEIC、跨页、部分失败与重试、并发、暂停恢复、取消、旧响应保护、异常返回与 TLS 拒绝 |
| 截图 | 截图流程与裁剪映射测试；Rust 原生 GDI 位图像素测试。多屏特殊硬件范围另列 |
| 备份与数据 | ZIP 检查 / 合并 / 取消、重复导入保留本机编辑；损坏 / 穿越 / 篡改 / 超前版本 / 大整数边界；事务回滚、恢复后重启与原图 |
| PDF / Word | PDF 预览、分页与返回编辑；原生保存 PDF、公式图形 DOCX、长题干及选项配图 DOCX。导出 PDF 可解析为 3 页，两份 DOCX 的 ZIP CRC 与 XML 正常，分别有 14 / 7 个嵌入图像 |
| 设置与关闭 | 配置保存与加密、主题保持未保存配置、后台 / 退出及草稿保存、干净退出后数据可重新打开 |
| 手机联动 | 本机 HTTP / 浏览器协议、会话、上传接收与边界；实体手机 Wi-Fi 不在本次验证范围 |

旧库复制、原生选择器和数据兼容的阶段验收证据仍保留在 [第 9 阶段报告](D:/AI/Matheca/docs/tauri-migration/phase-9.md) 中；该历史证据不冒充本次最终 EXE 新跑的步骤。本次最终包另运行上述数据兼容、密钥和备份回归。

## 界面验收

专项产出 44 张截图：六个主页面的空状态与有内容状态、960×640 / 1440×960 视口、四主题的手动保存弹窗、退出等待、六步教学、题目编辑器、创建与加入题集弹窗。

- 已逐批检查页面层级、对齐、可读性、长标题、滚动底部动作、弹窗边界和通知遮挡；44 次截图检查均无整页横向溢出，可见控件名称检查无缺失。
- 实际平台字体检查确认标题使用 Microsoft YaHei；公式字体与本地图像加载正常。
- 四主题重点色对比度与焦点、减少动态效果、通知倒计时暂停、短 / 长滑动、Escape 等专项通过。
- 支持的 960×640 与 1440×960 是 WebView 内容视口布局检查，使用 CDP 设置视口；不能据此声称物理屏幕缩放比例、多屏 DPI 已通过。

[截图证据目录](D:/AI/Matheca/desktop/test-output/final-ui-1793116949856/ui-evidence) · [界面截图索引](D:/AI/Matheca/desktop/test-output/final-ui-1793116949856/UI-EVIDENCE.md)。

## 验收发现与修复

1. 创建题集和导入预览原先缺少原生对话框语义；创建题集的 Tab 能落到背景操作，Escape 不能关闭。统一创建题集、加入题集、知识点切换确认与导入预览为原生 HTML dialog，使用可访问名称、模态背景隔离、Escape 取消和操作期间保护；弹窗内的应用快捷键不再误触背景。
2. 原生对话框改造后，加入题集关闭的焦点恢复在 React 解除父区域 inert 之前执行，导致焦点落到 body。改为 DOM 更新完成后恢复，最终 EXE 中的焦点恢复断言通过。
3. 连续确认后撤销的第一轮断言过早读取 Rust 异步结果。修正为等待编辑框恢复后断言，应用本身无须修改撤销业务逻辑。已在进度中更正最初的产品缺陷判断。

第一轮发布候选的 12 通过 / 1 失败报告保留于 [历史失败记录](D:/AI/Matheca/desktop/test-output/validation-2026-10-27T15-42-29-595Z-10772/REPORT.md)，最后一项为焦点恢复问题。修复后重新运行 make:portable，并针对新 ZIP 解压成品重跑全部 13 项通过，没有沿用失败包作为交付。

实现：[modal.tsx](D:/AI/Matheca/desktop/src/renderer/modal.tsx)、[main.tsx](D:/AI/Matheca/desktop/src/renderer/main.tsx)、[style.css](D:/AI/Matheca/desktop/src/renderer/style.css)。新增导航、题集、滚动、通知与界面验收脚本已经接入 full 套件，业务操作均经过真实打包的 Tauri / Rust；共享测试适配器不模拟业务后端。

## 验收边界

- 已验当前 Windows x64 / WebView2 环境；未实测 Windows 其他版本、无 WebView2 的干净机器、混合 DPI 多屏、HDR、RDP。
- 手机联动验证的是本机浏览器与协议，未连接实体手机经真实 Wi-Fi、防火墙或热点测试。
- AI 请求使用本机 HTTPS 合成服务与测试密钥，未调用收费第三方服务；真实服务可用性、真实题目识别准确率和模型解答质量未纳入本次结论。
- DOCX 已检查生成与结构、公式及配图资源；未启动外部 Microsoft Word / WPS 逐页核对其各版本排版。
- 本次不产生安装器签名、商店发布或系统级安装结论。
