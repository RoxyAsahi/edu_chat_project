# UniStudy（原 VCPChat Lite）架构与安全深度审查报告

材料日期: 2026-04-11  
仓库路径: `C:\VCP\Eric\VCPChatLite`

说明: 本文是 2026-04-11 形成的历史审查材料。除标题与导语按 UniStudy（原 VCPChat Lite）口径整理外，其余证据、路径、字段名与时间点尽量保留当时语境。

## 0. 审查方法与结论摘要

本次审查以静态代码审查为主，目标是回答两个问题:

1. 这个项目现在最影响开发效率、维护成本和安全性的点是什么
2. 如果继续演进到“个人 AI 学习终端”，应当如何从当前实现平滑过渡到目标态架构

本次未执行现有 E2E smoke 脚本。原因不是不需要测试，而是仓库当前把 `AppData`、测试产物和部分运行态数据放在仓库内，现有 smoke 脚本会创建/写入文件，容易污染审查现场。当前结论主要来自以下证据:

- Electron 主窗口、viewer 窗口、preload、IPC、renderer、knowledge-base、notes、settings、agent config、file manager 关键入口
- 现有 `package.json`、回归清单、smoke 脚本和代码规模统计
- 渲染链路、文件访问链路、配置持久化链路、知识库链路的精确代码位置

一句话结论:

当前项目已经从“原 VCPChat Lite 聊天壳”演进为“功能型学习工作台”，但安全边界、模块边界和持久化契约没有同步升级。结果是: 功能能继续堆，但每新增一个功能，都在放大 renderer 复杂度、IPC 面宽度、内容注入风险和持久化并发风险。短期内最需要处理的不是 UI 细节，而是把 Electron 安全边界、内容渲染边界和数据写入边界先收紧。

### 2026-04-11 票 2 实施结果

- 主窗口、text viewer、image viewer 已全部切到 `sandbox: true`
- 主页面、text viewer、image viewer 已补显式 CSP
- 主页面已移除远程 Google Fonts，Material Symbols 改为本地自托管字体
- 为适配 sandbox，`src/preloads/lite.js` 与 `src/preloads/viewer.js` 改为自包含 preload，不改变 `window.chatAPI` / `window.utilityAPI` 对外接口
- `npm run test:e2e:smoke` 已通过，新增 viewer smoke，覆盖 text/image viewer 打开、主题同步与关闭链路

因此，本报告中 F03 / F04 的“现状”已不再成立，当前应将其视为“已落地补偿控制，继续观察后续收口项”，而不是未处理风险。

---

## 1. 最值得立即处理的 12 个问题

