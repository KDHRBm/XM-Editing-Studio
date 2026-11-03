# XM剪辑台 (v1.7.5)

**把剧本、跑量剪辑流、字幕、音乐、样片水印与剪映自动化放进同一个 C# 原生超轻量工作台。**

[下载最新安装包](https://github.com/Kirota233/XM-Editing-Studio/releases/latest) · [更新日志](CHANGELOG.md) · [架构与开发规范](docs/DEVELOPMENT.md) · [参与开发](CONTRIBUTING.md)

---

## 核心特性

- **1.28 MB 纯 C# 原生 + WebView2 超轻量宿主**：彻底摒弃臃肿的 Electron / Chromium 内核与 Python 运行时，采用原生 C# 桌面宿主（`XMStudioHost`，约 `131 KB`）搭配系统内置 Edge WebView2，毫秒级冷启动，内存占用极低。
- **多语种台词提纯与跑量剪辑流**：支持识别 `[EN]` 英文、`[ES]` 西语（含无标记西语原文智能分离）及中文角色台词；支持最多 5 部剧目独立归档、20 集分页卡片管理、采用音乐历史统计与批量分析。
- **AI 剧本分析与配乐**：支持 Gemini / OpenAI / Anthropic 兼容 API 与内置 **DeepSeek / 豆包官方网页版**（免 API Key 登录即用，支持原生 CDP 真实回车发送与光标恢复），支持整篇或按剧情分段匹配本地曲库、生成 Suno 音乐提示词。
- **剪映自动化中心与桌面悬浮窗（月薪喵）**：
  - 基于 **111 KB 原生 C# 引擎 (`JianYingEngine.exe`)**，支持 GDI+ 原生分层动画悬浮球与毛玻璃控制面板。
  - **01 批量导出**：支持 `F8` 坐标录制（含窗口平移自动补偿与按钮局部图像模板匹配校准）、`F10` 紧急中断、仅截取剪映窗口的 AI 草稿扫描识别与双导出模式自动匹配坐标。
  - **02 字幕工程**：支持一键提取全套 SRT 字幕、隐藏/取消隐藏草稿字幕轨道，以及原生 C# 实现的**「检查并还原标准标点」**（将草稿 JSON 中的受保护标点 1:1 无损还原为标准 `.` 与 `,`，保留剪映花字样式与时间轴，内置 SHA-256 校验与自动备份）。
  - **03 批量改名**：支持按集数模板正则重命名与 AI 智能重命名预览。
  - **04 样片水印**：基于 **25 KB 原生 C# Windows Media Foundation 硬件加速引擎 (`WatermarkEngine.exe`)**，零 FFmpeg 依赖即可高速批量压制防盗样片水印。

---

## 本地最小化开发与运行

本项目严禁引入 Electron / Chromium / Python / PyInstaller 等重型依赖（详见 [《C# 原生轻量化架构与开发规范》](docs/DEVELOPMENT.md)），所有原生组件均使用 Windows 内置 `.NET Framework 4.x (csc.exe)` 直接编译：

```powershell
# 1. 安装轻量前端构建依赖
npm install

# 2. 编译 C# 原生组件 (PeriodKeeper / JianYingEngine / WatermarkEngine / 小马剪辑台.exe) 与前端资源
npm run build:native
npm run build

# 3. 运行全量单元测试与 C# 原生集成测试
npm test

# 4. 打包并启动本地原生桌面端
npm start
```

> **自动化构建与发版**：安装包（`XM-Editing-Studio-<version>-Windows-x64-Setup.exe`，约 `1.28 MB`）由 GitHub Actions (`.github/workflows/release.yml`) 自动编译、测试、NSIS 打包并发布至 GitHub Releases。
