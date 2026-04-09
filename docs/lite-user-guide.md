# VCPChat Lite 使用说明

更新时间: 2026-04-09
适用仓库: `C:\VCP\Eric\VCPChatLite`

## 产品定位
VCPChat Lite 是从原 VCPChat 中拆出的独立 Electron 单聊客户端。

当前版本固定保留这些能力:
- 多助手单聊
- 多话题历史
- 高保真消息渲染
- 集中式附件存储
- 文本 Prompt 模式
- Lite 独立数据目录

## 当前源码结构
正式源码已统一迁入 `src/`。
当前主结构:
- `src/main/main.js`
- `src/renderer/index.html`
- `src/renderer/renderer.js`
- `src/renderer/style.css`
- `src/modules/main/`
- `src/modules/shared/`
- `src/modules/renderer/`
- `src/preloads/`
- `src/Promptmodules/`
- `src/styles/`
- `src/assets/`

根目录当前只保留长期入口、文档、脚本、数据目录和第三方资源:
- `package.json`
- `start.bat`
- `docs/`
- `scripts/`
- `tools/legacy/`
- `.tmp/`
- `AppData/`
- `.lite-regression-data/`
- `vendor/`

## 启动方式
常用启动方式:
- `npm start`
- `start.bat`

开发快捷键:
- `F5`
- `Ctrl+R`
- `Ctrl+Shift+R`
- `Ctrl+Shift+I`

## 数据目录策略
Lite 当前正式只使用自己的独立数据目录。
当前规则:
1. 若设置了环境变量 `VCPCHAT_DATA_ROOT`，优先使用该路径
2. 否则默认使用 `C:\VCP\Eric\VCPChatLite\AppData`
3. 不再自动读取或复制 `C:\VCP\Eric\VCPChat\AppData`

这意味着当前策略是:
- 默认独立运行
- 正式运行时只认 Lite 自己的数据
- 旧仓数据不再参与 Lite 运行
- `.lite-regression-data/` 仅用于隔离测试，不是正式数据根

兼容读取范围:
- `settings.json`
- agent 配置
- topic 列表
- `history.json`
- 附件与头像相关路径

## 页面说明
### 1. Agents
- 左侧上半区显示助手列表
- 支持搜索、选择、新建
- 当前版本只面向 agent 单聊，不显示 group 入口

### 2. Topics
- 左侧下半区显示当前 agent 的话题历史
- 支持:
  - 新建
  - 导出 markdown
  - 重命名
  - 删除
  - 锁定 / 解锁
  - 标记未读 / 已读

### 3. Chat
- 中间区域为消息区与输入区
- 支持流式增量渲染
- 支持中断请求
- 支持 markdown、代码高亮、图片、KaTeX、Mermaid、Pretext

### 4. Attachments
- 输入区支持:
  - 文件选择
  - 粘贴图片 / 文件
  - 拖拽文件
- 附件进入 composer 后会先走主进程集中存储
- 新历史记录保存的是中心化附件对象，不再依赖浏览器临时 URL

### 5. Settings
- 右侧设置区包含:
  - 全局连接设置
  - agent 基本资料
  - 模型参数
  - 文本 Prompt 编辑
  - 渲染相关设置
  - 主题切换

## 当前已支持能力
### 运行链边界
- `src/modules/main/vcpClient.js` 是唯一的 VCP transport / lifecycle client
- `src/modules/main/ipc/chatHandlers.js` 负责 IPC 边界与 Lite 请求预处理
- `src/modules/renderer/messageRenderer.js` 与 `src/modules/renderer/streamManager.js` 负责主聊天渲染链
- `src/modules/renderer/text-viewer.*` 与 `src/modules/renderer/image-viewer.*` 作为辅助 viewer 保留

### Topic 管理
- 话题切换
- 自动收敛已读状态
- 重命名 / 删除 / 锁定 / 未读切换

### 附件链路
- 集中式附件落盘
- history 稳定重读
- markdown 导出优先输出中心化路径

### Prompt
- 只显示单文本 Prompt 编辑器
- 兼容读取旧 agent 配置中的 modular / preset 字段
- 保存后统一写回:
  - `promptMode: "original"`
  - `originalSystemPrompt`
  - `systemPrompt`

### 导出
- 当前话题可导出为 markdown

## 已知限制
- 当前版本仅支持单聊，不包含群聊
- 不包含这些产品壳层能力:
  - RAG
  - Canvas
  - Notes
  - Translator
  - Memo
  - Assistant Bar / Selection Assistant
  - Desktop Remote
  - Flowlock
- 为兼容已迁入的测试数据，仍保留少量旧字段读取逻辑，但 Lite 页面不再暴露对应 UI
- 当前运行时不再依赖原 VCPChat 仓库的数据目录

## 可选联调用例
以下配置仅作为真实联通测试记录，不代表产品默认值:
- Chat Completions URL: `http://vcp.uniquest.us.kg/v1/chat/completions`
- API Key: `123456`
- 测试模型: `gemini-3.1-flash-lite-preview`
- 测试 agent: `Lite Real Test Nova`
- 测试 topic: `topic_real_message_test_1775682726542`
- 测试提示词: `我是{{Nova}}`

## 新建与确认交互更新
- Lite 当前不再依赖系统原生 `prompt`
- 以下入口已统一改为页内弹窗:
  - 新建 Agent
  - 新建话题
  - 话题重命名
  - 删除 Agent 确认
  - 删除话题确认
- 交互规则:
  - `Enter` 确认
  - `Esc` 取消
  - 空输入不会提交，会在弹窗内显示错误提示

## 文案与查看器说明
- Lite 当前用户可见界面继续以简体中文为准
- 为降低编码漂移风险，代码注释、内部日志和维护性说明优先使用英文
- 历史乱码 key / marker 仅在内部解析器中保留兼容，不再继续暴露到用户文案
- Lite 保留图片与文本 viewer 作为辅助窗口
- viewer 中不再提供旧壳层的 Notes 分享入口