| 优先级 | 问题 | 关键证据 | 为什么必须现在处理 |
| --- | --- | --- | --- |
| P0 | HTML 预览 iframe 直接执行不受信任内容 | `src/modules/renderer/contentProcessor.js:505-554` | 模型返回的 HTML 代码块可在 renderer 里执行 JS，严重时可联动 preload API 读取本地文件 |
| P0 | Renderer 可通过 preload 直接读取任意本地文件 | `src/preloads/shared/catalog.js:61-63`、`src/modules/main/ipc/fileDialogHandlers.js:95-117` | 一旦 renderer 被注入，攻击面从“页面污染”升级成“本地文件外带” |
| P1 | Electron sandbox 与页面级 CSP 曾长期缺失，但已于 2026-04-11 票 2 落地补偿控制 | `src/main/main.js:284`、`src/modules/main/ipc/fileDialogHandlers.js:314`、`359`、`src/renderer/index.html:7`、`src/modules/renderer/text-viewer.html:7`、`src/modules/renderer/image-viewer.html:7` | 这部分平台级缓冲层已补齐，后续重点从“先止血”转为“继续收口更深层渲染风险” |
| P1 | 主页面远程字体依赖已移除，但 CSP 仍保留兼容性例外，后续需继续收紧 | `src/renderer/style.css:11`、`src/renderer/index.html:7`、`src/modules/renderer/text-viewer.html:7`、`src/modules/renderer/image-viewer.html:7` | 当前已具备浏览器级策略兜底，但 viewer 为兼容 draw.io / OCR / Pyodide 仍保留最小必要例外 |
| P1 | Markdown/HTML 渲染默认 `sanitize: false`，且存在未净化的 `innerHTML` 路径 | `src/renderer/renderer.js:790-808`、`332-343`、`3105-3109`、`src/modules/renderer/messageRenderer.js:1563-1577` | 渲染安全依赖人工自觉，极易在新功能中回归 |
| P1 | Agent Chat CSS 的“作用域隔离”实现不完整，可被选择器逃逸 | `src/renderer/index.html:602-611`、`src/modules/renderer/messageRenderer.js:1740-1769` | 这不仅会造成样式污染，还会让 AI/用户配置拥有全局 UI 破坏能力 |
| P1 | Topic/Agent 配置持久化没有统一走同一写入契约 | `src/modules/main/ipc/chatHandlers.js:800-838`、`853-890`、`src/modules/main/utils/agentConfigManager.js:206-248` | 当前实现存在“先读旧快照，再通过 manager 回写”的丢更新风险 |
| P1 | Preload 暴露面过宽，`LITE_KEYS` 已达到 79 个能力 | `src/preloads/shared/roles.js:26-83` | 最小权限原则已失效，接口治理、迁移和测试都会持续恶化 |
| P2 | `renderer.js` 已成为巨型入口，状态、DOM、工作流和调试全堆在一起 | `src/renderer/renderer.js` 5619 行；`state` 和 `el` 定义位于 `:9-230` | 改动放大、回归频繁、定位成本高，已是开发效率核心瓶颈 |
| P2 | `knowledge-base/index.js` 同时承担存储、导入、检索、guide 生成、view 组装 | `src/modules/main/knowledge-base/index.js:465`、`650`、`795`、`1358`、`1417`、`1489` | 任何 Source/Notes/检索相关需求都会持续回流到一个 God module |
| P2 | `window` 全局污染严重，模块依赖隐式化 | `src/renderer/renderer.js:4790-4808`、`src/modules/renderer/messageRenderer.js:1185-1186`、`2350` | 模块边界弱，调试方便但长期极易演变成不可预测耦合 |
| P2 | 测试体系只有 smoke/checklist，没有 repo 内单元/契约测试 | `package.json:6-12`、`docs/lite-regression-checklist.md:1-132` | 当前最缺的不是更多手测，而是能锁住安全边界和数据契约的自动测试 |

---

## 2. 完整问题清单

### F01. [P0] HTML 预览 iframe 可执行不受信任脚本

证据:

- `src/modules/renderer/contentProcessor.js:505-554`
- `src/modules/renderer/contentProcessor.js:540-544`

现状:

- `setupHtmlPreview` 把 `htmlContent` 直接插入 `iframe.srcdoc`
- iframe 没有 `sandbox` 属性
- iframe 内脚本被明确允许执行，并且主动使用 `window.parent.postMessage`

影响:

- 模型生成的 HTML 代码块不再只是“展示内容”，而是“执行内容”
- 在默认浏览器模型下，未 sandbox 的 `srcdoc` iframe 与父页面之间的边界非常脆弱
- 当前父页面又暴露了大量全局函数和 preload API，攻击面被进一步放大

真实风险场景:

- 模型输出一段“可预览 HTML”
- 用户点击“播放”
- iframe 中的脚本访问 `window.parent`
- 触发消息发送、读取状态、读取本地文件、污染 UI 或触发 IPC

整改建议:

- 第一阶段直接移除该能力，或默认关闭，仅在开发开关下启用
- 若必须保留，改为 `sandbox` + 禁止脚本 + 独立 origin + 严格消息白名单
- 从“在主 renderer 内执行”改为“独立 viewer 进程/隔离页 + 只允许静态渲染”

