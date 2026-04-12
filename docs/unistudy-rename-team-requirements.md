# UniStudy 更名阶段各组开发要求

更新时间: 2026-04-12  
适用阶段: `PR-01` 到 `PR-05`  
适用范围: `C:\VCP\Eric\VCPChatLite`

参考基线:

- `[UniStudy 更名治理契约](/C:/VCP/Eric/VCPChatLite/docs/unistudy-rename-governance.md)`
- `[UniStudy Rename PR Template](/C:/VCP/Eric/VCPChatLite/docs/unistudy-rename-pr-template.md)`
- `[UniStudy 更名并行实施启动公告](/C:/VCP/Eric/VCPChatLite/docs/unistudy-rename-kickoff-announcement.md)`

## 1. 本阶段总目标

本阶段的共同目标是完成 UniStudy 正式更名的工程化落地，具体包括:

- 产品身份统一为 `UniStudy`
- 应用级环境变量从 `VCPCHAT_*` 切换到 `UNISTUDY_*`
- 默认 `userData` 切换到 UniStudy 名字空间
- 当前生效代码、脚本、用户可见文案、人工维护文档统一为 UniStudy 口径
- 前端内部属于旧产品前缀的 `vcp-*` UI 命名迁移为 `unistudy-*` 或中性前缀

本阶段明确不做:

- 不改后端真实服务语义
- 不改 `vcpServerUrl`、`vcpApiKey`、`vcpLogUrl`、`vcpLogKey`
- 不改 `send-to-vcp`、`interrupt-vcp-request`、`vcp-stream-event`
- 不保留旧产品名运行时兼容层

## 2. 各组共同开发要求

所有开发组都必须遵守以下要求:

- 开发起点必须基于 `PR-01` 合并后的主干
- 开发前先阅读治理契约，禁止凭经验自行扩大或缩小更名范围
- 只能修改本组负责范围内的文件
- 不得顺手修复其他组范围内的命名问题
- 如果发现一个名称同时像旧品牌又像真实服务语义，先按“保留”处理，再提交给集成负责人裁决
- PR 说明必须使用统一模板
- 所有提交都必须说明:
  - 本次修改范围
  - 明确保留项
  - 风险
  - 验证方式
  - 是否触碰热点文件
- 任何涉及生成产物的改动，都必须写清楚生成方式和重建步骤

## 3. Runtime 组开发要求

### 负责 PR

- `PR-01`: Runtime Identity And Direct Cutover

### 目标

- 统一应用身份
- 切换应用级环境变量
- 切换默认数据根目录到 UniStudy
- 删除与“直接断代”冲突的旧迁移链路

### 负责范围

- `[package.json](/C:/VCP/Eric/VCPChatLite/package.json)`
- `[main.js](/C:/VCP/Eric/VCPChatLite/src/main/main.js)`
- `start.bat`
- `src/modules/main/**`

### 具体需求

- 将 `package.json.name` 收口为 UniStudy 对应包名
- 更新应用描述、启动提示、运行时日志中的旧产品口径
- 将 `VCPCHAT_DATA_ROOT` 改为 `UNISTUDY_DATA_ROOT`
- 将 `VCPCHAT_VCP_TIMEOUT_MS` 改为 `UNISTUDY_VCP_TIMEOUT_MS`
- 确保默认 `userData` 使用 UniStudy 名字空间
- 删除旧 `AppData` 自动迁移路径和相关迁移脚本入口

### 明确保留项

- `vcpServerUrl`
- `vcpApiKey`
- `vcpLogUrl`
- `vcpLogKey`
- `[vcpClient.js](/C:/VCP/Eric/VCPChatLite/src/modules/main/vcpClient.js)`
- `send-to-vcp`
- `interrupt-vcp-request`
- `vcp-stream-event`

### 禁止事项

- 不修改 `src/renderer/**`
- 不修改 `src/modules/renderer/**`
- 不修改 `docs/**`
- 不触碰 `src/preloads/runtime/*.bundle.js`

### 交付标准

