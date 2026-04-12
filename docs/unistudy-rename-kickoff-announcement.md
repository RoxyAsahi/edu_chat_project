# UniStudy 更名并行实施启动公告

适用时机: `PR-00` 合并后，由集成负责人发送给各开发组

## 公告正文

UniStudy 更名治理契约已在 `PR-00` 冻结，后续更名工作统一按以下规则执行:

1. 所有开发组必须先阅读 `[UniStudy Rename Governance](/C:/VCP/Eric/VCPChatLite/docs/unistudy-rename-governance.md)`。
2. 所有并行开发组必须基于 `PR-01` 合并后的最新主干创建分支。
3. 不允许越界修改热点文件。
4. 所有命名歧义以治理契约为准，不再口头扩展解释。
5. 如需新增白名单项，先申请裁决，再提交代码。

## PR 编号归属

- `PR-01`: Runtime Identity And Direct Cutover
- `PR-02`: Renderer Shell And App Namespace
- `PR-03`: Rich Rendering Namespace Cleanup
- `PR-04`: Docs, History, And Release Narrative
- `PR-05`: Validation, Fixtures, And Rename Guardrails
- `PR-99`: Final Stabilization And Release Candidate

## 热点文件锁定

以下文件仅允许所属工作流修改:

- Runtime 组:
  - `[package.json](/C:/VCP/Eric/VCPChatLite/package.json)`
  - `[main.js](/C:/VCP/Eric/VCPChatLite/src/main/main.js)`
- Renderer 壳层组:
  - `[renderer.js](/C:/VCP/Eric/VCPChatLite/src/renderer/renderer.js)`
- 富渲染组:
  - `[messageRenderer.js](/C:/VCP/Eric/VCPChatLite/src/modules/renderer/messageRenderer.js)`
  - `[messageRenderer.css](/C:/VCP/Eric/VCPChatLite/src/styles/messageRenderer.css)`
- 测试工具链组:
  - `[lite.bundle.js](/C:/VCP/Eric/VCPChatLite/src/preloads/runtime/lite.bundle.js)`
  - `[viewer.bundle.js](/C:/VCP/Eric/VCPChatLite/src/preloads/runtime/viewer.bundle.js)`

## 执行要求

- 各组 PR 说明必须使用 `[UniStudy Rename PR Template](/C:/VCP/Eric/VCPChatLite/docs/unistudy-rename-pr-template.md)`。
- `PR-05` 前禁止扩大范围做顺手命名修复。
- `PR-02`、`PR-03`、`PR-04` 接近完成时，统一参加一次命名一致性复查。
- 所有最终验证以 `PR-99` 的集成结果为准。

## 集成看板字段

每个 PR 必须维护以下字段:

- PR 编号
- 负责组
- 依赖 PR
- 当前状态
- 是否触碰热点文件
- 是否需要 preload 重建
- 是否需要文档复核