### F02. [P0] Renderer 可以请求读取任意本地文件

证据:

- `src/preloads/shared/catalog.js:61-63`
- `src/modules/main/ipc/fileDialogHandlers.js:95-117`
- `src/modules/main/ipc/fileDialogHandlers.js:104-216`
- `src/main/main.js:210-217`

现状:

- preload 直接暴露 `getFileAsBase64(filePath)`、`getTextContent(filePath, fileType)`、`watcherStart(filePath, ...)`
- main process 端基本相信 renderer 传入的路径，只做 `exists` 检查，不做根目录白名单校验

影响:

- 任何 renderer 注入或脚本执行都可升级为本地文件读取
- 这是 Electron 项目里典型的“XSS -> LFI/本地敏感信息泄露”路径

真实风险场景:

- 恶意 HTML 预览脚本或未来任何渲染注入点拿到 `window.parent.chatAPI`
- 调用 `getTextContent('C:\\Users\\...\\settings.json')`
- 获取本地配置、源码、凭据或其他敏感文件

整改建议:

- 删除“按任意路径读取”的通用 API
- 只允许读取由主进程签发的 attachment/document token
- 所有文件读写 IPC 都要改为“ID -> 主进程内部解析实际路径”的模式
- `watcher:start` 只允许 watch 受控目录内已登记文件

### F03. [P1] Electron 窗口关闭了 sandbox，纵深防御不足

状态更新:

- 已于 2026-04-11 的“票 2: Electron sandbox + CSP 硬化”中完成整改
- 当前主窗口、图片 viewer、文本 viewer 均已切换为 `sandbox: true`
- `npm run test:e2e:smoke` 已验证主窗口与 viewer 在 sandbox 下可正常打开、通信、同步主题并关闭

证据:

- `src/main/main.js:284`
- `src/modules/main/ipc/fileDialogHandlers.js:314`
- `src/modules/main/ipc/fileDialogHandlers.js:359`
- `scripts/electron-unistudy-smoke.js:376`

现状:

- 主窗口、图片 viewer、文本 viewer 当前均为 `sandbox: true`
- `contextIsolation: true` 与 `nodeIntegration: false` 继续保留，形成更接近 Electron 推荐基线的组合
- 为兼容 sandbox，preload 已改为自包含实现，但未改变现有 renderer 侧 API 名称和调用签名

影响:

- 这部分平台级纵深防御已明显增强，renderer 漏洞被利用后的后果范围得到压缩
- 后续风险重心转移到 HTML preview、任意路径读文件和统一 sanitize 等更深层问题

整改建议:

- 保持新窗口默认 `sandbox: true`，避免后续回归
- 若新增 viewer / helper window，要求复用当前 sandbox + preload 最小权限模式
- 后续继续把注意力转向文件访问 IPC、HTML preview 和渲染净化链路

### F04. [P1] 主页面没有 CSP，还直接加载远程字体

状态更新:

- 已于 2026-04-11 的“票 2: Electron sandbox + CSP 硬化”中完成主页面与 viewer 页面 CSP 落地
- 主页面对 Google Fonts 的远程依赖已移除，Material Symbols 已改为本地自托管字体
- viewer 为兼容现有 draw.io / OCR / Pyodide 能力，保留了最小必要的 CSP 域名例外

证据:

- `src/renderer/index.html:7`
- `src/modules/renderer/text-viewer.html:7`
- `src/modules/renderer/image-viewer.html:7`
- `src/renderer/style.css:11`

现状:

- 主页面、text viewer、image viewer 当前都已具备显式 CSP
- 主页面字体资源已改为本地静态文件，不再依赖 `fonts.googleapis.com`
- 主页面保持相对严格策略；viewer 为兼容现有功能，保留 `style-src 'unsafe-inline'` 与少量外部域名白名单

