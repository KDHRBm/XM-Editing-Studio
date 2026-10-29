# C# + WebView2 构建与升级

1.4.2 使用 C# 主程序承载既有界面，WebView2 通过私有 `https://xm.local` 地址读取本地资源。主界面不再启动 HTTP 服务；外部 Chrome/Edge 水印功能按需开启本机素材传输服务。

完整桌宠仍使用独立的原版 Python/Qt 插件，保留全部功能及 106 个动画。它不是 C# 重写的部分。旧 Electron 目录保留为开发参考和一次性数据迁移用途，不进入新版主程序运行目录。

## 构建

1. 安装 Node.js 22.12+，运行 `npm ci`。
2. 按 [桌宠构建说明](COMPANION-INTEGRATION.md) 准备插件。
3. 运行 `npm run package`，默认输出 `artifacts/XM剪辑台-csharp-win32-x64`；也可运行 `scripts/build-native-host.ps1 -OutputDirectory <输出目录>`。
4. 运行 `node scripts/build-native-update.mjs <程序目录> <发布目录> <makensis.exe>` 构建支持旧版迁移的安装更新包。

WebView2 SDK 从 Microsoft NuGet 下载并核验固定 SHA-256。运行时使用系统安装的 Microsoft Edge WebView2。

## 数据路径

默认路径为 `<安装目录>/data`。WebView2、桌宠、任务、更新下载和本程序启动的子进程临时数据均使用该目录。开发及测试可显式指定 `XM_NATIVE_USER_DATA_DIR`，该变量仅影响当前进程及子进程。

软件内更新下载到 `data/updates`，安装前创建 `<安装目录>/.xiaoma-update-launch` 下的校验副本，避免运行中的安装器锁住待迁移的数据目录。安装器解压也使用安装磁盘。

原用户指定的音乐库、导出文件夹继续沿用，不把素材文件当作缓存搬动。操作系统管理的运行时、安装插件临时文件和诊断记录不受应用数据目录控制。

## 1.3.1 直接升级

更新程序验证原版安装标记、拒绝 fork 目录并检查运行中的进程。旧配置首先复制到安装磁盘的备份目录；仅在复制出来的旧版运行时中执行离线导出程序，然后导入独立 WebView2 profile，逐条核对 localStorage 和 IndexedDB。

导出使用包内固定迁移脚本，不启动旧软件业务，不访问模型接口。迁移校验完成后才替换已知程序文件；失败时保留旧程序，文件替换失败会回滚。备份位于 `.xiaoma-update-backups`，新配置位于 `data`。原 C 盘数据不删除，网页登录需在新 WebView2 中重新完成。

安装目录需要可写。无法写入时报告错误，不自动回退到 C 盘。原版与 fork 不应共享数据目录。

## 验证范围

自动检查覆盖编码、数据迁移、截图范围、进度、中断、改名、标点、任务队列及更新逻辑。实际 WebView2 验证界面、缩放、媒体播放与隔离导入。真实付费生成、用户账号验证码及真实剪映导出不作为无人值守测试执行。
