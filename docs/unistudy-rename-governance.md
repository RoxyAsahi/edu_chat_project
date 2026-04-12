# UniStudy 更名治理契约

更新时间: 2026-04-12  
状态: PR-00 基线，后续更名 PR 必须遵循  
适用范围: `C:\VCP\Eric\VCPChatLite`

## 1. 背景与目标

本文件用于冻结 UniStudy 正式更名的唯一执行口径，避免多个开发组在并行实施时出现边界漂移、重复返工或误改后端服务语义。

PR-00 的目标不是立即完成全仓更名，而是先把以下事项固定下来:

- 哪些旧名称必须替换
- 哪些 `VCP` 名称必须保留
- 哪些文件由哪个开发组独占修改
- 哪些文件是并行开发的冲突热点
- 各阶段 PR 的职责、顺序、门禁和收口规则

没有本契约，后续更名 PR 不应开始大规模提交。

## 2. 本次更名范围

本次更名针对“产品身份”和“应用级命名空间”，不针对真实上游服务语义。

本次必须完成:

- 产品名称统一为 `UniStudy`
- 应用级环境变量从 `VCPCHAT_*` 切换到 `UNISTUDY_*`
- 默认 `userData` 目录切换到 UniStudy 名字空间
- 当前生效代码、启动入口、用户可见文案、人工维护文档统一为 UniStudy 口径
- 前端内部 UI/class/id/custom event/style hook 中属于旧产品前缀的 `vcp-*` 命名改为 `unistudy-*` 或中性前缀

本次明确不做:

- 不重命名真实后端服务配置字段
- 不改动仍代表后端协议/服务通道的 `VCP` 接口名
- 不保留旧产品名对应的运行时兼容层
- 不把仓库物理目录名 `C:\VCP\Eric\VCPChatLite` 纳入并行 PR 范围

## 3. 明确保留项

以下名称代表当前真实上游服务或既有协议语义，必须保留，除非未来另开独立 RFC:

- `vcpServerUrl`
- `vcpApiKey`
- `vcpLogUrl`
- `vcpLogKey`
- `send-to-vcp`
- `interrupt-vcp-request`
- `vcp-stream-event`
- `[vcpClient.js](/C:/VCP/Eric/VCPChatLite/src/modules/main/vcpClient.js)`

以下保留规则同样成立:

- 凡是直接表示 VCP 后端能力、协议、通道、日志上报、流式事件或服务适配层的命名，默认保留
- 如果一个名称同时像旧品牌又像真实后端语义，默认保留，除非它已被列入“必须替换项”
- 若需新增白名单项，必须由集成负责人裁决并补充到本文件后再执行

## 4. 明确替换项

以下名称属于旧产品身份或旧应用级命名空间，必须替换:

- `VCPChat Lite`
- `VCPChatLite`
- `vcpchat-lite`
- `VCPCHAT_DATA_ROOT`
- `VCPCHAT_VCP_TIMEOUT_MS`
- 当前产品口径下的 `Lite` 启动提示、窗口标题、文档标题、应用说明

条件性替换规则:

- `vcp-*` 仅当它表示前端内部 UI/class/id/custom event/style hook 时替换为 `unistudy-*` 或中性前缀
- `Lite` 仅当它表示产品身份时替换
- 历史脚本名、历史文档题头、机器生成证据文件名是否替换，按本契约的历史材料规则处理

## 5. 断代策略

本次更名采用“直接断代”策略。

新版本只支持:

- `UNISTUDY_DATA_ROOT`
- `UNISTUDY_VCP_TIMEOUT_MS`
- UniStudy 默认 `userData` 名字空间

旧版本不再支持:

- `VCPCHAT_DATA_ROOT`
- `VCPCHAT_VCP_TIMEOUT_MS`
- 自动迁移旧项目内 `AppData`

说明:

- 遗留迁移脚本和迁移测试列为待删除对象，由 `PR-01` 处理
- `PR-00` 仅冻结此决策，不执行删除

## 6. 非阻断历史材料范围

以下内容不作为当前更名完成的阻断项，但必须有明确口径:

- `docs/test-reports/**` 下的机器生成测试证据
- 旧计划草稿、历史分析、阶段性审计材料
- 历史产物中自带的文件名、堆栈、输出路径、老环境变量值

