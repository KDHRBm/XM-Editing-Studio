# 开发与构建

## 环境

- Node.js 22.12 或更高版本，建议 Node.js 24，使用配套 npm。
- 桌面运行与本地工具需要 Windows x64；Electron 与 JS 依赖版本由 `package-lock.json` 固定。
- 本地工具构建需要 Windows .NET Framework 4.x 的 C# 编译器，不再需要 Python、PyInstaller、OpenCV 或 NumPy。

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

只检查源码且无需启动 Electron 时，可用 `npm ci --ignore-scripts` 跳过 Electron 二进制下载；以后需要运行桌面版时执行 `node node_modules/electron/install.js`。

## 构建本地组件

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-native.ps1
node --test tests/test-native-jianying.mjs
```

构建输出包括 `.generated/native/helpers/PeriodKeeper.exe` 、`app/build/jianying/JianYingEngine.exe` 和 `app/build/watermark/WatermarkEngine.exe`。脚本生成并记录组件哈希，仅打包当前原生组件。C# 编译后的校验常量写入 `app/electron/period-helper-integrity.mjs`，构建变更不要混入无关 PR。

## 启动开发版

先退出正在运行的正式版，避免固定本地端口冲突，然后：

```powershell
npm start
```

开发版使用仓库内 `.local-profile` 保存独立配置，不读取正式账号会话。编辑界面后重新运行 `npm run build` 并重启。第一次使用仍需自己配置模型或登录官方网页，并选择本机目录。

## 构建可运行目录

完成前端与本地组件构建后：

```powershell
npm run package
```

输出在 `artifacts`，包括 Windows x64 Electron 运行环境和 ASAR 应用。此开发打包入口生成可运行目录，未进行发布版的混淆、签名或安装器压缩。安装器与全量更新器源码见 [打包说明](../packaging/README.md)。当前 npm 包标记 `private: true` 仅防止误发布 npm，不影响 GitHub 源码公开。

## 工程结构与现有限制

主界面以原编译壳 `app/baseline` 为基底，`app/scripts/build-upgrade.mjs` 将 `app/src/upgrade.jsx` 导出的组件接入。该脚本对替换位置进行断言；变更基底时应同步更新替换点，不能忽略断言。

源码来源、原界面工程缺失和第三方许可范围见 [SOURCE-PROVENANCE.md](SOURCE-PROVENANCE.md)。源码的公开与第三方许可是两回事。

1.4.1 的自动回归、原生协议测试、界面和安装验证见 [VERIFICATION.md](../VERIFICATION.md)。检查不执行真实剪映点击任务，不代表所有电脑、模型账号或显卡已实测。
