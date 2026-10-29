# 完整桌宠组件

桌宠采用 MerZlin/dsh-pet-indesktop 的 v4.3.4 WebM Chat portable 版本（提交 5d56d29），保留其完整运行组件和 106 段 WebM。剪辑台内提供常用设置与动画预览，完整功能在原版设置窗口与右键菜单中使用。AI、语音、识屏及外部联动需要按原项目要求配置相应服务。

## 构建

1. 下载 https://github.com/MerZlin/dsh-pet-indesktop/releases/download/v4.3.4/dsh-pet-standalone-webm-chat-portable.zip 到 `.generated/pet-download/`。
2. 核对 SHA256：`333ea3ae7b319249ccb811157491252441d7a8b598e24557cfec61e14950cd64`。
3. 用 **Python 3.11** 执行 `scripts/build-companion.py`。原版使用 Python 3.11 字节码，不可用其他小版本编译入口。
4. 正常运行 `node scripts/build.mjs` 和 `node scripts/package.mjs`。打包步骤校验组件和全部动画，放入 `resources/companion`，不写入 ASAR。

脚本只替换 PyInstaller 的入口字节码并附加 `app/companion/xm_companion_bridge.py`；原版模块、解码器、动画和依赖资源保持完整。适配入口可由原 ZIP 重建，生成物不提交版本控制。组件约 860 MB，完整安装体积会随之增加。第三方许可保留在组件 `_internal/LICENSE` 与 `_internal/THIRD_PARTY_NOTICES.md`。

## 接入与隔离

- 配置位于当前 XM 用户数据目录内的 `desktop-pet`，不读写 fork 或独立桌宠的数据。
- 本地命令使用随机端口、每次启动独立令牌和会话标识，GUI 操作通过 Qt 队列在主线程执行。
- 原版开机自启入口指向所属 XM 程序；自启注册表值按配置路径隔离。
- 常规关闭主窗口保留托盘和桌宠；“彻底退出”关闭当前桌宠以及它的设置子进程。父进程异常退出也触发收尾。
- 原版预热、解码缓存、显示区域布局和拖动逻辑继续使用。预览页只播放选中动画，避免同时创建 106 个解码器。
- 剪辑台任务状态、快捷面板、自定义名字和隐藏名字通过适配层保留。

网络服务未配置时不保证 AI/语音等服务可用。上游组件升级由“桌宠设置 → 检查更新 → 下载并更新桌宠”完成；不要直接覆盖集成后的组件 EXE。


## 独立更新与快捷交互（本地修改）

- 右上角角色头像直接开启或显示桌宠；左侧“桌宠设置”继续进入设置页。双击桌宠角色打开 XM 功能卡，普通点击和拖动仍由上游处理。
- 双击消息通过随机本机端口及每会话令牌传回所属 XM 进程；没有公开的远程控制地址。
- 更新器只接受 MerZlin/dsh-pet-indesktop 正式版本中的 Windows WebM Chat portable ZIP，并校验 GitHub 资产 SHA256、大小及解压路径。
- GitHub 限流且当前低于 4.4.0 时，提供已验证 4.4.0 下载（明确标注在线检查不可用）；不会谎报后续版本已是最新。
- 更新安装在当前 XM 用户目录的 `companion-updates/runtime-*`。随安装包的组件仍作为恢复来源；用户配置保留在 `desktop-pet`。
- 使用随 XM 附带的 Python 3.11 组件准备上游包，验证入口兼容，附加 XM 桥接，再以临时配置试启动。未来上游改变 Python 版本或入口时明确报错，原版继续可用。
- 上游 4.4.0 仅携带 11 段基本动画，更新器保留已安装资源，实测升级后仍有 106 段。
- 激活前停止所属桌宠、备份配置并写事务记录；成功后原子切换组件路径。失败或中途退出会恢复旧组件与配置，迁移失败的配置也保留用于恢复。
- 上游的完整设置窗口继续可用；XM 集成组件应通过本页更新，避免独立安装器脱离 XM 的启动与配置管理。

验证记录：284 项测试通过，真实 4.3.4 → 4.4.0 更新及原版设置窗口通过；Qt 双击事件打开功能卡、右上角头像启动、原版端口占用后的页面加载通过。结果见 `.generated/qa141/pet-update-real-report.json` 与 `pet-interactions-report.json`。
