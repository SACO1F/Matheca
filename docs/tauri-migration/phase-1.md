# Tauri 迁移第 1 阶段：功能基线与技术验证

日期：2026-10-27（北京时间）

结论：第 1 阶段完成。本机关键技术验证通过，可以进入第 2 阶段的工程与通信层迁移。此结论仅表示迁移方案具备本机可行性，完整应用仍是现有 Electron 版。

## 已交付内容

- 独立 Tauri 2.12.0 + Rust 验证工程：`desktop/migration/phase1/`。
- 原有 React 项目构建出的文档排版引擎直接在 WebView2 中运行，验证期间没有改写排版逻辑。
- 9 道独立题目、1 个题集、1 个自定义知识点、原图、旧格式 SQLite、备份 ZIP、Word、Electron/Tauri PDF 和公式图片。
- 自动接口盘点：57 个 `DesktopAPI` 方法，58 处主窗口/截图窗口入站命令及事件注册。53 处位于主进程业务 `handle` 包装器，其余属于窗口和截图事件。
- 跨运行时对照脚本、PDF 渲染样本、独立 EXE 及 ZIP、可复跑说明。
- 现有 Windows x64 Matheca 便携版重新构建并启动验证。

## 实测结果

现有项目 `npm run verify` 通过：TypeScript 类型检查、11 个测试文件、154 项测试。Rust 格式检查、`cargo clippy --release -- -D warnings` 和 release 构建通过；完整 run.ps1 已端到端复跑成功。

独立验证程序通过 32 项输出对照检查，原始记录见 `desktop/test-output/tauri-phase1-20261027-011039/COMPARISON.md`。

| 验证项                     | 实测结果                                                                                                         | 后续采用方案                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 中文、公式、选项及配图排版 | 两侧都是 9 题、13 处公式、1 张配图；文档宽度 686.65625 CSS px，高度 2137.5 CSS px                                | 保留现有浏览器排版引擎                                                                         |
| PDF 页面                   | 两侧均为 3 页 A4，每页文字与顺序一致；逐页栅格平均差异低于 2%                                                    | Rust 调用 WebView2，保留 CSS 分页                                                              |
| PDF 可访问性标签           | 普通 `PrintToPdf` 输出在本机没有结构标签；额外验证的 CDP 输出保留 `/StructTreeRoot` 和 `/Marked`，页数及文字一致 | 优先使用已验证的 CDP `Page.printToPDF`，显式设置 `generateTaggedPDF`；普通打印接口作为技术对照 |
| 公式转图片                 | 两侧都是 349×189 PNG；归一化公式墨迹差异为 0，四周有完整留白                                                     | WebView2 `CapturePreview` 内存流 + Rust 裁剪                                                   |
| 桌面捕获                   | Rust/GDI 生成 320×220 PNG，红色和背景色像素与测试窗口一致                                                        | 在此原生能力之上实现截图选择层                                                                 |
| HEIC                       | Rust 动态调用 libheif 1.23.2，真实样本输出 1280×854 PNG；坏文件拒绝且不生成图片                                  | Rust + 原生 libheif/libde265，不使用 Node 辅助进程                                             |
| SQLite                     | Rust/rusqlite 只读打开 Electron 创建的 v1 数据库；完整性和外键检查正常；题目字段及题集顺序一致                   | 延续 SQLite 格式，逐步替换业务访问层                                                           |
| 备份格式                   | 旧版 ZIP 中格式标记、版本、题目、原图条目及 SHA256 校验通过                                                      | 保持备份 v1 兼容契约                                                                           |
| Word 基线                  | 旧版 DOCX 有 15 个媒体文件、26 个段落；本阶段已证明公式 PNG 的替代生成路径                                       | 第 5 阶段用 Rust 完成 DOCX 组装并与基线比较                                                    |

栅格差异阈值用于发现大幅位置、分页或内容偏差，不能代替目视检查。已渲染并检查完整三页样本：中文、分式、根式、分段函数、选择题、原图和长题正常。公式图、截图和 HEIC 图也应与原始证据一起保留。

## 数据兼容契约

