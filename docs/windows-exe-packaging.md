# UniStudy Windows EXE 打包与内部试发布说明

更新时间: 2026-04-13  
适用仓库: `C:\VCP\Eric\VCPChatLite`

## 当前目标

当前 Windows 分发策略固定为两种产物:

- `NSIS` 安装包
- `portable exe` 绿色版

本轮只面向内部试打包与内部试用，不包含:

- 代码签名
- 自动更新
- 对外正式发布流程

## 打包命令

安装依赖后，使用以下命令:

- `npm run pack:win`
  生成目录版产物，主要用于本机快速试运行，输出目录为 `dist/win-unpacked`
- `npm run dist:win`
  生成 Windows 安装包与绿色版，输出目录为 `dist`

## 产物说明

### 1. 目录版

- 路径: `dist/win-unpacked`
- 用途: 本机快速验证主程序是否能在打包后启动
- 启动方式: 直接运行 `UniStudy.exe`

### 2. 安装包

- 目标类型: `NSIS`
- 用途: 内部测试人员安装使用
- 默认特性:
  - 提供安装向导
  - 创建开始菜单快捷方式
  - 可创建桌面快捷方式
  - 卸载应用时默认不会主动清理用户数据目录

### 3. 绿色版

- 目标类型: `portable`
- 用途: 在没有安装权限或只想快速试用时直接运行
- 启动方式: 双击绿色版 `exe`
- 建议: 放在独立目录中运行，不要直接放在源码仓库里使用

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
