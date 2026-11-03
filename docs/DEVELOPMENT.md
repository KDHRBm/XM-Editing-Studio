# XM剪辑台 C# 原生轻量化架构与开发规范

本文档定义了 **XM剪辑台 (XM Editing Studio)** 的核心技术架构、红线约束与后续迭代开发规范。所有 Pull Request 与新功能开发均须严格遵守本规范。

---

## 一、 核心架构红线（严禁违反）

### 1. 严禁引入 Electron / Chromium / CEF / Node.js 桌面捆绑运行时
- **禁止**在 `package.json`、构建脚本或安装包中引入 `electron`、`@electron/packager`、`electron-builder`、`nw.js`、`cefsharp` 或任何捆绑独立 Chromium / Node.js 运行时的框架。
- **桌面宿主唯一方案**：桌面窗口、系统托盘、内嵌网页 AI 容器（DeepSeek / 豆包）、桌面宠物悬浮球与悬浮控制面板，必须统一由原生 C# 宿主 [`app/native/XMStudioHost.cs`](../app/native/XMStudioHost.cs)（编译产物 `小马剪辑台.exe`，约 `131 KB`）驱动，并复用 Windows 10/11 系统内置的 **Microsoft Edge WebView2 Runtime**（仅携带约 `790 KB` 的 `WebView2Loader.dll` 与托管互操作层，**零内核捆绑**）。

### 2. 严禁引入 Python / PyInstaller / OpenCV / 独立 FFmpeg 等重型外部依赖
- **禁止**引入 Python 脚本打包（如 PyInstaller）、OpenCV 运行时、独立 `ffmpeg.exe` 二进制或 WebAssembly 大体积多媒体包。
- **系统级能力与多媒体处理必须优先采用 Windows 原生 C# 实现**：
  - **剪映自动化、草稿解析与标点还原**：统一在 [`app/native/JianYingEngine.cs`](../app/native/JianYingEngine.cs) 及其分部类（[`JianYingScan.cs`](../app/native/JianYingScan.cs)、[`JianYingAutomation.cs`](../app/native/JianYingAutomation.cs)、[`JianYingPunctuation.cs`](../app/native/JianYingPunctuation.cs)、[`JianYingProgress.cs`](../app/native/JianYingProgress.cs)、[`JianYingDraftIO.cs`](../app/native/JianYingDraftIO.cs)）中通过 Win32 API、GDI+ 图像匹配与原生 JSON 流处理实现。
  - **视频批量水印硬件加速压制**：统一在 [`app/native/WatermarkEngine.cs`](../app/native/WatermarkEngine.cs) 中通过 Windows Media Foundation (`MFReadWrite` / `MFPlat` + GDI+) 原生硬件解码与编码实现。
  - **剪贴板标点保护**：统一在 [`app/native/PeriodKeeper.cs`](../app/native/PeriodKeeper.cs) 及宿主剪贴板服务中通过原生 Win32 剪贴板 API 实现。

### 3. 零外部 SDK 编译器要求与安装包体积红线
- **Windows 内置编译器直编**：所有 C# 代码必须兼容 Windows 系统自带的 `.NET Framework 4.x` 编译器（`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`，遵循 **C# 5 语法规范**），无需安装庞大的 Visual Studio 或 .NET SDK 即可通过 `npm run build:native` 一键秒级编译。
- **C# 5 语法注意事项**：
  - 使用 `string.Format(...)` 或字符串拼接，不使用 `$"{var}"` 字符串插值。
  - 先声明 `out` 变量再调用方法（如 `int x; int.TryParse(s, out x);`），不使用内联 `out int x`。
  - 不使用 C# 6+ 的 `?.` 空条件运算符、`nameof(...)` 或表达式体属性，保持 100% `csc.exe` 零警告通过。
- **体积红线**：
  - `JianYingEngine.exe` 控制在 `< 150 KB`（当前约 `111 KB`）。
  - `WatermarkEngine.exe` 控制在 `< 60 KB`（当前约 `25 KB`）。
  - `小马剪辑台.exe` (`XMStudioHost`) 控制在 `< 200 KB`（当前约 `131 KB`）。
  - 最终 NSIS 安装包 `XM-Editing-Studio-<version>-Windows-x64-Setup.exe` 总体积须保持在 **`< 2 MB`**（当前约 **`1.28 MB`**）。

---

## 二、 仓库目录结构与模块职责