影响:

- 浏览器级安全策略已经补上，不再处于“完全无兜底”的状态
- 但 viewer 仍存在兼容性例外，因此 CSP 现在是“有效补偿控制”，还不是最终极限收口形态

整改建议:

- 继续维持主页面本地字体与显式 CSP 基线，避免远程资源依赖回归
- 后续优先评估移除 viewer 中 draw.io / OCR / Pyodide 兼容例外的成本
- 在不打断现有业务能力的前提下，逐步把 viewer 的 `script-src` / `connect-src` 继续收紧

### F05. [P1] Markdown/HTML 渲染链路整体缺少统一可信边界

证据:

- `src/renderer/renderer.js:790-808`
- `src/renderer/renderer.js:332-343`
- `src/renderer/renderer.js:3105-3109`
- `src/modules/renderer/messageRenderer.js:1563-1577`
- `src/modules/renderer/messageRenderer.js:1934-1946`

现状:

- `marked` 初始化时显式配置 `sanitize: false`
- `renderMarkdownFragment()` 直接 `markedInstance.parse(markdown)`
- `renderFlashcardContent()` 直接把结果塞进 `innerHTML`
- 消息渲染主链 `contentDiv.innerHTML = finalHtml`

影响:

- 当前项目不是“某个点没净化”，而是“默认不净化，靠局部补救”
- 新增一个消息类型、一个笔记视图、一个学习工具，就可能新增一个未净化入口

真实风险场景:

- 闪卡 front/back、笔记 markdown、学习工具输出、AI 响应中的 HTML 片段
- 在某些路径下直接进入 `marked -> innerHTML`

整改建议:

- 明确“渲染前数据”和“可插入 DOM 的 Trusted HTML”是两个不同类型
- 引入统一 sanitize 层，禁止业务代码直接 `marked.parse(...)` 后写入 DOM
- 把 `innerHTML` 审查做成准入清单，不允许继续自由增长

### F06. [P1] Agent Chat CSS 作用域实现可逃逸

证据:

- `src/renderer/index.html:602-611`
- `src/modules/renderer/messageRenderer.js:1740-1769`

现状:

- UI 明确允许编辑 `卡片 CSS / 聊天 CSS / 自定义 CSS`
- `chatCss` 的作用域实现只是简单做字符串前缀:
  `const scopedChatCss = \`[data-chat-scope="${chatScopeId}"] ${chatCss}\``

影响:

- 对逗号选择器、`@media`、`@keyframes`、复杂规则无可靠隔离
- 一段聊天 CSS 就可能污染整个页面，而不是当前消息 bubble

真实风险场景:

- 用户或模型配置 `h1, body { display:none }`
- 最终结果变成 `[data-chat-scope="..."] h1, body { display:none }`
- `body` 仍然是全局命中

整改建议:

- 禁止把自由文本 CSS 直接注入运行页面
- 若必须支持自定义样式，只允许结构化 token/主题变量
- 如继续支持 CSS，自定义样式必须复用 `scopeCss()` 这类真正的选择器级重写器，而不是字符串拼接

### F07. [P1] Topic/Agent 配置写入链路不统一，存在丢更新风险

证据:

- `src/modules/main/ipc/chatHandlers.js:800-838`
- `src/modules/main/ipc/chatHandlers.js:853-890`
- `src/modules/main/utils/agentConfigManager.js:206-248`

现状:

- `toggle-topic-lock` / `set-topic-unread` 先自己读 `config.json`
- 再把旧快照中的 `config.topics` 传给 `agentConfigManager.updateAgentConfig`
- manager 有队列和锁，但外部快照不是在锁内读取

影响:

- 两个并发操作会互相覆盖对方的 topic 字段改动
- “看起来用了 manager”，但实际上并没有完整遵守同一持久化契约

真实风险场景:

