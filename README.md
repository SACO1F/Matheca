# Matheca v0.1.0

面向高中数学备课的本地题库工具，提供 Windows 桌面版与 Android App。支持收集题目、AI 识别、人工校对、知识点分类、选题组卷，以及 PDF／Word 导出。

| 平台 | 当前版本 | 工程 | 使用说明 |
| --- | --- | --- | --- |
| Windows x64 | **v0.1.0** | Electron / React / TypeScript · [desktop/](desktop/) | [桌面版使用与构建](desktop/README.md) |
| Android 8.0+ | **v0.1.0** | Kotlin / Jetpack Compose · [app/](app/) | [安装与快速开始](#android-安装与快速开始) |

两端分别保存本地题库，通过局域网手动交换题目与题集。首次连接需确认，接收资料需预览；支持记住设备、再次连接与仅发送内容不同的资料。

## 获取与运行

本机已构建文件的位置记录在 `desktop/releases/latest.txt` 与 `app/releases/latest.txt`。从源码构建的方法见下文。安装文件不提交到 Git，公开附件以 [GitHub Releases](https://github.com/SACO1F/Matheca/releases) 中实际标注的版本为准。

- **Windows**：完整解压 `Matheca-win32-x64-0.1.0.zip`，运行目录中的 `Matheca.exe`，保留 DLL、`resources/` 等运行资源。
- **Android**：安装 `Matheca-android-0.1.0-debug.apk`。目前提供 Debug 签名构建；覆盖安装需要包名和签名一致。卸载前请先导出题库备份。

## 核心功能

| 功能 | 当前能力 |
| --- | --- |
| 题目录入 | 拍照、相册图片、PDF 和手动录题；桌面另支持截图、剪贴板与拖放 |
| AI 识别 | 使用自行配置的多模态接口，支持 PDF 和同批连续照片中的跨页题目识别；结果保存为待校对草稿 |
| 题库整理 | 年级、知识点、题型、难度、关键词、收藏与校对状态筛选；题目正文、公式和图片完整显示 |
| 校对编辑 | 对照来源原图编辑题目、插图和图片选项；手机编辑返回保留来源页面、筛选及滚动位置 |
| 题集组卷 | 选择题目、排序、移除、文档设置、每题留白与分页 |
| 公式与解题 | 本地 KaTeX 排版；可选 AI 解题，答案需自行核对 |
| 文档导出 | A4 PDF 与 DOCX，支持试卷标题、说明、时间、满分及选择题选项排版 |
| 备份恢复 | 完整题库 ZIP 导出、校验和合并恢复；备份与练习文档用途不同 |
| 手机联动 | 扫码传图、题目与题集双向交换、文档回传、设备配对和手动增量发送 |
| 外观交互 | 石墨、雾蓝、陶土、梅紫强调色；Android 支持明暗主题，桌面采用浅色工作台；联动页面与按钮有平移过渡 |

## Android 安装与快速开始

1. 安装 APK，首次打开可使用三道示例题，或通过加号手动录入。
2. 在“我的 → 题目识别与接口”填写 HTTPS 地址、API Key 和支持图片输入的模型名，保存并测试。
3. 拍照、选择相册图片或导入 PDF。跨页照片请按页码顺序在同一批导入。
4. 打开待校对题，对照原图修改题干、图片和分类，确认已校对。
5. 创建题集、选择题目并调整顺序与文档设置，导出 PDF 或 Word。

手动录入、本地整理、公式显示和文档导出可离线使用。识别和 AI 解题需要联网接口。

## 连接手机与电脑

1. 手机与电脑接入能互相访问的同一局域网，在桌面右下角加号打开“手机联动”。
2. Android 进入“我的 → 连接电脑”，扫码或粘贴完整连接地址。也可使用手机浏览器扫码传图，无需安装 App。
3. 核对两端显示的核对码，在电脑允许连接。Android 可选择记住电脑；再次连接时电脑仍需开启联动。网络地址变化时重新扫码。
4. 在“连接与待传”管理连接和待传队列，在“选择资料”选择题目与题集，在“接收题库”校验并预览电脑发来的资料。
5. 双方接收前确认新增、重复和冲突记录；冲突可保留本机、使用收到的版本或另存副本。题集携带关联题目、顺序和排版设置。
6. 可启用“仅发送与对端不同的资料”。相同内容跳过，题集内容变化时携带关联题目；电脑可撤销已配对手机的访问。

选择资料使用与题库一致的年级、知识点、题型、难度筛选器，跨筛选保留已选项。收到资料不自动触发识别或解题，不传播删除。当前提供局域网手动交换，没有账户云同步或系统后台自动同步。

桌面还可接收手机照片，在电脑确认后开始识别，并把本次运行中导出的 PDF／Word 发回手机。浏览器连接同一时间支持一台客户端；切换浏览器与 App 时结束原连接后重连。网络权限或 Wi-Fi 设备隔离可能影响连接，详细限制见 [桌面版说明](desktop/README.md)。

## 配置识别接口

使用 **OpenAI 兼容的 Chat Completions 视觉协议**。服务商、地址、API Key 与模型由用户配置，模型必须支持图片输入。

| 地址示例 | 请求路径 |
| --- | --- |
| `https://vision.example.invalid` | `/v1/chat/completions` |
| `https://vision.example.invalid/v1` | `/v1/chat/completions` |
| `https://vision.example.invalid/custom` | `/custom/chat/completions` |
| 以 `/chat/completions` 结尾的完整 HTTPS 地址 | 使用该地址 |

示例域名仅演示规则。地址不能包含账号、查询参数或片段。仅支持其他原生协议的服务需要适配器，请先使用内置图片测试验证兼容性。

图片修正方向并压缩后发送，PDF 先渲染为图片。Android 单个导入文件最多 50 MB，单份 PDF 最多 20 页。识别支持跨页续题检查，但复杂公式、跨栏、几何图与题目完整性仍需人工校对。任务支持重试、缓存成功结果并保护人工修改。接口调用可能产生服务费用。

## 题集、公式与导出

题库和题集支持文字、LaTeX、图片混排。推荐使用 `\( ... \)` 与 `\[ ... \]`，也兼容 `$...$` 与 `$$...$$`。Android 独立公式字段仅用于校对，需要导出的公式请写入题干。

题集可设置试卷标题、说明、考试时间和满分，并控制每题留白和题前分页。PDF 与 Word 按选题顺序导出正文、子题及插图；AI 解答不会自动加入练习文档。Word 公式目前以图片输出，实际 Word／WPS 可能重新分页。

## 备份与数据安全

卸载前通过“题库备份”或“我的 → 题库导入与导出”将完整题库 ZIP 保存到公共文件目录或云盘。重新安装后导入 ZIP，预览并确认恢复；识别接口需重新配置。

本地完整备份保留题目、原图、解答、自定义知识点、题集顺序与文档设置，不包含 API Key、接口配置或后台任务。手机本地完整备份与桌面交换 ZIP 使用各自对应的格式，请使用对应入口。详细规则见 [备份与恢复](docs/library-backup.md)。

题库保存在本机，应用卸载会删除其私有数据。Android API Key 使用 Keystore 加密；识别向配置的服务发送题目图片，解题发送题目内容及可用原图。请自行选择可信服务并保存备份。

## 开发与构建

仓库结构与兼容约定见 [同仓库开发说明](docs/PROJECT_STRUCTURE.md)，产品范围见 [PRODUCT.md](PRODUCT.md)，界面规范见 [DESIGN.md](DESIGN.md)。

```text
Matheca/
├─ app/          Android 源码、资源、数据库 schema 与测试
├─ desktop/      Windows 源码、打包脚本与测试
├─ gradle/       Android Gradle Wrapper
└─ docs/         当前使用说明与技术文档
```

Windows 使用 Node.js 24，在 `desktop/` 执行：

```powershell
npm ci
npm run verify
npm run make:portable
npm run test:portable
```

完整应用目录、ZIP 与校验文件输出到 `desktop/releases/v0.1.0/构建时间/`。发布验证使用独立测试数据，不操作正常题库。

Android 使用 Android Studio 打开根目录，安装 Android SDK 37，并使用内置 JBR。在根目录执行：

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:assembleDebugAndroidTest :app:lintDebug --console=plain
```

应用包输出到 `app/build/outputs/apk/debug/app-debug.apk`。Android 支持 API 26 及以上，compileSdk／targetSdk 为 37。产品版本名为 v0.1.0，内部 `versionCode` 为 29，数据库 schema 为 9；内部编号与迁移文件保留以支持覆盖安装和既有数据。

源码、测试、必要资源与第三方许可提交到 Git；安装包、缓存、本机配置、密钥、个人题库和测试数据不提交。KaTeX 许可保留在 [资源目录](app/src/main/assets/katex/LICENSE)，桌面第三方声明随完整发布包提供。

## 验证边界

当前构建已进行桌面类型检查与单元测试、Android 单元测试与 Lint，以及隔离数据下的界面、联动页签、筛选和大字体专项验证。模拟服务验证不代表真实服务商的识别准确率；真实网络环境、相机、不同 Android 厂商设备及 Word／WPS 打印效果仍需进一步验证。