```text
XM-Editing-Studio/
├── app/
│   ├── assets/                 # 应用图标与内置默认水印纹理
│   ├── baseline/               # 基础前端编译模板与静态基线
│   ├── electron/               # 纯 JS/MJS 跨端共享业务模块与单测宿主适配层（无 Electron 依赖）
│   ├── lib/webview2/           # WebView2 轻量加载器 DLL (~790 KB)
│   ├── native/                 # 核心 C# 原生源码（宿主、剪映引擎、水印引擎、标点保护）
│   │   ├── XMStudioHost.cs         # 原生桌面主窗口、月薪喵悬浮窗、本地 API 路由、WebView2 容器
│   │   ├── JianYingEngine.cs       # 剪映自动化主引擎与 JSON-RPC 调度
│   │   ├── JianYingScan.cs         # 剪映草稿窗口截图、AI 坐标契约校验与视觉锚点匹配
│   │   ├── JianYingAutomation.cs   # F8 坐标录制、窗口平移补偿与按钮局部图像模板匹配
│   │   ├── JianYingPunctuation.cs  # 剪映草稿 JSON 字幕标准标点 1:1 无损还原与事务回滚
│   │   ├── JianYingProgress.cs     # 扫描、录制、批量导出状态机与进度广播
│   │   ├── JianYingDraftIO.cs      # 剪映加密/明文草稿读写兼容层
│   │   ├── WatermarkEngine.cs      # Windows Media Foundation 硬件加速视频水印压制引擎
│   │   └── PeriodKeeper.cs         # 原生剪贴板标点保护工具
│   ├── public/                 # 前端静态资源与月薪喵动画素材
│   ├── scripts/                # 前端升级包构建脚本 (build-upgrade.mjs)
│   ├── server/                 # 开发态与单测 API 插件模拟层
│   ├── shared/                 # 剧本解析、多语种台词提纯、跑量剪辑流、曲库匹配核心纯函数
│   └── src/                    # 前端界面组件 (TSX/JSX + WebView2 通信桥 webview2-bridge.ts)
├── docs/
│   └── DEVELOPMENT.md          # 架构红线与开发规范文档（本文档）
├── packaging/installer/        # NSIS 安装包脚本与使用说明
├── scripts/                    # 统一构建、测试、打包与发布脚本
│   ├── build-native.ps1        # 调用系统 csc.exe 编译四大 C# 原生二进制
│   ├── build.mjs               # 使用 esbuild 打包前端 UI 与 WebView2 桥接层
│   ├── test.mjs                # 全量自动化单元测试与 C# 原生集成测试入口
│   ├── package.mjs             # 组装原生 WebView2 绿色运行目录
│   ├── build-release.ps1       # 生成 NSIS 安装包与 SHA256SUMS.txt
│   └── start.mjs               # 本地一键打包并启动原生《小马剪辑台.exe》
└── tests/                      # 230+ 项 Node.js 与 C# 自动化回归测试
```

---

## 三、 前后端通信与扩展规范

1. **前端到 C# 宿主通信**：
   - 前端统一通过 [`app/src/webview2-bridge.ts`](../app/src/webview2-bridge.ts) 暴露的 `window.blackObsidian` 接口与 C# 宿主交互。
   - 底层通过 `window.chrome.webview.postMessage` 发送 JSON 消息（`{ id, type: "invoke", channel, payload }`），由 [`XMStudioHost.cs`](../app/native/XMStudioHost.cs) 中的 `HandleIpcInvoke` 路由分发并返回异步结果。
2. **新增桌面系统能力时的开发顺序**：
   - **第一步**：在 `app/native/` 下使用原生 C# 实现核心系统调用或文件处理逻辑，确保无外部重型依赖。
   - **第二步**：在 `XMStudioHost.cs` 的 `HandleIpcInvoke` 或本地 HTTP 服务中添加对应通道。
   - **第三步**：在 `app/src/webview2-bridge.ts` 中绑定前端调用接口。
   - **第四步**：在 `tests/` 中补充对应的 C# 原生测试或 Node.js 集成测试。

---

## 四、 本地构建、测试与 PR 准入清单

### 常用命令
```powershell
# 1. 安装轻量前端构建依赖（仅 React 图标与 esbuild，无 Electron）
npm install

# 2. 编译全部 C# 原生程序 (PeriodKeeper / JianYingEngine / WatermarkEngine / 小马剪辑台.exe)
npm run build:native

# 3. 构建前端 Bundle 与悬浮窗面板
npm run build

# 4. 运行全量自动化测试（必须 100% 通过）
npm test

# 5. 组装原生运行目录并启动桌面端
npm start
```

### Pull Request 准入检查清单
- [ ] **未引入任何 Electron / Chromium / Python / FFmpeg 等重型依赖**，`package.json` 保持极简。
- [ ] 所有 C# 代码通过系统 `csc.exe`（`npm run build:native`）零报错编译。
- [ ] 运行 `npm run build` 与 `npm test` 全部测试项 100% 通过。
- [ ] 文件重命名、剪映草稿写入、标点还原等涉及用户文件的操作具备 SHA-256 校验与备份回滚保护。
- [ ] 未提交任何生成目录（`artifacts/`、`app/build/`、`app/dist/`、`.generated/`、`node_modules/`）或个人密钥。
