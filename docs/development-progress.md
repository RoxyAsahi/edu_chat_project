# UniStudy 当前开发状态

更新时间: 2026-04-26
仓库路径: `C:\VCP\Eric\edu_chat_project`

## 当前结论
UniStudy 当前已完成运行时身份收口，并继续向“个人 AI 学习终端”演进。

## 产品定位与学习闭环
UniStudy 的目标不是再做一个普通 AI 聊天软件，而是打造一个本地优先、模型可选、资料驱动、具备长期记忆的个人 AI 学习空间。

项目早期参考 NotebookLM 的资料型学习体验: 用户可以围绕资料提问、总结和理解。但 UniStudy 的定位不是简单复刻 NotebookLM，而是在它的基础上补足个人学习场景中的几个关键缺口:
- 本地优先: 学习资料、对话、笔记和记忆应尽量由用户自己掌控。
- 模型可选: 用户可以根据效果、成本、速度和隐私需求自由选择 OpenAI-compatible 服务、本地模型或其他兼容 Provider。
- 话题连续: 学习天然按学科、主题、阶段和问题线索组织，因此需要 Agent / Topic 这样的上下文结构。
- AI 不只检索资料: Source 提供依据，AI 也应结合自身知识储备进行解释、类比、迁移和教学设计。
- 长期记忆: AI 应能在用户授权和可管理的边界内记录学习目标、偏好、薄弱点和长期进展。

UniStudy 的学习闭环可以概括为:

```text
Source 资料进入
  -> Chat 对话学习
  -> Render 交互式理解
  -> Notes 笔记沉淀
  -> Practice 测验 / 闪卡 / 复习
  -> Memory 学习记忆更新
  -> 下一次 Topic / Agent 学习继续接上
```

也可以简写为:

```text
Source -> Chat -> Render -> Notes -> Practice -> Memory
```

这条闭环是后续功能取舍的核心标准: 新功能应尽量服务于资料进入、理解发生、内容沉淀、复习反馈和长期连续性，而不是只增加孤立的工具入口。

## 交互式渲染作为核心差异
UniStudy 最需要提前强调的能力，是让 AI 不只生成文字答案，而是生成可交互的学习界面。

传统 AI 学习产品大多仍停留在文字聊天: 用户提问，AI 返回解释、总结、列表或引用。这样的问答有价值，但它把大量知识都压缩成语言，用户仍需要在脑中自行完成抽象转换。很多学习内容并不适合只靠文字理解，例如数学映射、函数变化、几何关系、物理运动、电场、算法执行过程、生物结构、历史时间线和语言场景。

因此，UniStudy 的核心判断是:

> AI 不应该只生成答案，它还应该为当前问题生成一个可以互动的学习场景。

在 UniStudy 中，AI 的输出可以从普通文本扩展为可渲染的前端内容。它可以根据当前学习问题，即时生成:
- 可点击的概念卡片
- 分步骤展开的证明或推理过程
- 数学模型、集合映射和函数变化演示
- 可调参数的物理模拟器
- 流程图、时间线、关系网络和知识拆解面板
- 带按钮和即时反馈的练习界面
- 动画演示、可视化图表和 3D 模型

这意味着学习体验从“我问，AI 答”转变为“我提出问题，AI 为这个问题生成一个临时学习工具”。

例如:
- 用户问“四个蛋糕如何分给四个小朋友”，AI 可以生成蛋糕集合、小朋友集合和映射关系的可视化模型，帮助用户比较一一对应、多人共享、有人未分到等情况。
- 用户问“为什么导数代表瞬时变化率”，AI 可以生成曲线、割线、切线和逐渐缩小的 `delta x` 动态演示。
- 用户问“这个算法为什么会超时”，AI 可以生成执行过程动画，让循环、递归和状态变化一步步展开。

这一点也是 UniStudy 和 NotebookLM 的关键区别:

```text
NotebookLM 让 AI 帮用户理解资料。
UniStudy 让 AI 帮用户生成理解资料的学习场景。
```