- 一个操作改 `locked`
- 另一个操作改 `unread` 或 `knowledgeBaseId`
- 后提交者用旧快照整体覆盖 `topics`

整改建议:

- 所有 `Agent config` 写入都只能通过 `agentConfigManager` 完成
- handler 只能传入“增量意图”，不能传入“旧快照数组”
- 统一成 `updateTopic(agentId, topicId, patch)` 之类的单点写接口

### F08. [P1] Preload/API 面过宽，且没有 schema 和权限分区

证据:

- `src/preloads/shared/roles.js:26-83`
- `src/preloads/shared/catalog.js:55-97`
- `src/preloads/shared/apiFactory.js:34-37`

现状:

- `LITE_KEYS` 共 79 个能力
- catalog 是平铺式的大对象，读/写/流式订阅/文件/窗口/知识库/笔记全部混在一起
- IPC 入参和返回值没有统一 schema 校验

影响:

- renderer 拿到的是“大总线”，而不是“按能力域拆分的小接口”
- 最小权限原则失效
- 接口演进难，测试难，安全审计难

整改建议:

- preload 按领域拆成 `windowAPI / chatAPI / notesAPI / kbAPI / settingsAPI / viewerAPI`
- 所有 IPC payload 引入 shared schema
- 把“本地文件、外链、viewer 打开、系统能力”从业务 API 中独立出来

### F09. [P2] `renderer.js` 已经是影响开发效率的头号瓶颈

证据:

- `src/renderer/renderer.js` 当前 5619 行
- `src/renderer/style.css` 当前 3899 行
- `src/renderer/renderer.js:9-87`
- `src/renderer/renderer.js:108-230`
- `src/renderer/renderer.js:4790-4808`

现状:

- 单文件同时维护:
  全局状态、DOM 缓存、布局、聊天工作流、Source、Reader、Notes、Settings、Flashcard、窗口控制、调试辅助
- 仅 `innerHTML =` 在该文件里就出现了 58 次
- DOM 查询统计约 193 次

影响:

- 任何一个功能改动都可能触碰全局状态和页面结构
- 重构成本只会随功能增长非线性上升

整改建议:

- 按工作区拆成 `app-shell / chat / source / reader / notes / settings / layout`
- 状态从单大对象改为领域 store
- DOM 从“大缓存字典”改为每个 feature 自己拥有根节点和事件绑定

### F10. [P2] `knowledge-base/index.js` 是典型 God module

证据:

- `src/modules/main/knowledge-base/index.js` 当前 1525 行
- `src/modules/main/knowledge-base/index.js:465`
- `src/modules/main/knowledge-base/index.js:650`
- `src/modules/main/knowledge-base/index.js:795`
- `src/modules/main/knowledge-base/index.js:1358`
- `src/modules/main/knowledge-base/index.js:1417`
- `src/modules/main/knowledge-base/index.js:1489`

现状:

- 单文件覆盖初始化、建库、删库、导入文件、排队处理、检索、rerank、guide 生成、document view 组装

影响:

- 数据导入、索引、检索、reader、guide 五种不同生命周期耦合在一起
- 任何一条 Source 链路变更都要回到这个文件

整改建议:

- 按领域拆成 `kb-repository / ingestion-service / retrieval-service / guide-service / reader-projection`
- `ipc/knowledgeBaseHandlers.js` 只做 transport，不做业务拼装

### F11. [P2] `window` 全局污染让模块边界变得隐式

证据:

- `src/renderer/renderer.js:698`
- `src/renderer/renderer.js:4790-4808`
- `src/modules/renderer/messageRenderer.js:1185-1186`
- `src/modules/renderer/messageRenderer.js:2350`

现状:

- `window.globalSettings`
- `window.sendMessage`
- `window.__liteDebugState`
- `window.updateSendButtonState`
- `window.messageRenderer`
- `window.messageContextMenu`

影响:

