# 安装与更新程序源码

`installer/setup.nsi` 是 1.3.0 完整安装器模板，`update/FullUpdater.cs` 是全量更新器实现。版本号为 1.3.0，旧名称检测、文件校验、更新备份、失败回滚和手动恢复代码保留。

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
