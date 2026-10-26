# 样片水印模块

此目录保存内嵌水印页面的源码，基于 [Kirota233/watermarker](https://github.com/Kirota233/watermarker) 改造，来源见 [UPSTREAM.md](UPSTREAM.md)。

新增批量任务、中断与结果管理、自定义水印、视频参数、WebAV／FFmpeg 引擎选择、主题同步，以及由桌面程序带入文件的浏览器会话支持。

在仓库根目录执行 `npm ci`、`npm run build`。依赖统一由根目录管理，FFmpeg WASM 与 worker 在构建时从锁定的 npm 包复制到 `public`，无需把大型运行文件提交到 Git。