| 项目       | 当前基线                                                                          | Rust 迁移约束                                                                 |
| ---------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 正常目录   | Electron `userData`；还兼容旧名 `Mathector`                                       | 在第 3 阶段明确目录选择，不能仅使用 Tauri 默认目录导致旧题库“消失”            |
| 主数据库   | `library.sqlite`，`PRAGMA user_version=1`，WAL、外键、10 秒忙等待                 | 保留表结构和数据语义；遇到更高版本拒绝写入；升级先备份                        |
| 表         | questions、collections、items、knowledge、settings、jobs、pages、batches、history | history 由启动逻辑独立创建，不能只看 user_version 判断表是否齐全              |
| 业务字段   | 多个表的 `data` 列存放 JSON；题目创建时间为字符串，索引列为整数                   | 明确字符串/整数边界，保留可选字段和旧记录默认值                               |
| 题集顺序   | items.position                                                                    | 顺序读取与重排必须保持事务一致性                                              |
| 原图       | 数据库保存实际文件路径；前端收到 `matheca-asset://question/...`                   | Rust 层保存实际路径，前端通过受控资源协议读取，禁止直接混用两种值             |
| 公式与配图 | LaTeX 文本、内联图片、图宽及题干/选项归属                                         | 保留图片位置和毫米尺寸；不能只迁移题干文本                                    |
| 备份标记   | `MathecaLibraryBackup`，version=1                                                 | 不因更换框架改成不兼容格式；appVersion 应记录实际构建版本                     |
| 时间精度   | 清单含 64 位整数，现有实现使用 lossless-json/BigInt                               | Rust 采用 i64/serde_json 数字，避免中转成浮点导致精度丢失                     |
| 备份原图   | `sources/<sha256>.<ext>`，CRC、SHA256、条目白名单及引用校验                       | 保留所有校验与体积/数量限制                                                   |
| API Key    | Electron safeStorage 加密后的 `encryptedKey`                                      | 本阶段未验证旧密文解密；第 3/4 阶段用合成密钥专项验证，失败时明确提示重新配置 |
| 未完成任务 | jobs/pages/batches 中保存恢复状态                                                 | 本次样本这些表为空；恢复、断点、取消及事务清理是第 4/6 阶段验收项             |

备份限制保持：ZIP 512 MiB、清单 32 MiB、单图 50 MiB、题目 20,000、题集 5,000、关联 100,000、自定义知识点 5,000。

## 功能迁移清单

| 功能组           | 现有入口/实现                                        | 后续阶段 | 验收要求                                                                   |
| ---------------- | ---------------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| 接口桥接与事件   | preload.ts、shared/types.ts                          | 2        | 覆盖全部 57 方法，保留订阅取消、错误传播和状态事件；不能使用空实现伪装完成 |
| 页面与主题       | renderer/、shared/color-themes.ts                    | 2、9     | 接入完整 React 工作台，验证拖放、字体、交互与布局                          |
| 题目/题集/知识点 | store.ts、domain/                                    | 3        | 增删改查、收藏、校对、选题、重排和自定义知识点一致                         |
| 撤销             | store.ts 中删除、加入及校对撤销                      | 3        | 验证状态变化后的撤销失效条件，避免覆盖新修改                               |
| 设置与密钥       | settings.ts、safeStorage                             | 3、4     | 配置迁移、地址变化处理、密钥不可用提示与敏感信息隔离                       |
| AI 与任务        | jobs.ts、network.ts、workers.ts                      | 4        | 识别、解题、并发、取消、重试、退出与重启恢复                               |
| 文件/剪贴板/拖放 | main.ts、render-host.ts、worker.ts                   | 4        | 图片、PDF、HEIC、ZIP 导入；保留数量、像素、体积限制                        |
| 预览与导出       | render-engine.ts、export.ts                          | 5        | PDF 标签、分页、宽公式、选项配图、长题、Word 图片与留白对照                |
| 备份与恢复       | archive.ts、domain/backup.ts                         | 6        | 原图校验、旧格式恢复、损坏输入、重复/冲突策略、原子提交与恢复              |
| 题库交换         | library-exchange.ts、exchange-inventory.ts           | 6、7     | keep/replace/copy、指纹、清单及图片引用一致                                |
| 手机传图         | mobile-import.ts、paired-devices.ts、phone-page.html | 7        | 配对审批、拒绝、过期、上传、暂停、中断重试和设备遗忘                       |
| 截图             | screen-capture.ts、capture.ts                        | 8        | 交互选区、取消、至少 8×8、多屏、负坐标和混合缩放                           |
| 窗口与退出       | main.ts、关闭选择及保存对话框                        | 2、8     | 未保存内容、取消关闭、后台运行、托盘、退出等待与资源释放                   |
| 历史             | history.ts、store.ts                                 | 3、9     | 分类、筛选、分页及避免记录失败影响已成功业务操作                           |
| 打包与验证       | portable.mjs、validate-portable.mjs、UI 脚本         | 全程     | 保留 `npm run make:portable` 入口，正式切换时只分发完整 Tauri 应用         |

