# UniStudy 当前开发状态

更新时间: 2026-04-13
仓库路径: `C:\VCP\Eric\VCPChatLite`

## 当前结论
UniStudy 当前已完成运行时身份收口，并继续向“个人 AI 学习终端”演进。

当前正式边界如下:
- 保留多学科入口、多话题历史、高保真渲染
- 保留流式请求、中断、Markdown 导出、附件集中存储、图片 / 文本 viewer
- 新增 Source 面板、Notes 面板、消息收藏与学习工具入口
- Prompt 在当前版本中固定为单文本模式
- 正式运行时默认使用 Electron `app.getPath('userData')` 下的 UniStudy 数据目录
- 应用级显式 override 统一使用 `UNISTUDY_DATA_ROOT`

## 当前架构边界
### 主运行链
- `src/main/main.js`: Electron 启动、窗口装配、主进程 handler 注册
- `src/preloads/lite.js`: preload 暴露面
- `src/renderer/index.html`: 主页面入口
- `src/renderer/renderer.js`: UniStudy renderer 壳层与页面交互

### 模块归属
- `src/modules/main/`: 主进程专属模块
- `src/modules/shared/`: 真正跨运行时共享的对象
- `src/modules/renderer/`: renderer / viewer / 渲染辅助模块

## 本轮已落地
### 品牌与布局
- UI 主品牌已切换为 `UniStudy`
- 顶部导航显示当前学科与当前话题
- 右侧功能区已调整为 `Source / Notes / 设置` 三标签结构

### Source
- 继续复用现有 knowledge base 底层实现
- 用户侧主文案已切换为 `Source`
- 当前话题可独立绑定来源资料
- 资料上传上限已增加软限制，默认 50 个

### Notes
- 新增笔记持久化存储与主进程 IPC
- 支持当前 Topic 笔记列表
- 支持当前 Agent 聚合笔记视图
- 支持从聊天气泡收藏并生成笔记
- 支持笔记深度分析、选择题、闪卡生成

### 聊天
- 保留现有消息渲染与流式主链
- 消息对象新增收藏与笔记引用元数据
- 气泡区新增学习操作按钮

## 仍待继续深化
- Source 底层字段仍保留 `knowledgeBaseId` 兼容命名
- Notes 当前未实现富文本编辑器
- 学习工具当前仅生成 Markdown 结果，不包含专项练习工作流
- 资料型生成仍以“选中笔记优先、Source 回退”为主，不是独立题库系统