因此，交互式渲染不应被视为普通消息渲染的附属功能，而应作为 UniStudy 的核心产品能力之一，与 Source、Topic、Notes、Practice 和 Memory 一起构成学习闭环。

## 2026-04-26 VCPChat 渲染链路对照
本轮排查重点对照了 `C:\VCP\VCPChat` 中的流式渲染路径，主要参考:
- `modules\renderer\streamManager.js`
- `modules\messageRenderer.js`
- `modules\renderer\contentProcessor.js`

对照结论:
- VCPChat 的流式阶段采用 stable / tail 双区结构。只有已经闭合的代码块、工具请求块、工具结果块和桌面推送块会进入 stable root；未闭合内容继续留在 tail root 中轻量重绘。
- VCPChat 普通聊天气泡里的交互式渲染不是 desktop push，也不是流式 iframe 预览；它依赖模型按 `{{VarDivRender}}` 输出裸 HTML 片段，然后由 `marked.parse()` / `morphdom` 在 tail root 中边流式边变成 DOM。
- 完整高保真渲染只在消息最终完成后执行: `messageRenderer -> preprocessFullContent -> marked.parse -> processRenderedContent -> setupHtmlPreview`。
- HTML 预览按钮和 iframe 属于完整后处理能力，只适合处理明确的 fenced HTML / doctype 完整网页源码，不应拦截普通聊天中的裸 `<div id="response-root">` 渲染片段。否则最终重绘时很容易把正在显示的 iframe 或按钮状态替换掉，表现为“渲染出来又消失”。
- 工具请求块不同于 HTML iframe。工具块在 `<<<[END_TOOL_REQUEST]>>>` 到达后已经具备完整边界，可以立即进入 stable root 并通过 Markdown / 特殊块处理提前美化，不必等整条回复结束。

本次 UniStudy 发现的实际断点:
- `ensureHtmlFenced()` 在迁移后留下了错误保护标记占位，导致 `「始」/「末」` 与 `「始ESCAPE」/「末ESCAPE」` 内的内容保护不可靠。
- 直接输出 `<!DOCTYPE html> ... </html>` 会被包成 ` ```html ` 代码块，但 `ensureNewlineAfterCodeBlock()` 又把合法的 ` ```html ` 拆成普通围栏加一行 `html` 文本，导致后续 `<code>` 失去 `language-html`，`setupHtmlPreview()` 无法识别并创建播放按钮。
- 后续又尝试在 stream tail 中把裸 HTML 或未闭合 fenced HTML 改造成 iframe 预览，这偏离了 VCPChat 普通聊天路径，也是“边渲染边输出”没有对齐预期的主要原因。

当前修复原则:
- 保留 VCPChat 的流式架构边界: 流式阶段不主动把裸 HTML 包成 iframe，而是让裸 HTML 直接通过 `marked.parse()` / `morphdom` 进入当前消息 DOM。
- 默认渲染提示词要求模型输出 `<div id="response-root">` 等 HTML 片段，不输出 ` ```html ` 代码围栏，也不输出 `<!DOCTYPE html>`、`<html>`、`<head>`、`<body>` 完整网页外壳。
- `ensureNewlineAfterCodeBlock()` 必须保留合法代码块 info string，例如 ` ```html `、` ```js `、` ```mermaid `。
- `ensureHtmlFenced()` 仅处理 `<!DOCTYPE html> ... </html>` 这类完整网页源码；普通 `<div>` / `<section>` / `<svg>` / `<html>` 片段保持裸 HTML，避免被误转成代码预览。
- 工具请求文本在流式阶段可以正常可见；当 `<<<[END_TOOL_REQUEST]>>>` 到达后，允许立即稳定并美化成学习日志 / 工具卡片。

后续实现和文档表达中，可以优先使用以下定位语句:
- UniStudy 不是让 AI 只回答问题，而是让 AI 为每个问题生成一个可以互动的学习场景。
- 从 AI 聊天，到 AI 生成学习界面。
- 让知识不只被解释，而是被看见、被操作、被体验。

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