处理口径:

- 人工维护的历史文档尽量统一为 `UniStudy（原 VCPChat Lite）` 叙事
- 机器生成证据文件内容不做大规模篡改
- 若某份历史文档仍被当作“当前说明”，则必须更新到现口径

## 7. 并行开发分工

### Runtime 组

负责范围:

- `[package.json](/C:/VCP/Eric/VCPChatLite/package.json)`
- `[main.js](/C:/VCP/Eric/VCPChatLite/src/main/main.js)`
- `src/modules/main/**`
- `start.bat`

职责:

- 应用身份
- 数据根目录断代
- 环境变量切换
- 遗留迁移链路删除

### Renderer 壳层组

负责范围:

- `[renderer.js](/C:/VCP/Eric/VCPChatLite/src/renderer/renderer.js)`
- `src/renderer/**`
- `src/modules/renderer/app/**`

职责:

- 主窗口壳层品牌统一
- 壳层文案、标题、状态入口收口
- 壳层级应用命名空间收口

### 富渲染组

负责范围:

- `[messageRenderer.js](/C:/VCP/Eric/VCPChatLite/src/modules/renderer/messageRenderer.js)`
- `[messageRenderer.css](/C:/VCP/Eric/VCPChatLite/src/styles/messageRenderer.css)`
- `contentProcessor.js`
- `contentPipeline.js`
- `streamManager.js`
- `text-viewer.*`
- `messageContextMenu.js`

职责:

- 消息渲染命名空间迁移
- viewer 与富渲染前缀迁移
- 流式渲染 UI 前缀统一

### 测试工具链组

负责范围:

- `tests/**`
- `scripts/**`
- `tests/fixtures/runtime-data-root/**`
- `src/preloads/runtime/**`

职责:

- 自动化验证同步
- 脚本与夹具更新
- rename audit
- preload runtime bundle 重建

### 文档组

负责范围:

- `docs/**`

职责:

- 当前文档口径统一
- 历史说明整理
- 发布说明与使用说明更新

## 8. 热点文件所有权

以下文件是并行开发冲突热点，必须由单一工作流独占:

- Runtime 组独占:
  - `[package.json](/C:/VCP/Eric/VCPChatLite/package.json)`
  - `[main.js](/C:/VCP/Eric/VCPChatLite/src/main/main.js)`
- Renderer 壳层组独占:
  - `[renderer.js](/C:/VCP/Eric/VCPChatLite/src/renderer/renderer.js)`
- 富渲染组独占:
  - `[messageRenderer.js](/C:/VCP/Eric/VCPChatLite/src/modules/renderer/messageRenderer.js)`
  - `[messageRenderer.css](/C:/VCP/Eric/VCPChatLite/src/styles/messageRenderer.css)`
- 测试工具链组独占:
  - `[lite.bundle.js](/C:/VCP/Eric/VCPChatLite/src/preloads/runtime/lite.bundle.js)`
  - `[viewer.bundle.js](/C:/VCP/Eric/VCPChatLite/src/preloads/runtime/viewer.bundle.js)`

任何其他组不得越界修改上述文件，即使只是“顺手修复命名”。

## 9. 冲突禁令

为避免并行开发混乱，以下禁令立即生效:

- 禁止多组同时修改热点文件
- 禁止任何组在自己范围外顺手修复命名问题
- 禁止任何组私自扩大“保留 VCP”或“强制改 VCP”的范围
- 禁止在并行 PR 中同时混改 2 个以上热点文件
- 禁止在 `PR-05` 之后继续新增“顺手命名收尾”

若发生冲突:

- 修改越界的 PR 必须回退到所属组处理
- 若代码与文档口径冲突，以本契约和已合并主干代码为准

## 10. 分阶段 PR 清单

| PR | 标题 | 负责组 | 目标 |
| --- | --- | --- | --- |
| PR-00 | Governance: Freeze UniStudy Rename Contract | 集成负责人 | 冻结口径、边界、顺序、门禁 |
| PR-01 | Runtime Identity And Direct Cutover | Runtime 组 | 应用身份、数据根目录、环境变量断代 |
| PR-02 | Renderer Shell And App Namespace | Renderer 壳层组 | 主窗口壳层、产品文案、壳层状态统一 |
| PR-03 | Rich Rendering Namespace Cleanup | 富渲染组 | 消息渲染、viewer、流式前缀统一 |
| PR-04 | Docs, History, And Release Narrative | 文档组 | 当前文档统一与历史材料整理 |
| PR-05 | Validation, Fixtures, And Rename Guardrails | 测试工具链组 | 测试、脚本、夹具、审计与 bundle 重建 |
| PR-99 | Final Stabilization And Release Candidate | 集成负责人 | 最终扫尾、全量验证、RC 收口 |

