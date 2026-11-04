# Tauri 迁移第 7 阶段：手机联动

日期：2026-10-27（北京时间）

本阶段完成。53 个业务请求频道中已实现 50 个，新增全部 14 个 mobile:* 频道。剩余 intake:capture、guide:open、guide:copy 留待第 8 阶段处理。React 手机联动面板及现有手机网页保留，Rust 接管 HTTP 服务、配对、收件、任务提交、文件回传和题库交换。

## 本阶段行为

在题库页面点击右下角“＋”→“手机联动”。电脑与手机连接同一局域网，手机扫码后核对连接码，在电脑点击允许连接。照片先进入待确认收件箱，电脑确认后才提交给现有 Rust AI 队列。

- 支持 JPEG、PNG、WebP 和 HEIC；按文件内容识别格式，并复用桌面图片解码与像素限制。
- 单张最多 50 MiB，每批最多 20 张、合计 200 MiB；最多同时上传 2 张，每次连接最多接收 400 张。
- 上传回执去重；接收中预留容量，避免并发绕过数量和大小上限。上传中断、暂停或连接失效时不提交半张照片，并清理本次 part 文件。
- 未确认照片和回执保存在独立资料目录，重启后保留。提交识别前检查已有任务的原始文件标签，避免提交成功而清理中断后再次导入。
- 返回现有任务队列的实际任务编号，手机和电脑均可显示识别状态；没有新增 AI 或 Node/Electron 辅助进程。
- 支持已配对设备凭据的记忆与撤销。持久凭据只保存 SHA256，完整凭据只在配对响应中返回；API Key 不进入手机状态或上传协议。
- 支持发送本次生成且内容未变化的 PDF/Word；拒绝任意文件路径及已被替换的导出文件。下载状态包含 ready、downloading、transferred、failed。
- 支持发送选定题目、题集及增量 ZIP。资料摘要沿用现有 Android 兼容的 UTF-8 长度编码与 SHA256；创建时间保留为精确字符串，避免 JavaScript 大整数丢失。
- 支持接收题库 ZIP，电脑预览新增、相同和冲突项后选择保留本机、替换或另存副本。副本编号确定生成，题集关联和试卷布局同时重映射。
- 确认题库交换前重新验证 ZIP 和原图，并检查本机题库是否变化。导入回执与题目、题集同事务提交；替换题目时在事务内停止旧解题任务，防止旧响应覆盖新内容。

手机网页负责照片选择、上传和文件下载；记住设备、摘要交换和题库资料接口沿用现有手机端协议。没有修改或重新发布 Android 应用。

## 网络、生命周期与资源

只有主动开启手机联动时才监听 IPv4。使用 Windows GetIpAddrTable 枚举本机地址，优先复用保存的端口，被占用时改用空闲端口。地址和二维码嵌入本机资源，二维码生成复用本地 WebView 中的现有 qrcode 包。

连接有效期 15 分钟，随机会话令牌通过二维码 URL 的 fragment 交给手机页面；页面随后清除地址中的 fragment。服务验证 Host、Origin、Bearer 凭据、设备编号、电脑批准状态和会话有效期。拒绝重复请求头、含歧义的 Content-Length、Transfer-Encoding 和非本机 Host；没有开放通用磁盘读取或应用 IPC。

请求头最多 16 KiB、64 项，读取期限 15 秒；正文和响应传输期限 90 秒；最多 12 个活动连接。手机页使用基于内嵌脚本哈希的 CSP、no-store、no-referrer 和 nosniff。局域网协议沿用原版 HTTP，不会自动改动 Windows 防火墙设置。

“收起面板”和后台运行期间可以继续收发；“结束连接”、过期和退出应用会撤销会话并停止网络收发。结束连接关闭活动套接字并等待接收线程结束，避免暂停后仍写入照片。重启应用不会自动监听网络。

状态保存在 library.sqlite 的专用设置项 tauriMobileState，原始照片在 mobile-inbox/，接收题库在其 libraries/，本次发送副本在 outgoing/。发送用的大型 ZIP 按流复制，不整包载入内存。每个资料目录只允许一个手机服务管理实例；临时备份校验目录继续使用第 6 阶段的租约和标记保护。

## 检查与成品验收

