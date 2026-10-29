# 安装与更新程序源码

## 1.4.2 C# + WebView2 安装与更新

先运行 `npm run package` 构建原生运行目录，再执行：

```powershell
node scripts/build-native-update.mjs <原生运行目录> <发布目录> <makensis.exe>
```

`update/native-setup.nsi` 将载荷解压到目标安装磁盘，并调用 `update/Install-Native.ps1`。更新器校验原版标记与文件清单，备份配置，离线导出旧 Electron 数据并在 WebView2 中核对，最后替换程序。支持 1.3.1 及以上原版直升；替换失败回滚。个人数据保存在安装目录 `data`。

实际安装器可在隔离目录使用 `/S /TEST /D=<测试安装目录>` 验证；`/TEST` 不改注册表或桌面快捷方式。脚本另有仅限测试的 `-LegacyProfile` 与 `-FailAfter` 参数。不要对生产目录执行故障注入。

详细迁移行为见 [C# 构建与升级说明](../docs/CSHARP-MIGRATION.md)。

## 历史 Electron 打包方式

`installer/setup.nsi` 是 1.3.1 完整安装器模板，版本由生成配置传入。`update/FullUpdater.cs` 保留历史 1.3.0 全量更新器实现，旧名称检测、文件校验、更新备份、失败回滚和手动恢复代码保留。

日常开发使用根目录 `npm run package` 先构建可运行目录。正式发布需从该目录生成受校验的安装清单，原始发布附件见 Releases。

## NSIS 模板输入

使用 Unicode NSIS 3.x。`setup.nsi` 同目录需要生成：

- `generated-config.nsh`：`APP_VERSION`、`APP_FILE_VERSION`、`OUTPUT_FILE`、`APP_ICON`、`INSTALLED_SIZE_KB`。
- `generated-install.nsh`：白名单内每个运行文件的 `SetOutPath` 与 `File`。
- `generated-uninstall.nsh`：对应文件的单文件删除指令。
- `generated-uninstall-dirs.nsh`：只移除空目录，禁止递归删除用户文件。

打包时只包括运行文件、组件和必要许可；不要收录开发目录、用户配置或备份。

## 全量更新器输入

`manifest.json` 结构为 `{ "product": "XM剪辑台", "version": "1.3.0", "files": [{ "name": "相对路径", "hash": "SHA-256", "bytes": 123 }] }`。程序文件放在同级 `payload/` 中。

生成 `FullManifestHash.cs`，内容为 `static class FullManifestHash { public const string Value = "manifest.json 的 SHA-256"; }`，与 `FullUpdater.cs` 一起编译。引用 `System.Web.Extensions.dll`、`System.Windows.Forms.dll`、`System.Drawing.dll`，目标为 `/target:winexe /platform:x64`。

正式构建不要定义 `UPDATE_TEST`；该编译标志仅启用故障注入检查。每次改动清单后必须重新生成哈希并编译。发布前在隔离目录验证旧版直升、重复升级、回退、文件占用、损坏数据与个人文件保留。
