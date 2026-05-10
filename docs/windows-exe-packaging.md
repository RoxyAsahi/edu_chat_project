# UniStudy Windows EXE 打包与内部试发布说明

更新时间: 2026-05-10  
适用仓库: `C:\VCP\Eric\edu_chat_project`

## 当前目标

当前 Windows 分发策略固定为两类产物:

- `NSIS` 安装包
- `portable exe` 绿色版

正式给评委或同学运行时，优先使用 `NSIS` 安装包。不要把安装包作为源码仓库文件或 Source ZIP 里的可运行入口交付；源码交付也不需要包含 `.git` 目录。

本轮已包含:

- `electron-updater`
- `generic` 静态更新源
- 设置页里的检查、下载、重启安装入口

本轮不包含:

- 代码签名
- 自动上传发布产物到服务器

## 打包命令

安装依赖后，使用以下命令:

- `npm run pack:win`
  生成目录版产物，主要用于本机快速试运行，输出目录为 `dist/win-unpacked`
- `npm run dist:win`
  生成 Windows 安装包与绿色版，输出目录为 `dist`
- `npm run dist:win:update`
  只生成支持自动更新的 `NSIS` 安装包，输出目录为 `dist`

## 产物说明

### 1. 目录版

- 路径: `dist/win-unpacked`
- 用途: 本机快速验证主程序是否能在打包后启动
- 启动方式: 直接运行 `UniStudy.exe`

### 2. 安装包

- 目标类型: `NSIS`
- 用途: 评委或测试人员安装使用
- 发布方式: 上传到自己的 HTTPS 静态更新源，例如宝塔面板网站目录
- 默认特性:
  - 提供安装向导
  - 创建开始菜单快捷方式
  - 可创建桌面快捷方式
  - 卸载应用时默认不会主动清理用户数据目录
  - 支持设置页手动检查并下载更新

### 3. 绿色版

- 目标类型: `portable`
- 用途: 在没有安装权限或只想快速试用时直接运行
- 启动方式: 双击绿色版 `exe`
- 建议: 放在独立目录中运行，不要直接放在源码仓库里使用
- 更新: 绿色版不走自动更新，请手动下载新版

## 自动更新源配置

当前 `package.json` 中的 `build.publish` 使用 `generic` provider:

- 默认占位地址: `https://your-domain.example/unistudy/win`
- 正式发布前把它改成你的宝塔面板 HTTPS 目录，例如 `https://你的域名/unistudy/win`
- 安装版会读取打包时生成的 `app-update.yml`，之后从这个 URL 拉取 `latest.yml`

每次发布新版时:

- 修改 `package.json` 的 `version`
- 执行 `npm run dist:win:update`
- 打开 `dist/latest.yml`，确认里面的 `path` 指向本次生成的安装包文件名
- 上传 `dist/latest.yml`
- 上传 `latest.yml` 里引用的安装包 `exe`
- 上传同名 `.blockmap` 文件
- 在浏览器确认 `https://你的域名/unistudy/win/latest.yml` 能直接访问

宝塔面板建议:

- 新建一个站点或子目录，例如 `/www/wwwroot/你的域名/unistudy/win`
- 开启 HTTPS
- 不要开启需要登录、鉴权或防盗链的访问限制
- 保持 `latest.yml`、安装包和 `.blockmap` 在同一个目录

客户端限制:

- 开发环境不会连接更新源
- `portable` 绿色版不会自动更新
- `NSIS` 安装版才会执行下载和重启安装

## 首次运行前需要配置的服务项

打包后的 `exe` 仍然是 Electron 客户端壳，首次使用前需要在设置页配置以下内容:

- `vcpServerUrl`
- `vcpApiKey`
- `kbBaseUrl`
- `kbApiKey`

说明:

- 如果未配置 `vcpServerUrl` / `vcpApiKey`，聊天能力无法正常请求模型服务
- 如果未配置 `kbBaseUrl` / `kbApiKey`，Source 检索与向量相关能力将不可用或退化

## 数据目录策略

- 默认数据目录使用 Electron `app.getPath('userData')` 下的 UniStudy 名字空间
- 如需复用指定目录，可设置环境变量 `UNISTUDY_DATA_ROOT`
- 用户设置、Agent、Topic、历史记录、附件、头像等运行数据都应落在数据目录，不依赖源码仓库路径

## 当前联网依赖说明

当前版本允许联网，且 viewer 能力仍包含外部资源依赖，因此当前版本不承诺离线模式:

- 文本 viewer 仍依赖 `app.diagrams.net` / `viewer.diagrams.net`
- 图片 viewer 与 Python 沙箱相关能力仍依赖 `cdn.jsdelivr.net`
- 聊天与知识库能力依赖用户配置的外部服务地址

如果后续要做正式发布或离线交付，需要继续补:

- viewer 外部依赖本地化
- 服务配置向导与错误提示增强
- 打包后 smoke 自动化
- 代码签名

## 内部试打包建议回归项

执行 `npm run pack:win` 或 `npm run dist:win` 后，建议至少验证以下项目:

- 主窗口能正常启动
- 设置保存后重启仍能读取
- 聊天请求能成功发出
- Source 可导入 `TXT / PDF / DOCX`
- Notes 可保存
- 图片 viewer / 文本 viewer 可打开
- Markdown 导出可成功写出
- PDF 转图片、GIF 处理、附件读取不报错

## 已知边界

- 当前只支持 Windows 分发，不包含 macOS / Linux
- 当前打包配置只覆盖 `x64`
- 当前版本适合内部试用，不适合直接作为正式对外发布包
