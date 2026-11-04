# Tauri 迁移第 2 阶段：正式工程与通信层

日期：2026-10-27（北京时间）

状态：完成。本阶段交付正式 desktop 工程中的 Tauri + Rust 入口、完整 React 工作台、类型化通信适配、只读题库接口和窗口生命周期。数据库业务写入、AI、导入导出及传图继续按后续阶段迁移。

## 工程与行为

| 内容           | 实现                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| 正式工程       | desktop/src-tauri，Tauri 2.12.0，独立 Cargo.lock、build.rs、应用配置和主窗口能力文件                                 |
| React 入口     | tauri.html → src/tauri-entry.ts；先建立 DesktopAPI，再加载原有 renderer/main.tsx                                     |
| 前端契约       | 保留 shared/types.ts 的全部 57 个方法；53 个请求频道使用共享 desktop-channels.json，4 个事件接口保留同步取消订阅函数 |
| Rust 通信      | desktop_call 使用明确的成功/失败信封，错误包含可判断的 code；未知频道拒绝，未迁移业务返回 NOT_IMPLEMENTED            |
| 事件           | 状态变化、历史订阅、关闭选择、退出前保存；异步注册晚于 React 卸载时也会取消订阅；关闭保存带请求编号，拒绝过期确认    |
| 工作台         | 原题库、题集、知识点、任务、历史和设置页面；顶部明确标注独立资料库与当前开放范围                                     |
| 资料目录       | 默认 LOCALAPPDATA/MathecaTauriPreview；测试使用进程级 MATHECA_TEST_DATA；不自动读取或接管原版资料目录                |
| 只读接入       | 使用 rusqlite 读取独立 v1 library.sqlite 的实际记录；没有数据库时返回真实空状态，不自动生成示例或修改 schema         |
| 资料与图片     | 题目、题集、关联、自定义知识点、任务、历史读取；原图通过限定根目录和题目 ID 的受控协议提供，拒绝外部路径             |
| 主题及关闭设置 | 写入独立 preview-settings.json，采用临时文件替换；不写题库数据库，不读取旧密钥                                       |
| 窗口           | 原生关闭确认、取消、保存确认后退出；保存失败留在应用；后台运行、托盘打开/退出；读取失败时仍可关闭                    |
| 安全边界       | 固定 main 窗口能力、明确的自定义命令权限、CSP、外部导航/新窗口拦截；前端没有文件系统或进程执行权限                   |
| 分发           | 完整 React、字体及浏览器资源嵌入 EXE；不携带 Electron、Node 或业务辅助进程                                           |

为后续数据层迁移提供了只读 Repository。正常数据层写入尚未实现；本阶段没有用内存模拟或空返回冒充编辑、导入等操作成功。

## 当前接口边界

已接通的业务频道为 library:state、history:list、settings:color-theme、settings:close-action、question:manual-prompt、window:close-choice。另有受限窗口控制与保存确认内部频道。

其余 47 个请求频道保留同名类型化入口，在 Rust 中明确返回尚未开放。前端显示可理解的提示，维持当前草稿的未保存状态。文件拖放已接入 Windows WebView2 事件和错误传播，但本阶段不会读取上传内容或启动导入任务。

当前 Repository 不代表完整旧库迁移：旧设置、密钥、任务恢复、数据规范化和业务事务需要在第 3/4 阶段接齐。原图读取还不含 HEIC 转换，后续采用第 1 阶段已验证的原生方案。

## 验证结果

| 检查                  | 结果                                                                       |
| --------------------- | -------------------------------------------------------------------------- |
| TypeScript + Vitest   | 12 个文件、160 项测试通过；其中 6 项新增测试覆盖适配器与生命周期通信       |
| Rust 生命周期单元测试 | 4 项通过：取消关闭、保存编号、重复关闭/手动保存保护、后台运行              |
| Rust Clippy           | release 模式 -D warnings 通过                                              |
| 构建                  | npm run make:portable -- --tauri 通过，生成 Windows x64 Matheca.exe 和 ZIP |
| 成品界面检查          | 12 组通过，0 个捕获的渲染器异常                                            |
| ZIP 解压后的成品      | 使用解压后的 EXE 重跑 12 组界面检查，全部通过                              |
| 原版兼容验证          | 默认 npm run make:portable 通过；新 Electron 便携 EXE 的 e2e 验证通过      |

12 组界面检查包括：完整 React 与 57 方法、只读错误、主题事件与取消订阅、页面导航与历史、原图协议、关闭取消、后台恢复、未保存编辑阻止退出、较新数据库显式失败且可关闭、SQLite 字节不变、设置重启保留、空目录不生成假题库。

后台恢复检查通过与托盘共用的 Rust show 入口执行；没有把它表述为已人工点击托盘的跨机器验收。界面和窗口行为在本机 Windows/WebView2 环境验证，其他机器和运行时版本仍需后续回归。

## 成品及证据

Tauri 预览版：

- 目录：desktop/releases/tauri-preview/v0.1.0/2026-10-27-01-55-04-1793037304982/Matheca-win32-x64/
- EXE：Matheca.exe，约 10.54 MiB。
- ZIP：同级 Matheca-Tauri-Phase2-win32-x64.zip，约 6.01 MiB。
- 完整目录与 ZIP 保留 README、嵌入 EXE 的运行资源及依赖锁文件，同级提供 SHA256SUMS.txt；首次启动的 WebView2 资料写入独立预览目录。

这些体积是第 2 阶段预览版的实测值，尚未包含全部 Rust 业务与导出、解码依赖。

原版便携版：desktop/releases/v0.1.0/2026-10-27-01-47-54-1793036874036/。

证据：

- 最终成品验证：desktop/test-output/tauri-phase2-1793037376535/REPORT.md。
- ZIP 成品验证：desktop/test-output/tauri-phase2-1793037385625/REPORT.md。
- Electron e2e：desktop/test-output/validation-2026-10-26T17-49-26-330Z-51536/REPORT.md。
- 成品检查目录包含 workbench.png、empty-workbench.png 和独立测试数据库。

## 构建与复跑

在 desktop/ 下：

```powershell
npm run verify
npm run make:portable -- --tauri
node scripts/tauri-ui.mjs
```

界面检查需要 Python（用于复制和构造独立 SQLite 样本），可通过 MATHECA_QA_PYTHON 指定。默认样本来自第 1 阶段的独立验证目录；也可以用 --seed 指定该目录下的合成数据库。检查脚本不会接受正常应用资料目录作为样本。

可用 MATHECA_CARGO_TARGET_DIR 复用本机 Cargo 构建缓存，MATHECA_CARGO_OFFLINE=1 使用已有依赖离线打包。没有设置时使用正式工程的 src-tauri/target；此轮构建复用了第 1 阶段的本机缓存。

不带 --tauri 的 npm run make:portable 继续打包完整 Electron 版。两个版本分别维护 latest.txt 和 latest-tauri.txt，均使用新的输出目录，未覆盖或终止用户正在运行的应用。

## 第 3 阶段接续

1. 完成 Rust 数据层写入与事务，逐项实现题目、题集、知识点、历史及撤销。
2. 用旧库副本验证完整字段、数据版本、目录选择、备份与恢复机制。
3. 将已实现频道从明确的 NOT_IMPLEMENTED 分支接入实际 Repository；保持共享接口及事件契约。
4. 完成旧设置和密钥迁移的专项验证，不直接把预览目录替换为原版资料目录。
5. 在独立数据上验证成品，再交付新的 Windows x64 便携目录及 ZIP。
