# 开发与构建

## 环境

- Node.js 22.12 或更高版本，建议 Node.js 24，使用配套 npm。
- 桌面运行与本地工具需要 Windows x64、.NET Framework 4.8 与 Microsoft Edge WebView2 运行时；构建依赖由 `package-lock.json` 固定。
- 主程序与本地工具使用 Windows .NET Framework C# 编译器。完整桌宠独立使用 Python/Qt 组件，准备步骤见 [桌宠集成说明](COMPANION-INTEGRATION.md)。

从仓库根目录操作。不要在已安装的正式软件目录中开发。

## 安装依赖、检查与构建前端

```powershell
git clone https://github.com/KDHRBm/XM-Editing-Studio.git
cd XM-Editing-Studio
npm ci
npm test
npm run build
```

`npm test` 使用本地模拟接口与隔离临时目录，不需要真实 API；`npm run build` 构建主界面和水印页面，并从 npm 依赖复制本地 FFmpeg WASM。输出位于 `app/dist/client`。

只检查源码且无需启动 Electron 时，可用 `npm ci --ignore-scripts` 跳过 Electron 二进制下载；以后需要运行旧版迁移测试时执行 `node node_modules/electron/install.js`。

## 构建本地组件

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-native.ps1
node --test tests/test-native-jianying.mjs
```

构建输出包括 `.generated/native/helpers/PeriodKeeper.exe` 、`app/build/jianying/JianYingEngine.exe` 和 `app/build/watermark/WatermarkEngine.exe`。脚本生成并记录组件哈希，仅打包当前原生组件。C# 编译后的校验常量写入 `app/electron/period-helper-integrity.mjs`，构建变更不要混入无关 PR。

## 启动开发版

启动独立开发配置的 C# 主程序：

```powershell
npm start
```

开发版使用仓库内 `.local-profile` 保存独立配置，不读取正式账号会话。编辑界面后重新运行 `npm run build` 并重启。第一次使用仍需自己配置模型或登录官方网页，并选择本机目录。

## 构建可运行目录

完成前端与本地组件构建后：

```powershell
npm run package
```

输出在 `artifacts/XM剪辑台-csharp-win32-x64`，包括 C# 宿主、WebView2 SDK、本地页面、工具与桌宠组件，不包含常驻 Electron/Node 运行环境。需要系统 WebView2 运行时。原生安装更新包的构建与迁移步骤见 [C# 构建说明](CSHARP-MIGRATION.md)。当前 npm 包标记 `private: true` 仅防止误发布 npm，不影响 GitHub 源码公开。

## 工程结构与现有限制

主界面以原编译壳 `app/baseline` 为基底，`app/scripts/build-upgrade.mjs` 将 `app/src/upgrade.jsx` 导出的组件接入。该脚本对替换位置进行断言；变更基底时应同步更新替换点，不能忽略断言。

源码来源、原界面工程缺失和第三方许可范围见 [SOURCE-PROVENANCE.md](SOURCE-PROVENANCE.md)。源码的公开与第三方许可是两回事。

1.4.2 的自动回归、原生协议测试、界面和安装验证见 [VERIFICATION.md](../VERIFICATION.md)。检查不执行真实剪映点击任务，不代表所有电脑、模型账号或显卡已实测。
