# VCPChat Lite 当前开发状态

更新时间: 2026-04-09
仓库路径: `C:\VCP\Eric\VCPChatLite`

## 当前结论
VCPChat Lite 已经从原 VCPChat 中拆成独立 Electron 单聊客户端，并完成当前正式运行链收口。

当前正式边界如下:
- 保留多助手单聊、多话题历史、高保真渲染
- 保留流式请求、中断、Markdown 导出、附件集中存储、图片 / 文本 viewer
- Prompt 在 Lite 中固定为单文本模式
- 正式运行时只使用 Lite 自己的 `AppData`
- 不再把旧仓数据目录作为运行时依赖或 fallback

## 当前架构边界
### 主运行链
- `src/main/main.js`: Electron 启动、窗口装配、主进程 handler 注册
- `src/preloads/lite.js`: Lite preload 暴露面
- `src/renderer/index.html`: 主页面入口
- `src/renderer/renderer.js`: Lite renderer 壳层与页面交互

### 模块归属
- `src/modules/main/`: 主进程专属模块
- `src/modules/shared/`: 仅保留真正跨运行时共享的对象
- `src/modules/renderer/`: renderer / viewer / 渲染辅助模块

### 当前正式职责划分
- `src/modules/main/vcpClient.js`: 唯一的 VCP transport / lifecycle client
- `src/modules/main/ipc/chatHandlers.js`: IPC boundary + Lite request preprocessing
- `src/modules/renderer/messageRenderer.js`: 主消息渲染核心
- `src/modules/renderer/streamManager.js`: 流式消息增量渲染与收尾
- `src/modules/renderer/text-viewer.*` / `image-viewer.*`: Lite 辅助 viewer

## 当前目录结构
### 根目录长期保留对象
- `package.json`
- `package-lock.json`
- `.editorconfig`
- `.gitattributes`
- `.gitignore`
- `start.bat`
- `AppData/`
- `.lite-regression-data/`
- `docs/`
- `scripts/`
- `tools/`
- `vendor/`
- `.tmp/`
- `src/`

### `src/` 内正式源码
- `src/main/`
- `src/renderer/`
- `src/modules/main/`
- `src/modules/shared/`
- `src/modules/renderer/`
- `src/preloads/`
- `src/Promptmodules/`
- `src/styles/`
- `src/assets/`

## 已完成能力
### 基础产品能力
- 单窗口 Lite 客户端可独立启动
- agent / topic / history 可独立加载
- topic 支持新建、重命名、删除、锁定 / 解锁、未读 / 已读切换
- Lite 页内确认弹窗与输入弹窗已替代系统原生 `prompt`

### 数据与解耦
- 正式数据根固定为 `C:\VCP\Eric\VCPChatLite\AppData`
- `VCPCHAT_DATA_ROOT` 仅保留为开发 / 测试 override
- Lite 不再自动读取或复制 `C:\VCP\Eric\VCPChat\AppData`
- Lite `settings.json` 与 `.backup` 已收口为 Lite-only 结构
- 已迁入并保留当前测试数据集:
  - `Lite_Real_Test_Nova_1775682726542`
  - `_Agent_1775676053834_1775676053836`

### 聊天与 VCP 链路
- `vcpClient` 已成为唯一的 VCP 传输实现
- 支持 stream / non-stream / interrupt / timeout / server error 收尾
- 本地请求生命周期已包含 active request、abort、timeout、cleanup
- 流式终态可保留 `fullResponse` 或 `partialResponse`

### 渲染与 viewer
- Markdown、代码块、图片、KaTeX、Mermaid、Pretext 可正常渲染
- `messageRenderer.js` 与 `streamManager.js` 已完成迁移期结构修复
- `text-viewer.js` 已收口到“规范中文 + 英文 key + 历史乱码 alias”的内部归一化策略
- `text-viewer.html` 残留乱码注释已清成英文
- 当前用户可见界面继续以简体中文为准
- 注释、内部日志、维护说明统一优先英文

### 附件链路
- 文件选择、粘贴图片 / 文件、拖拽文件均走主进程集中存储
- 历史记录保存中心化附件对象
- 重启后旧消息附件与图片可稳定回读
- Markdown 导出优先输出中心化附件路径

## 当前兼容策略
### 保留的兼容
- 继续兼容已迁入测试数据的历史字段
- Prompt 继续兼容读取旧 modular / preset 字段，但 Lite UI 不再暴露三模式
- 历史乱码 alias 仅保留在 parser 内部，用于识别旧数据中的 key / marker

### 明确不再保留的口径
- 不再支持旧仓 `AppData` 作为正式数据根
- 不再恢复 group / notes / canvas / rag / assistant shell 等旧壳层能力
- 不再恢复旧 positional IPC 契约
- 不再把 `chatHandlers` 重新膨胀成网络实现层

## 已验证结果
### 语法与模块检查
已通过:
- `node --check src\main\main.js`
- `node --check src\renderer\renderer.js`
- `node --check src\modules\renderer\messageRenderer.js`
- `node --check src\modules\renderer\streamManager.js`
- `node --check src\modules\renderer\text-viewer.js`
- `node --check src\modules\renderer\image-viewer.js`
- `node --check src\preloads\lite.js`
- `node --check src\preloads\shared\roles.js`
- `node --check src\modules\main\services\preloadPaths.js`

### 真机与 E2E 验证
已完成:
- `npm start` 可拉起 Electron 主窗口
- 启动日志确认 `Data root: C:\VCP\Eric\VCPChatLite\AppData`
- 启动日志确认 `Using Lite AppData only.`
- `node scripts\run-vcp-recovery-e2e.js` 已通过:
  - normal stream
  - interrupt
  - server error
  - timeout
  - non-stream

## 当前仍待收尾项
- `text-viewer.*` 与少量 renderer 辅助文件仍有零散历史兼容 alias，后续可继续集中整理
- `messageRenderer.js` 中仍保留少量 parser 级历史 alias，当前是有意保留，不属于用户可见乱码
- `start.bat`、快捷键、viewer 菜单等窗口级手工验证还可继续补齐
- Electron stderr 中仍有 Chromium cache 权限噪音日志，当前未影响 Lite 主链功能，暂未单独治理

## 当前文档口径
本文件现在只记录当前真实状态，不再继续累积历史阶段流水账。

当前配套文档:
- `docs/lite-user-guide.md`: 面向使用与当前产品口径
- `docs/lite-regression-checklist.md`: 面向回归与验收清单
