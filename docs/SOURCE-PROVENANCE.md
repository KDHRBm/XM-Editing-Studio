# 源码范围与来源

本仓库公开当前 1.3.0 功能实现，包含后来增加的三点省略号规则。源码按功能整理后用于阅读、构建与协作；目录变化不改变已发布安装包的内容。

## 可维护源文件

`app/src` 是新增及改造功能的 React 界面；`app/shared` 是字幕、音乐、剧本和队列逻辑；`app/electron` 与 `app/server` 提供桌面桥接和服务；`watermarker/src` 为水印工具；`app/native` 为本地 C# 和 Python 工具。安装与更新程序代码位于 `packaging`。

## 原界面基底

最初收到的软件是已编译的 Electron 程序。原始 React 工程没有提供，`app/baseline` 保存从原程序获得的 JS、CSS、HTML，构建脚本在此基础上接入当前源码。它不是原软件完整的未编译 React 源码；修改既有模型管理／聊天壳时需要了解基底替换点。

## 第三方集成

- Watermarker：https://github.com/Kirota233/watermarker ，基于提交 `83f569e3d4158808f4a2a901792e9c741b07de31`，详情见 `watermarker/UPSTREAM.md`。
- JianYing-Period-Keeper：https://github.com/Kirota233/JianYing-Period-Keeper ，基于提交 `c6552bcfe86573be72e442aa9af292ad1047972b`，标点与剪贴板行为适配为本地组件。
- JianYing-AI-Pro：用户提供的 2.1 版 `main.py`，原文件 SHA-256 为 `9a411111454eabd7e2fc84bf53efb636c243b5b14d58524d659dcbf42b453b2f`，提取无独立 GUI 的引擎并通过 Electron 复用连接。记录见 `app/native/jianying/source-provenance.json`。
- React、Electron、FFmpeg WASM、WebAV、图标、Python 与运行依赖分别遵循各自许可，见根目录和应用中的第三方说明。

上述部分集成项目在取得版本时未提供 LICENSE。此处保留来源记录，不为这些第三方文件另行授予 MIT、Apache 等授权。当前仓库公开源码用于查看和协作；未给整个混合来源工程指定统一开源许可证，公开可见不等于第三方许可限制消失。

## 发布记录

`v1.3.0` 是原始程序包发布标签，其自动 Source code 压缩包只包含当时的说明文档。`main` 和 `v1.3.0-source` 包含随后公开的源码。原安装包、全量更新 ZIP 及校验值保持不变。

个人配置、账号登录数据、API 密钥、用户媒体、内部日志及历史备份不属于源码交付范围。