- 新环境变量生效
- 旧环境变量失效
- 旧迁移链路删除方案落地
- 主进程仍可正常启动

### 自测要求

- 应用启动验证
- `UNISTUDY_DATA_ROOT` 验证
- 主流程无崩溃

## 4. Renderer 壳层组开发要求

### 负责 PR

- `PR-02`: Renderer Shell And App Namespace

### 目标

- 完成主窗口壳层、主页面入口、应用状态命名和用户可见品牌文案统一

### 负责范围

- `[renderer.js](/C:/VCP/Eric/VCPChatLite/src/renderer/renderer.js)`
- `src/renderer/**`
- `src/modules/renderer/app/**`

### 具体需求

- 统一窗口标题、主页面标题、空态文案、设置页说明、提示词编辑器说明
- 清理仍带旧产品含义的壳层 debug 名、状态入口名、fallback 元素 id 或变量名
- 将壳层级应用命名空间收口到 UniStudy

### 明确保留项

- `chatAPI`
- `utilityAPI`
- `vcpServerUrl`
- `vcpApiKey`
- 所有与 VCP 服务通道直接相关的命名

### 禁止事项

- 不修改 `[messageRenderer.js](/C:/VCP/Eric/VCPChatLite/src/modules/renderer/messageRenderer.js)`
- 不修改 `[messageRenderer.css](/C:/VCP/Eric/VCPChatLite/src/styles/messageRenderer.css)`
- 不修改 `src/modules/main/**`
- 不修改测试脚本和运行时 bundle

### 交付标准

- 主窗口壳层不再使用旧产品名作为当前正式名称
- 壳层状态入口命名统一
- 不影响消息渲染链路

### 自测要求

- 启动后页面可正常加载
- 切换常用页面和设置流程无报错
- 壳层相关文案一致

## 5. 富渲染组开发要求

### 负责 PR

- `PR-03`: Rich Rendering Namespace Cleanup

### 目标

- 完成消息渲染、viewer、流式渲染和富文本相关前端命名空间迁移

### 负责范围

- `[messageRenderer.js](/C:/VCP/Eric/VCPChatLite/src/modules/renderer/messageRenderer.js)`
- `[messageRenderer.css](/C:/VCP/Eric/VCPChatLite/src/styles/messageRenderer.css)`
- `[contentProcessor.js](/C:/VCP/Eric/VCPChatLite/src/modules/renderer/contentProcessor.js)`
- `[contentPipeline.js](/C:/VCP/Eric/VCPChatLite/src/modules/renderer/contentPipeline.js)`
- `[streamManager.js](/C:/VCP/Eric/VCPChatLite/src/modules/renderer/streamManager.js)`
- `[messageContextMenu.js](/C:/VCP/Eric/VCPChatLite/src/modules/renderer/messageContextMenu.js)`
- `text-viewer.*`

### 具体需求

- 将仅属于前端内部 UI 的 `vcp-*` class、id、custom event、style hook 迁移到 `unistudy-*` 或中性前缀
- 同步修改所有对应的 DOM 查询、事件监听、样式选择器和 viewer 页面
- 收口旧品牌占位符和渲染内品牌文案

### 明确保留项

- `send-to-vcp`
- `interrupt-vcp-request`
- `vcp-stream-event`
- 与后端协议直接绑定的 channel 名
- `vcpServerUrl`
- `vcpApiKey`

### 禁止事项

- 不修改 `[renderer.js](/C:/VCP/Eric/VCPChatLite/src/renderer/renderer.js)`
- 不修改 `src/modules/renderer/app/**`
- 不修改 `src/modules/main/**`

### 交付标准

- UI 前缀迁移成对完成
- message renderer、viewer、streaming 正常工作
- 保留服务语义命名，不误改协议

### 自测要求

- 消息渲染正常
- viewer 打开和关闭正常
- 流式消息正常更新
- 工具气泡、思维链、HTML preview、引用区正常显示

## 6. 测试工具链组开发要求

### 负责 PR