- 模块表面上是 ES module，实际上大量能力通过全局变量耦合
- 一旦渲染上下文被注入，攻击者/异常逻辑可直接拿到更多系统入口

整改建议:

- 禁止新增运行时 `window.* = ...`
- 用显式依赖注入或领域 store/command bus 取代
- debug 能力单独挂在开发模式专用 namespace

### F12. [P2] 运行时数据边界和源码边界不清晰

证据:

- `docs/lite-regression-checklist.md:17-20`
- `src/modules/main/modelUsageTracker.js:11-12`
- 仓库内存在 `AppData/`、`src/AppData/`、`src/modules/AppData/`

现状:

- 正式数据根被固定在仓库内 `AppData`
- `modelUsageTracker` 仍指向 `src/modules/AppData`
- 源码树里存在运行时 JSON 数据痕迹

影响:

- 工作区容易变脏
- 测试、备份、分发、CI、代码审查都难以区分“源码改动”和“运行态脏数据”

整改建议:

- 目标态统一到 OS userData 或明确的外部 data root
- 仓库内只保留 fixture，不保留真实运行态
- 所有运行态路径都从一个 data-root resolver 统一派生

### F13. [P2] 测试体系没有形成对边界的自动保护

证据:

- `package.json`
- `tests/*.test.js`
- `tests/renderer/safe-html.test.js`
- `tests/e2e/controlled.test.js`
- `docs/lite-regression-checklist.md`

原始问题:

- 只有 `start` 和若干 smoke 脚本
- 没有单元测试、契约测试、组件测试、IPC 测试
- 回归清单中连窗口快捷键这类基础行为仍有未验证项

影响:

- 当前代码库的主要风险不是“没人测”，而是“只有端到端 smoke，缺少边界测试”
- 安全/持久化/渲染回归只能靠人工发现

整改状态（2026-04-11）:

- 已补三层自动化测试：
  `npm run test:main`
  `npm run test:renderer`
  `npm run test:e2e:controlled`
- 已补第一批边界保护：
  `settings schema + SettingsManager/AgentConfigManager repository + renderer sanitize + IPC guard`
- 已补第二批边界保护：
  `preload/electronAPI 契约测试 + 受控 Electron E2E`
- 手工 checklist 已收缩为视觉与体验项，窗口快捷键、持久化恢复、渲染净化、topic Source 绑定已转为自动化验证

实现备注:

- preload 运行环境对本地模块复用有限制，因此正式 preload 仍保持自包含实现；通过 shared catalog/roles 与契约测试防止接口漂移

### F14. [P2] 外链策略过宽，允许 `file:` 和 `magnet:`

证据:

- `src/modules/main/ipc/fileDialogHandlers.js:226-233`

现状:

- `open-external-link` 允许 `http:`、`https:`、`file:`、`magnet:`
- 无来源校验、无确认、无 allowlist

影响:

- renderer 一旦被滥用，可触发本地文件或外部协议处理器
- 这类能力应该属于“高信任系统动作”，不能作为通用 renderer 能力

整改建议:

- 默认只允许 `https:`
- `http:`、`file:`、自定义协议必须由主进程二次确认
- viewer/消息中的链接统一走一个受控外链服务

### F15. [P3] `get-agents-metadata` 存在潜在运行时错误

证据:

- `src/modules/main/ipc/agentHandlers.js:99-115`

现状:

- handler 内部调用 `ipcMain.invoke('get-agents')`
- Electron 主进程没有这类自调用接口

影响:

- 该接口一旦被调用，将变成 latent bug
- 说明 IPC handler 之间的复用方式没有统一约束

整改建议:

- handler 不要互相“假装走 IPC”
- 把共享逻辑抽为普通 service 函数

### F16. [P3] SettingsManager / AgentConfigManager 复制了同一套基础设施逻辑

证据:

- `src/modules/main/utils/appSettingsManager.js:83-131`
- `src/modules/main/utils/appSettingsManager.js:305-347`
- `src/modules/main/utils/agentConfigManager.js:7-20`
- `src/modules/main/utils/agentConfigManager.js:252-267`

现状:

- 两套 manager 都维护锁文件、缓存、定时清理、备份、队列
- 策略不完全一致，但职责高度相似

影响:

- 修一个数据写入问题，通常要修两套实现
- 后续如果再引入 `notes manager` / `kb manager`，重复建设会继续扩大

整改建议:

- 抽出统一的 `json-repository` / `atomic-file-store`
- 把锁、缓存、备份、写入策略做成复用基础层

---

## 3. 目标态架构

### 3.1 设计原则

- 主进程只负责系统能力、数据写入、后台任务和窗口生命周期
- preload 只暴露按领域拆分后的最小能力，不暴露任意路径读写
- renderer 只负责状态编排和 UI，不直接拥有系统级能力
- 所有持久化数据都有 schema、版本和迁移策略
- 所有可渲染 HTML 都必须经过统一 sanitize，所有不受信任内容默认纯文本

### 3.2 建议的分层

#### Main Process

- `main/bootstrap`
  负责 app 启动、窗口注册、依赖装配
- `main/ipc/controllers`
  只做入参校验、权限检查、错误映射
- `main/application/services`
  `chat-service`、`notes-service`、`kb-service`、`settings-service`
- `main/infrastructure/repositories`
  `settings-repo`、`agent-repo`、`history-repo`、`notes-repo`、`kb-repo`
- `main/infrastructure/system`
  `file-access-service`、`window-service`、`external-link-service`

#### Preload

- `windowAPI`
  最小窗口控制
- `chatAPI`
  聊天、流式、中断、历史
- `notesAPI`
  Notes CRUD 和学习工具
- `kbAPI`
  Source/检索/guide/document view
- `settingsAPI`
  全局设置与 agent 设置
- `viewerAPI`
  viewer 专属最小接口

每个 API:

- 只暴露本域能力
- 只接受 schema 化参数
- 不暴露“任意路径”接口

#### Renderer

- `app-shell`
  整体布局、路由、feature 装配
- `features/chat`
  composer、message list、stream state
- `features/source`
  source list、document jobs、debug panel
- `features/reader`
  guide view、document view、selection inject
- `features/notes`
  list、detail、flashcards、analysis
- `features/settings`
  global settings、agent settings、source settings
- `shared/stores`
  按领域拆分状态，而不是单一大 `state`

### 3.3 渲染安全目标态

- Markdown 渲染统一走一条 `markdown -> AST/HTML -> sanitize -> TrustedHtml -> DOM`
- 禁止业务层直接 `marked.parse()` 后 `innerHTML = ...`
- HTML preview 改成隔离 viewer，不在主 renderer 里执行脚本
- 自定义 CSS 改为主题 token 或受限样式 DSL

### 3.4 持久化目标态

- 每类数据一个 repository
- 所有写操作只通过 repository/service
- repository 内部统一原子写、锁、备份、schema 校验、迁移
- UI 不再知道真实文件路径，只知道业务 ID

### 3.5 测试目标态

- 单元测试:
  schema、sanitize、repository、retrieval ranking、CSS scoping
- 集成测试:
  IPC controller + service + repository
- 受控 E2E:
  启动、发送、中断、上传 Source、Notes、viewer
- 安全回归:
  XSS payload、恶意 CSS、任意路径访问、外链策略

---

## 4. 三阶段路线图

### 阶段一: 立即收口，先止血

目标:

- 把“任何一个渲染漏洞都能升级成系统级问题”的路径切断

动作:

- 移除或禁用 HTML preview 的脚本执行能力
- 主窗口和 viewer 补 CSP
- 审查并删除任意路径读取/监听 IPC
- `open-external-link` 改成受控 allowlist
- 对所有 Markdown -> HTML -> DOM 路径加统一 sanitize
- 停止新增 `window.*` 全局出口

