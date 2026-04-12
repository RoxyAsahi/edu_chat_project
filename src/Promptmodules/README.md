# Promptmodules

更新时间: 2026-04-09

## 当前状态
`UniStudy` 当前只保留文本 Prompt 模式。

已保留文件:
- `original-prompt-module.js`
- `prompt-modules.css`

已移除文件:
- `modular-prompt-module.js`
- `preset-prompt-module.js`
- `prompt-manager.js`

## UniStudy 中的行为
- UniStudy 页面只显示一个文本 Prompt 编辑器
- 读取 agent 配置时，仍兼容旧字段:
  - `originalSystemPrompt`
  - `systemPrompt`
  - 旧 modular / preset 历史字段
- 保存 agent 时，统一写回:
  - `promptMode: "original"`
  - `originalSystemPrompt`
  - `systemPrompt`

## 设计目的
- 保持 UniStudy 页面和交互足够轻量
- 继续兼容旧数据结构，避免用户迁移成本
- 不再把 Prompt 三模式作为 UniStudy 的前端能力面

## 维护说明
- 若后续只做 UniStudy 维护，本目录应继续保持“单文本 Prompt”口径
- 若将来恢复更复杂 Prompt 能力，应在新方案中重新设计，不建议直接回滚到旧三模式壳层