完整方法/频道清单由 `inventory.mjs` 自动生成，见证据目录 `INTERFACES.md`，不在此手动复制 57 行以免漂移。

## 尚未覆盖的边界

1. 本机只有一个 1920×1080、100% 缩放的显示器，未实际验证混合 DPI、多屏、负坐标及交互截图框选。
2. 本机 WebView2 为 155 系列；旧版运行时和其他 Windows 版本尚未覆盖。CDP 标签参数需在实际支持范围内做能力检查。
3. 一份有效 HEIC 加一份坏文件不能代表整个手机图片集合；旋转、HDR、色彩配置、网格、多图和内存限制需要扩充样本。
4. Rust 版 Word 文档组装、旧密钥迁移和未完成任务恢复还未实现；本阶段只建立基线及验证关键底层能力。
5. 探针为独立验证工具，CSP、权限、FFI 资源封装和超时策略不能直接作为生产实现使用。
6. 探针只包含排版和验证功能，其包体积不能作为完整迁移版体积承诺。

这些是后续阶段的明确验收条件，不影响本阶段已验证路径的本机可行性结论。

## 成品交付验证

验证工具完整目录约 14.18 MiB，ZIP 约 7.88 MiB。ZIP 解压到新的测试目录后，在不设置路径环境变量的情况下直接启动 EXE，退出码为 0，自带测试数据上的检查通过。记录见证据目录 `ZIP-LAUNCH-CHECK.txt`。

这些体积只属于第 1 阶段验证工具；工具尚未包含完整工作台和全部业务，不能据此承诺正式迁移版体积。现有 Matheca 的完整 Electron 便携版也已重新构建并由基线脚本启动、导出验证，路径记录在 `desktop/releases/latest.txt`。

## 第 2 阶段执行顺序

1. 在正式 desktop 工程内建立 Tauri 入口、配置、资源及 Windows 构建路径；保留可运行的旧版基线。
2. 保留 DesktopAPI 类型契约，先实现 Rust 命令与事件适配，再接入 React；未迁移接口明确标记，不返回伪造成功。
3. 接通启动、窗口关闭、错误返回和订阅取消；在独立数据目录完成最小运行验证。
4. 逐项连接数据接口，为第 3 阶段的真实 SQLite 业务实现留出清晰边界。
5. 生成完整 Windows x64 便携目录及 ZIP，用成品 EXE 启动验证实际行为。

## 复跑与证据

源码入口：`desktop/migration/phase1/run.ps1`，参数和运行要求见同目录 README.md。

最终证据目录：`desktop/test-output/tauri-phase1-20261027-011039/`。

目录中包括 `COMPARISON.md`、`INTERFACES.md`、`sqlite-schema.json`、`baseline-results.json`、`tauri-results.json`、各 PDF/PNG/DOCX/ZIP 和打包验证程序。中间失败尝试保留在其他独立测试目录中，未覆盖真实用户数据。

构建过程曾遇到网络超时：Electron 下载使用本机同版本缓存解决；Cargo 首次索引连接失败后使用本机缓存离线构建成功，Cargo.lock 已固定依赖。最终交付以通过验证的构建为准。

技术参考：

- Tauri `with_webview`：https://docs.rs/tauri/2.12.0/tauri/webview/struct.WebviewWindow.html#method.with_webview
- WebView2 打印：https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/print
- Chromium CDP Page.printToPDF：https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-printToPDF
- libheif：https://github.com/strukturag/libheif