验收标准:

- renderer 无法直接请求任意本地路径
- 代码块预览不再能执行 JS
- 新增渲染内容无法绕过统一 sanitize 层

### 阶段二: 边界拆分，降低维护成本

目标:

- 让后续功能开发不再继续放大单文件和单模块复杂度

动作:

- 把 `renderer.js` 拆成按 feature 的模块
- 把 `knowledge-base/index.js` 拆成导入、检索、guide、projection 四类服务
- preload 改为按领域 API
- 所有 config/topic/history/note 写入统一走 repository/service
- 用 shared schema 管理 IPC payload

验收标准:

- 任何单一功能变更不需要修改超大入口文件
- 任意持久化写入路径都能追踪到单一 repository
- preload API 数量显著下降且分域清晰

### 阶段三: 目标态重构

目标:

- 从“功能型 Electron 页面”升级成“有清晰边界的桌面工作台”

动作:

- 引入正式应用层和基础设施层
- 清理仓库内运行态数据，把正式数据根迁出源码仓库
- 统一 viewer 安全策略和受控内容渲染策略
- 补齐单元/集成/安全回归测试
- 为 Source / Notes / Chat 定义正式的数据契约和迁移策略

验收标准:

- 主要 feature 具备独立模块、独立状态、独立测试
- 安全边界不是靠约定，而是靠框架和策略强制
- 新功能接入不需要继续扩大 God file / God API

---

## 5. 残余风险与暂缓项

以下问题不建议在第一轮就投入大规模改造，但需要在路线图里显式登记:

- `renderer/style.css` 3899 行，同样需要按 feature 拆分，否则 UI 维护成本会与 JS 同步膨胀
- `Promptmodules` 仍带有全局脚本风格，未来也应收进同一模块体系
- 仓库内存在大量测试产物和调试脚本，说明“实验路径 -> 正式路径”的准入机制仍偏弱
- 当前知识库和 Notes 的命名存在兼容负债，例如 `knowledgeBaseId` 仍被 Source 语义复用，后续迁移要有兼容层

---

## 6. 建议的落地顺序

如果只能按最小代价先做 6 件事，建议顺序如下:

1. 删除 HTML preview 脚本执行
2. 删除任意路径文件读取/监听 IPC
3. 打开 Electron sandbox，并补 CSP
4. 收口 Markdown/HTML 渲染到统一 sanitize 层
5. 统一 Topic/Agent 配置写入契约
6. 拆 renderer / preload / knowledge-base 三个 God 边界

---

## 7. 附录: 关键量化指标

- `src/renderer/renderer.js`: 5619 行
- `src/renderer/style.css`: 3899 行
- `src/modules/main/knowledge-base/index.js`: 1525 行
- `src/modules/main/ipc/chatHandlers.js`: 909 行
- `src/modules/main/ipc/agentHandlers.js`: 525 行
- `src/preloads/shared/roles.js` 中 `LITE_KEYS`: 79 个
- `src/renderer/renderer.js` 中 `innerHTML =`: 58 处
- 仓库内项目自有 `*.test.*` / `*.spec.*`: 0 个

---

## 8. 最终判断

这个项目不是“代码写得差”，而是“产品演进速度已经超过了架构治理速度”。

如果继续在当前结构上叠功能，短期仍能跑，但会越来越依赖少数熟悉全局上下文的人，开发体验会逐步从“快”变成“改哪里都怕”，而安全问题则会从“有几个漏洞”演变成“整个渲染层没有可信边界”。

好消息是，当前代码已经具备可以重构的基础:

- 主/预加载/渲染三层已经初步分开
- settings / agent config 已经有 manager 雏形
- Notes 和 Source 已经形成相对清晰的业务域

真正需要的不是推倒重写，而是先收口危险边界，再把现有功能域正式化。
