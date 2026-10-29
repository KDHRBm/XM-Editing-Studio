# 1.3.1 本地选择性移植

> 历史开发记录：文中的本地路径、发布状态和测试结果描述当时修订。当前 1.4.2 的发布范围与验证请见根目录 CHANGELOG-1.4.2.md、VERIFICATION.md。

日期：2026-10-26。

来源：https://github.com/Kirota233/XM-Editing-Studio ，参考提交 `ef128a89c63c5f79d1f819ab87800add79748ec4`。在本地 1.3.1（`2890cd6`）上移植增量，尚未上传或发布。

## 已吸收的改进

- DeepSeek / 豆包官网回答容器识别，排除思考内容、输入模板和用户消息；等待思考及流式输出结束。
- 回车发送补充字符事件，保留单次发送、官网域名检查及登录隔离。
- 识别代码块、嵌套 result、明确类型的结果数组、情节或分集内部的任务标识，以及标识两端空白。
- 对 JSON 尾随逗号做字符串边界检查，避免更改正文中的 `,]`、`,}` 和引号。
- 只接收完整回答；前置说明的未闭合引号不干扰 JSON。所有显式任务标识必须匹配，不能用子对象绕过外层冲突。
- 分段行号接受整数字符串，可略过纯空白行；正文漏行、重叠、越界仍报错。

## 保留与取舍

保留 1.3.1 的联合分集分析、单一连贯情节、各段推荐复核、历史音乐与所有界面功能。移植未改变版本号、安装器或线上附件。

未引入 fork 的自动发布、清空输出目录和打包覆盖脚本；正式包继续沿用现有构建及完整性校验。思考状态使用明确的活动标记，避免将 `not-streaming` 一类已完成状态误判为仍在输出。

## 验证方法

新增 `tests/test-web-response-compat.mjs`，覆盖实际发现的解析回归、冲突任务标识、截断回答、原文标点保真、分集入口、空白行和网页 DOM 状态；`tests/test-web-ai.mjs` 验证回车发送序列及可见官网限制。

测试使用合成剧本、本地模拟页面和接口，不调用真实模型，不消耗 API 额度；官网真实登录会话仍需实际使用验证。

## 本次验证结果

- 66 项针对性检查、全部 211 项 JavaScript 回归检查通过。
- 主界面与水印页面构建成功，134 个构建输入文件与本地工作副本同步校验一致。
- 受保护程序归档内 66 个文件逐项校验通过，原生标点组件哈希匹配。
- 构建目录与更新后的本机安装目录分别使用隔离配置完成启动：主窗口加载成功，本地页面和前端脚本返回正常。
- 本机更新前完成备份，替换后哈希匹配；75 个非更新文件校验保持不变。
- 本次未创建安装包、未提交或推送 Git，也未更改 GitHub 发布附件。


## 2026-10-28 并存启动修复（未上传）

现场发现 fork 的 37652 端口被遗留 Node 预览服务占用，已核验命令后结束该预览进程。两版启动层增加端口占用回退：后端使用系统分配端口，仅在各自 Electron session 中转发原始本机来源。原版 37651、fork 37652 的页面地址不变，localStorage 和 IndexedDB 不迁移、不串用。HTTP POST 和音视频 Range 响应保留。外部网站不走本机转发。

fork 的二次启动同时执行 restore/show/focus，解决窗口隐藏后再次启动没有反应。保留独立 app name、AppUserModelID、用户目录和 `sideBySide` 更新保护。原版安装器额外拒绝带 fork 标记或 fork EXE 的目录，后续打包继续遵守。共享剪映进程的标点守护互斥仍保留，避免两端同时修改同一剪映进程。

`scripts/prepare-fork-coexistence.mjs FORK_INSTALL STAGING_OUTPUT` 可为已隔离 fork 生成可检查的 app.asar 与匹配完整性签名的 EXE，不直接覆盖安装。新 fork 启动结构不匹配时需重新检查，不自动套用旧补丁。

已在独立配置中模拟端口占用并验证 fork 启动、原版同时可访问、历史来源固定、隐藏后再次启动恢复。报告 `.generated/qa141/fork-coexist-report.json`。本机 fork 替换文件仅 EXE 与 app.asar，并存备份路径记录在 `fork-local-update-report.json`。

## 2026-10-28 fork 1.6.3 原生版安装与托盘同步（未上传）

用户提供的 `XM-Editing-Studio-1.6.3-Windows-x64-Setup.exe` 已核对官方 SHA256：`691ce64805932d7eb1cd9d03bb11bbfcd09bbb1c46d4c27553c37d49d5252cec`。1.6.3 使用 C# / WebView2，不再使用 Electron；上述 `prepare-fork-coexistence.mjs` 不能直接用于该版本。

提取官方载荷后，以同版本宿主源码适配并存：独立 EXE、AppUserModelID、用户配置、互斥量与唤醒事件、37652 端口、托盘名称、快捷方式及卸载登记。通用上游安装器会使用原版登记，因此保留检查和下载，阻止直接运行尚未适配的通用安装器。后续原生 fork 升级仍需检查安装隔离。

原版安装在 `D:\小马剪辑台`，登记项为 `XiaomaEditingStudio`；fork 安装在 `D:\XM剪辑台-Fork`，登记项为 `XMEditingStudioKirotaFork`，用户目录为 `%APPDATA%\xm-editing-studio-kirota-fork`。原版配置和数据不受影响。

16:44 安装完成，34 个载荷文件哈希一致。旧程序与用户配置备份在 `D:\XM剪辑台-Fork\.xm-version-backups\1.5.1-to-1.6.3-20261028-164413`。旧 Electron localStorage 导入新 WebView2 时只补缺失键，首次完成后记录迁移标记；账号 Cookie 不迁移，可能需要重新登录。隔离实例验证原生窗口加载、v1.6.3 界面和迁移成功，无 UI 或启动错误。安装报告 `.generated/fork163/install-report.json`，原生验证报告 `.generated/fork163/native-qa-report.json`；私有配置导出不得发布。

原版托盘同步 fork 的功能分组，补齐水印、剪映工作台、文案配乐、句号守护和版本检查入口，保留桌宠自定义名称与彻底退出。284 项测试与实际 Electron 页面导航验证通过。16:50 完成本机 EXE/ASAR 替换并校验哈希，备份 `D:\小马剪辑台\.xiaoma-update-backups\1.4.1-pet-updater-20261028-165025`。本轮仅本地更新，没有上传 GitHub。