## 11. 合并顺序

固定顺序如下:

`PR-00 -> PR-01 -> (PR-02 / PR-03 / PR-04 并行) -> PR-05 -> PR-99`

补充规则:

- 所有并行组必须从 `PR-01` 合并后的主干拉分支
- `PR-05` 可提前准备，但只能在前面功能 PR 接近稳定后 rebase 合并
- `PR-99` 仅允许集成负责人提交

## 12. 集成负责人门禁

### PR-01 门禁

- 新环境变量和数据根目录规则成立
- 旧迁移路径删除方案落地

### PR-02 门禁

- 不触碰 `[messageRenderer.js](/C:/VCP/Eric/VCPChatLite/src/modules/renderer/messageRenderer.js)`
- 壳层产品名统一

### PR-03 门禁

- 不触碰 `[renderer.js](/C:/VCP/Eric/VCPChatLite/src/renderer/renderer.js)`
- 渲染前缀迁移成对完成

### PR-04 门禁

- 当前文档口径统一
- 历史材料处理符合本契约

### PR-05 门禁

- 自动化检查通过
- rename audit 存在且白名单明确

### PR-99 门禁

- 全仓扫尾完成
- RC 构建验证通过

## 13. 验收门槛

PR-00 完成后，必须达到以下状态:

- 任一开发组仅靠本文件即可明确:
  - 自己改什么
  - 自己不能改什么
  - 依赖谁先合并
  - 遇到歧义找谁裁决
- 本文件中至少存在:
  - 一份“允许保留旧名”的清单
  - 一份“必须替换旧名”的清单
  - 一份热点文件锁定清单
  - 一份合并顺序与门禁清单

后续任一组无需再重新讨论命名边界。

## 14. 风险与升级路径

当前最可能出现的风险:

- 误把 VCP 后端语义当作旧品牌一起改掉
- 多组同时修改热点文件导致冲突
- 测试工具链和文档更新晚于代码，造成口径漂移
- preload runtime bundle 与源码不同步

升级路径:

- 若发现白名单不足，由集成负责人补充到本契约
- 若发现某个 PR 同时触发 2 个以上热点文件，拆分为后续 PR
- 若发现历史材料仍被当作当前说明，升级到 `PR-04` 阻断项

## 15. 集成负责人执行公告

`PR-00` 合并后，集成负责人应向各组下发以下执行口令:

1. 基于 `PR-01` 合并后的最新主干创建各自分支。
2. 不越界修改热点文件。
3. 所有歧义命名先对照本契约。
4. 需要新增白名单项时，先申请裁决再提交代码。
5. `PR-05` 前不允许扩大范围做额外命名整治。

推荐配套文档:

- `[UniStudy Rename PR Template](/C:/VCP/Eric/VCPChatLite/docs/unistudy-rename-pr-template.md)`
- `[UniStudy Rename Kickoff Announcement](/C:/VCP/Eric/VCPChatLite/docs/unistudy-rename-kickoff-announcement.md)`

## 16. 集成负责人的日常检查项

- 每个 PR 是否越界修改他组独占文件
- 是否误改保留的 `VCP` 语义
- 是否引入新的旧产品名残留
- 是否遗漏测试同步
- 是否需要 preload runtime bundle 重建
- 文档是否仍宣称旧产品名为当前正式名称

## 17. 统一验证矩阵

本次更名最终由集成负责人组织统一验证:

- `npm test`
- `npm run test:e2e:preload-bridge`
- `npm run test:e2e:smoke`
- `npm run pack:win`
- 仓库级 rename audit

最终 RC 需验证:

- UniStudy 默认数据目录
- `UNISTUDY_DATA_ROOT`
- UI 与文档品牌一致性
- `VCP` 后端配置持续可用
- 消息渲染、viewer、streaming 正常

