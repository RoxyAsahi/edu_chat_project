# VCPChatLite Standalone Dependency Audit

更新时间: 2026-04-11
适用仓库: `C:\VCP\Eric\VCPChatLite`

## 核心结论
- 当前仓库没有发现对 `VCPToolBox` 源码目录的直接引用。
- 当前真正的耦合点不是代码引用，而是 VCP 生态提供的远端协议、提示词变量语义和部分兼容数据目录。
- 本次落地先把最关键的隐式依赖显式化：
  - 新增本地提示词变量解析层
  - 新增上游能力描述模块
  - 明确数据目录的保留 / 本地接管 / 可废弃分类

## 运行依赖矩阵
| 能力 | 当前来源 | 是否阻断基础运行 | 当前状态 |
| --- | --- | --- | --- |
| Chat | `vcpServerUrl` -> `/v1/chat/completions` | 是 | 仍依赖兼容 OpenAI Chat Completions 的上游 |
| Stream | Chat 响应体流式输出 | 是 | 与 Chat 同链路 |
| Interrupt | `/v1/interrupt` | 否，存在本地 abort 回退 | 已显式建模为 local-first / remote-best-effort |
| Embeddings | `kbBaseUrl` -> `/v1/embeddings` | 否，影响 KB | 仍依赖远端服务 |
| Rerank | `kbBaseUrl` -> `/v1/rerank` | 否，影响 KB | 仍依赖远端服务 |
| Guide Generation | 复用 Chat | 否，影响 KB 指南 | 仍依赖远端 Chat |

能力描述代码位于:
- [promptVariableResolver.js](/C:/VCP/Eric/VCPChatLite/src/modules/main/utils/promptVariableResolver.js)
- [upstreamCapabilities.js](/C:/VCP/Eric/VCPChatLite/src/modules/main/utils/upstreamCapabilities.js)

## 提示词语义接管
### 已接管
- `{{VarDivRender}}`
  - 现在由 Lite 本地解析成明确的渲染要求文本，不再把黑盒 token 直接交给上游。
- `{{Nova}}` 这类 ASCII agent alias
  - 当前支持三类来源:
    - 显式变量: `promptVariables` / `variables` / `promptVariableEntries`
    - agent alias 列表: `aliases`
    - agent 名称导出的别名: 例如 `Lite Real Test Nova` 可导出 `Nova`

### 当前策略
- 变量优先级: 显式变量 > 内建变量 > agent 名称导出别名
- 未命中变量: 保留原始 token，并记录 `unresolvedTokens`
- 当前内建变量:
  - `AgentId`
  - `AgentName`
  - `TopicId`
  - `TopicName`
  - `UserName`
  - `Model`
  - `VarDivRender`

### 后续建议
- 若要兼容更复杂的上游 persona 宏，不要继续扩展隐式约定，优先在 agent config 中增加显式变量表。

## 生态数据兼容清单
### 保留
- Agent 配置与 Topic 历史
- `settings.json`
- `UserData/`
- Knowledge Base 数据目录

### 本地接管
- Prompt 变量解析
- `VarDivRender` 渲染注入语义
- 上游能力描述和依赖矩阵

### 可降级
- `generated_lists`
  - 当前仅影响表情库生成，缺失时应降级而不是阻断主流程

### 可废弃候选
- `vcpLogUrl`
- `vcpLogKey`

当前仓库内只在设置 schema 中保留这两个字段，尚未发现实际消费逻辑。移除前建议先保留读取兼容，再安排一次设置迁移。