- TypeScript 类型检查和 14 个文件的 165 项测试通过。
- Rust 46 项常规测试通过；1 项需要独立模拟 Electron 密钥的历史兼容测试按既有标记跳过。
- cargo fmt --check、release Clippy（-D warnings）和 git diff --check 通过。
- 新增检查覆盖 HTTP 请求歧义拒绝、真实 IPv4 地址枚举、图片类型与摘要数量、随机凭据和仅哈希持久化、过期/拒绝/旧会话不能提交、替换事务的版本与回执保护、停止旧解题任务。
- 新增 TypeScript 对照测试确认摘要与原版协议一致，并检查冲突副本编号、题集关联及布局重映射。

候选成品的 Windows 原生保存与 PDF 回传验收：desktop/test-output/tauri-phase7-1793091760386/REPORT.md。实际保存 PDF 后经手机下载接口取回，逐字节与原文件一致；修改原文件后再次发送被拒绝。

早期联调发现 Windows 在拒绝未批准的上传后立即关闭带有未读正文的连接，可能使客户端收到 ECONNRESET。现已改为先发送响应与 FIN，再做有限排空；未批准上传可以收到明确 403。最初失败证据保留在 desktop/test-output/tauri-phase7-1793091316800/FAILURE.txt。另一次测试误将“手机联动”当成设置页按钮，实际入口是右下角“＋”菜单；已修正脚本，保留 desktop/test-output/tauri-phase7-1793091661870/FAILURE.txt。最终版本均已重跑通过。

最终发布 ZIP 已校验 SHA256，解压后的 EXE 与发布原件一致。在全新解压目录实际启动并通过：

| 检查 | 结果与证据 |
| --- | --- |
| 手机联动 10 组 | desktop/test-output/tauri-phase7-1793097859192/REPORT.md |
| 数据编辑、撤销、设置、重启及版本拒绝 13 组 | desktop/test-output/tauri-phase7-data-1793097859219/REPORT.md |
| ZIP 预览、合并与失败保护 7 组 | desktop/test-output/tauri-phase7-backup-1793097859243/REPORT.md |
| PDF 预览与排版校验 4 组 | desktop/test-output/tauri-phase7-export-1793097859299/REPORT.md |
| HTTPS、AI、PDF/HEIC 导入、取消与恢复 11 组 | desktop/test-output/tauri-phase7-jobs-1793097859292/REPORT.md |

手机检查使用隔离的无头 Edge，以 390×844 视口实际打开手机网页，完成等待电脑批准、相册选择和上传；另以协议客户端验证记忆设备、题库交换和下载。覆盖重复上传、坏图片、超大长度、20 张上限、两个占用中的上传、暂停时中断清理、待确认照片重启保留、撤销凭据和结束连接。所选题目的增量 ZIP 已检查为有效 v1 备份，只有选中的 1 道题，没有设置/任务字段，原图哈希一致。

最终默认 Electron 版也已重新执行 npm run make:portable 并启动通过 e2e（15 秒）：desktop/test-output/validation-2026-10-27T09-10-21-446Z-2460/REPORT.md。

## 交付

Tauri：desktop/releases/tauri-preview/v0.1.0/2026-10-27-17-13-19-1793092399860/。

- EXE 14.75 MiB；完整应用目录 21.36 MiB；ZIP 10.30 MiB。
- ZIP：Matheca-Tauri-Phase7-win32-x64.zip；同目录 SHA256SUMS.txt 可校验。
- 解压复跑目录：desktop/test-output/tauri-phase7-final-unzip-1793092399860/Matheca-win32-x64/。

Electron：desktop/releases/v0.1.0/2026-10-27-17-06-50-1793092010959/。完整目录 510.31 MiB，ZIP 199.60 MiB。

请保留完整便携目录及原生 DLL、许可文件。运行需要 Windows x64 和系统 WebView2；上述体积不包含系统 WebView2。默认原版和 Tauri 资料目录继续独立。

## 验证边界

全部输入为合成题库和图片，使用独立 MATHECA_TEST_DATA。HTTP 和模拟 AI HTTPS 服务绑定回环地址，未更改正常题库、用户剪贴板、系统证书库或防火墙，也未终止用户原有应用。

本次完成了浏览器与协议级验证，没有使用实体手机跨 Wi-Fi 或校园网验收，也没有重新安装 Android 应用。15 分钟到期的提交保护由单元测试覆盖，没有额外等待完整生命周期。真实慢网、最大 200/512 MiB 压力、磁盘耗尽、突然断电及不同手机的 HEIC 样本仍需更多实机覆盖。

技术依据：[Microsoft GetIpAddrTable](https://learn.microsoft.com/en-us/windows/win32/api/iphlpapi/nf-iphlpapi-getipaddrtable)。协议与业务规则以本工程的原版 mobile-import、phone-page、exchange-inventory 和成品对照测试为准。
