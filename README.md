# YTM 芯片资料库

面向手机的静态资料站，提供型号 / 文件名 / 版本搜索、系列与文档类型筛选、最新与历史版本、最近阅读，以及 PDF 连续滚动、树形目录、页码跳转、缩放和文档内全文搜索。20 份 PDF 原文件保存在 `RM/`（11 份参考手册）与 `DS/`（9 份数据手册）中，没有重新编码或复制。

## 本地试用

Windows 双击 **一键预览.bat**，保持窗口打开，在浏览器访问 **http://localhost:8000**。

手机与电脑连接同一 Wi-Fi，输入启动窗口显示的 `http://电脑局域网IP:8000` 地址。如果无法访问，检查 Wi-Fi 客户端隔离与 Windows 防火墙对 Python 的专用网络访问设置。这个预览需要电脑保持开机；正式部署后手机直接访问托管地址。

也可以手动运行（需要 Python 3）：

```sh
python tools/build_catalog.py
python tools/preview.py
```

端口占用时：`python tools/preview.py --port 8001`。Ctrl+C 停止预览。

双击 `index.html` 可以查看和搜索目录，但浏览器的 `file://` 安全限制会阻止 PDF.js 模块 / 文档加载，因此完整阅读请使用上述 HTTP 预览地址。也可点击“打开原文件”。

## 静态部署

把以下内容保持相同目录关系，上传到公司静态网站、Nginx、对象存储静态托管等服务：

```text
index.html
styles.css
app.js
reader.js
documents.js
RM/*.pdf
DS/*.pdf
vendor/pdfjs/（含子目录）
```

不需要 Node、数据库、业务接口或 Python 后端。`tools/preview.py` 仅用于本地预览，不需要部署。所有资源使用相对路径，支持部署在网站子目录。正式访问推荐 HTTPS，`.mjs` 需返回 JavaScript MIME 类型，PDF 建议支持 `Accept-Ranges: bytes` 与 `206 Partial Content`。所有资源同源，无需配置跨域或依赖 CDN。

资料若涉及保密，请使用公司授权的托管位置；静态站本身不提供用户认证。可访问站点的用户可以直接访问其中的 PDF。

## GitHub Pages 发布

工程已包含 `.github/workflows/pages.yml`，推送到 `main` 分支后自动重新生成目录并发布。手动发布可在 Actions 中运行 **Deploy documentation to GitHub Pages**。

1. 创建 GitHub 仓库（使用免费个人账号时选择 Public），将工程上传到 `main` 分支。保留 `.github/`、`tools/`、`vendor/`、`DS/` 和 `RM/` 的目录结构，不上传 `.preview/`。
2. 打开仓库 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**。
3. 打开 **Actions**，选择上述工作流，点击 **Run workflow**；以后推送 `main` 会自动更新。
4. 工作流成功后，访问 Pages 设置或部署任务给出的固定 HTTPS 地址，通常为 `https://用户名.github.io/仓库名/`。自定义域名另行配置。

发布的是可公开访问的资料站，访问者能查看、下载 PDF。当前所有网页资源使用相对路径，兼容仓库子路径部署，不需要填写仓库名或修改 PDF 地址。

工作流只发布网页、PDF 和阅读器依赖，预览脚本、测试截图和仓库文件不会进入站点。无需配置 Token、数据库或服务器。首次发布如提示 Pages 未启用，先完成第 2 步，再重新运行工作流。

本地检查发布产物（输出目录必须为空）：

```sh
python tools/build_site.py --output _site
```

## 更新资料

参考手册放到 `RM/`，数据手册放到 `DS/`，文件名使用 `YTM32B1MD1x_RM_v1.5.pdf` 或 `YTM32B1MD1x_DS_v1.10.pdf` 形式（也兼容 `_RM_1.0.pdf`），然后执行：

```sh
python tools/build_catalog.py
```

上传新的 PDF 和更新后的 `documents.js`。最新版本按同一型号、同一文档类型的数字版本号比较，DS 和 RM 独立判断；例如 1.10 高于 1.9。系列从型号中提取；当前为 HA、LE、MC、MD、ME。

## 阅读与存储

- 首页搜索仅检索目录信息，不搜索所有 PDF 的正文。
- 点击阅读才加载 PDF.js 与对应 PDF。所有页都可以连续滚动；仅绘制可视区域及其附近的页面，远处页面回收 Canvas 和文本层，保留页面位置。关闭后销毁文档与 worker。
- 目录使用“展开箭头 + 书签 + 章节名 + PDF 页码”，箭头控制展开，点击章节跳转。页码使用 PDF 文件内的物理页码，与上方跳页框一致。
- 阅读器点击搜索按钮或按 Ctrl/Cmd+F，搜索当前 PDF 正文。每处匹配单独列出一行短片段和页码，点击定位到具体词语。正文全部匹配显示黄色高亮，当前选中项显示橙色；缩放、离屏回收和重新绘制后恢复高亮。可区分大小写、停止搜索、继续加载结果列表。
- 首次正文搜索逐页提取文字，会触发读取整份 PDF 的文本数据并产生流量；进度和结果逐步显示。提取的文本仅缓存在当前打开文档的内存中，关闭释放，再次查询复用文本。扫描图片需要 OCR，当前不支持。
- 支持字节范围请求时按需请求 PDF 数据；实际传输量取决于 PDF 结构、阅读页面和托管服务，大纲及字体等也可能触发额外数据请求。不支持分段请求时可能下载完整文档。
- 不预下载全部资料、不提供离线缓存。浏览器仍可能缓存已读取的数据。最近阅读仅在 localStorage 保存最多 3 个文档编号，可在首页清空。
- 移动端采用 PDF.js 自行渲染，不依赖手机内嵌 PDF 插件；仍需在目标 iOS / 安卓设备上实测。现代 Chrome、Edge、Safari 为建议环境。
- 不提供跨多份文档的全文搜索、页面内链接跳转或批注编辑。PDF 自带书签可用于目录导航。

## 开源依赖

PDF.js 4.10.38（Mozilla，Apache-2.0），本地存放在 `vendor/pdfjs/`，包含兼容构建、Worker、CMaps、标准字体和文本层样式。许可证及第三方字体许可随依赖保留。
