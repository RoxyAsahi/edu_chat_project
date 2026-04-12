# UniStudy 使用说明

更新时间: 2026-04-13
适用仓库: `C:\VCP\Eric\VCPChatLite`

## 产品定位
UniStudy 是面向个人学习场景持续演进的 AI 学习终端。

当前版本固定保留这些能力:
- 多学科入口
- 多话题历史
- 高保真消息渲染
- Source 资料绑定与检索
- Notes 笔记沉淀
- 集中式附件存储
- 文本 Prompt 模式
- UniStudy 独立运行时数据目录

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
当前版本正式运行时默认使用 Electron `app.getPath('userData')` 作为数据根，并落在 UniStudy 名字空间。
如需显式覆盖应用级数据目录，只使用 `UNISTUDY_DATA_ROOT`。

数据目录包含:
- `settings.json`
- agent 配置
- topic 列表
- `history.json`
- 附件与头像相关路径

## 页面说明
### 1. Agents
- 左侧上半区显示学科入口列表
- 支持搜索、选择、新建
- 每个 Agent 承载一个学习板块与对应提示词风格

### 2. Topics
- 左侧下半区显示当前 Agent 下的话题历史
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
- 支持消息收藏与从气泡生成笔记

### 4. Source
- 右侧 Source 面板展示当前话题绑定的资料集合
- 支持上传文本、PDF、DOCX，并查看处理状态
- 当前话题发送消息时只检索自己绑定的 Source

### 5. Notes
- 右侧 Notes 面板展示当前话题笔记
- 支持按 Agent 聚合查看
- 支持深度分析、选择题生成和闪卡生成

### 6. Attachments
- 输入区支持:
  - 文件选择
  - 粘贴图片 / 文件
  - 拖拽文件
- 附件进入 composer 后会先走主进程集中存储
- 新历史记录保存的是中心化附件对象，不再依赖浏览器临时 URL

### 7. Settings
- 右侧设置区包含:
  - 全局连接设置
  - Agent 基本资料
  - 模型参数
  - 文本 Prompt 编辑
  - 渲染相关设置
  - 主题切换

## 当前已支持能力
### Topic 管理
- 话题切换
- 自动收敛已读状态
- 重命名 / 删除 / 锁定 / 未读切换

### Source
- 话题级 Source 绑定
- 文本 / PDF / DOCX 导入
- 文档状态显示
- 资料检索与上下文注入

### Notes
- 收藏用户 / 助手消息
- 从聊天气泡直接生成笔记
- 当前 Topic 笔记查看与编辑
- 当前 Agent 笔记聚合视图
- 深度分析 / 选择题 / 闪卡生成

### 附件链路
- 集中式附件落盘
- history 稳定重读
- markdown 导出优先输出中心化路径

## 已知限制
- 当前版本仅支持单聊，不包含群聊
- Notes 当前采用 Markdown 文本方式存储，不包含富文本编辑器
- 当前 Source 检索仍复用原 KB 底层实现，底层字段名尚未迁移
- 深度分析、选择题与闪卡当前基于现有模型链生成，不包含排期 / SRS / Anki 同步

## 文案与查看器说明
- UniStudy 当前用户可见界面继续以简体中文为准
- 为降低编码漂移风险，代码注释、内部日志和维护性说明优先使用英文
- 历史兼容字段仍在内部保留，但不再继续暴露到主界面文案
- 当前版本保留图片与文本 viewer 作为辅助窗口
