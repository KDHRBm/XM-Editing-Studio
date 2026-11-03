# 参与 XM剪辑台开发

欢迎改进字幕规则、跑量剪辑流、音乐检索、AI 适配、主题、剪映自动化工具和使用说明。

> **重要架构约束**：在开始开发前，请务必阅读 [《XM剪辑台 C# 原生轻量化架构与开发规范》](docs/DEVELOPMENT.md)。本项目**严禁引入 Electron、Chromium、Python 或独立 FFmpeg 等重型运行时**，桌面宿主与系统底层能力一律优先使用 Windows 原生 C# 构建，保持 `~1.3 MB` 超轻量安装包体积。

## 提交代码

1. 点击 Fork 创建自己的仓库副本，克隆到本机。
2. 阅读 [架构与开发规范](docs/DEVELOPMENT.md)，运行 `npm install` 安装轻量构建依赖，并从 `main` 创建功能分支。
3. 修改对应模块；涉及系统能力、剪映自动化或视频处理的功能优先在 `app/native/*.cs` 中以原生 C# 实现，并补充自动化测试。
4. 运行 `npm run build:native`、`npm run build` 和 `npm test`，确保编译零警告且测试 100% 通过。
5. 向主仓库 `main` 提交 Pull Request，说明问题、修改后的行为及验证结果。

## 范围与约定

- **坚持原生轻量化**：不引入 Electron / Chromium / Python 等重型依赖；C# 源码须兼容 Windows 内置 `.NET Framework 4.x (csc.exe)` 直接编译。
- **测试完备性**：一个 PR 尽量解决一个明确问题；模型测试使用模拟接口，避免测试消耗真实额度。
- **用户数据安全**：文件改名、更新、草稿修改、标点还原与卸载需保留 SHA-256 校验、备份／回滚及用户文件保护。
- **仓库整洁**：不提交 API 密钥、账号 Cookie、个人剧本、音乐、视频、用户目录和运行日志；不提交 `node_modules`、`artifacts`、`app/build`、`app/dist`、`.generated` 或 `.local-profile`。
- **开源合规**：保留第三方署名与许可信息；不要为其他作者的代码擅自更换许可证。

## 反馈问题

在 Issues 中提供软件版本、Windows 版本、复现步骤、预期与实际结果。粘贴文本和日志前请移除个人信息与密钥。