- `PR-05`: Validation, Fixtures, And Rename Guardrails

### 目标

- 将测试、脚本、夹具和自动审计体系切换到 UniStudy 基线

### 负责范围

- `tests/**`
- `scripts/**`
- `tests/fixtures/runtime-data-root/**`
- `src/preloads/runtime/**`

### 具体需求

- 更新测试中的旧应用名、旧环境变量、旧默认数据目录断言
- 更新 smoke、bridge、辅助脚本中的应用级名称和输出前缀
- 更新测试夹具中属于应用身份的旧命名
- 保持 VCP 服务配置字段不变
- 新增 rename audit，阻断旧产品身份回流
- 如 preload 源码变更，负责统一重建 runtime bundle

### 明确保留项

- `vcpServerUrl`
- `vcpApiKey`
- `vcpLogUrl`
- `vcpLogKey`
- `send-to-vcp`
- `interrupt-vcp-request`
- `vcp-stream-event`
- `[vcpClient.js](/C:/VCP/Eric/VCPChatLite/src/modules/main/vcpClient.js)` 的存在

### 禁止事项

- 不改人工文档正文
- 不改主进程或 renderer 业务实现，除非是为修正测试引用路径且已获裁决

### 交付标准

- 现有测试套件适配新命名规则
- rename audit 可用且带白名单
- runtime bundle 与源码一致

### 自测要求

- `npm test`
- `npm run test:e2e:preload-bridge`
- `npm run test:e2e:smoke`
- rename audit

## 7. 文档组开发要求

### 负责 PR

- `PR-04`: Docs, History, And Release Narrative

### 目标

- 统一当前人工维护文档的 UniStudy 口径，并整理历史材料的呈现方式

### 负责范围

- `docs/**`

### 具体需求

- 更新用户指南、开发状态、回归清单、打包说明、架构审查、运行说明
- 将仍把旧产品名当作当前正式名称的内容改为 UniStudy 口径
- 历史叙事统一采用 `UniStudy（原 VCPChat Lite）` 或等价表达
- 对 `docs/test-reports/**` 这类机器生成证据，保留原始内容，不做大规模篡改

### 明确保留项

- 机器生成证据中的历史输出
- 文中作为后端服务语义出现的 `VCP`

### 禁止事项

- 不改代码
- 不改测试夹具
- 不改运行时 bundle

### 交付标准

- 当前人工维护文档口径统一
- 历史材料处理与治理契约一致
- 发布和试运行说明可直接复用

### 自测要求

- 抽查当前文档标题、正文、命令、环境变量、示例路径是否一致
- 抽查历史材料未被误当作当前说明

## 8. 集成负责人对各组的配合要求

各组需要配合集成负责人的事项如下:

- 开发开始前提交自己的实施范围确认
- 提交 PR 时附带统一模板
- 每次 rebase 后更新“是否触碰热点文件”
- 若需增加新的白名单项，先申请裁决
- 若发现治理契约和现代码冲突，先上报，不自行扩展解释

## 9. 各组交付物要求

每个组的 PR 必须至少包含:

- 代码或文档改动
- PR 说明
- 风险说明
- 自测记录
- 未覆盖项说明

如适用，还必须包含:

- 更新后的脚本
- 更新后的测试
- 生成产物说明
- 审计清单

## 10. 阶段完成标准

本阶段完成的判断标准如下:

- `PR-01` 完成后，UniStudy 运行时身份成立
- `PR-02`、`PR-03`、`PR-04` 完成后，用户可见品牌和前端内部命名空间统一
- `PR-05` 完成后，测试与工具链对新基线完成收口
- `PR-99` 完成后，全仓收口、验证、RC 产物完成

## 11. 提交前快速检查清单

每个组提交前都要确认:

- [ ] 没有修改其他组独占文件
- [ ] 没有误改保留的 VCP 语义
- [ ] 已按治理契约处理旧产品身份命名
- [ ] 已补齐对应测试或说明
- [ ] 已写明剩余风险和待后续 PR 处理项

