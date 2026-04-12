# UniStudy Electron Smoke Test

## 目标

用一套固定流程验证 UniStudy 的关键学习链路没有回归，并明确区分：

1. 临时目录 smoke
2. 显式外部 data root 测试
3. Source 检索是否真的参与了回答
4. 聊天记录是否真的落进 `history.json`
5. 左侧阅读模式下的“来源指南”是否真的成功生成并缓存

说明: 本页描述的是 `scripts/electron-unistudy-smoke.js` 的当前脚本行为与联调方法。UniStudy 应用级正式运行时的 data root override 仍以 `UNISTUDY_DATA_ROOT` 为准，本页里的脚本变量不应视为产品正式命名。

## 两种模式

### 1. 临时模式

默认模式下，脚本会把专用 fixture 复制到临时数据目录，并通过当前 smoke 脚本使用的 `UNISTUDY_DATA_ROOT` 注入给 Electron 进程；这属于脚本现状，不是应用正式运行时命名。

```powershell
node scripts/electron-unistudy-smoke.js
```

### 2. 真实数据目录模式

会直接写入你显式指定的外部数据根，例如：

- `D:\UniStudyData\UserData\<agentId>\topics\<topicId>\history.json`
- 当前 Topic 对应的 Source 文档记录
- 真实测试报告 `docs/test-reports/*.json`

运行示例：

```powershell
$env:UNISTUDY_TEST_MODE="real-data"
$env:UNISTUDY_REAL_DATA_ROOT="D:\UniStudyData"
$env:UNISTUDY_REAL_AGENT_ID="Lite_Real_Test_Nova_1775682726542"
$env:KB_BASE_URL="http://154.36.184.44:3000"
$env:KB_API_KEY="your-kb-key"
node scripts/electron-unistudy-smoke.js
```

如果当前 smoke / 联调环境也需要显式覆盖聊天服务，可以再补：

```powershell
$env:VCP_SERVER_URL="http://your-chat-endpoint/v1/chat/completions"
$env:VCP_API_KEY="your-chat-key"
```

## 脚本环境变量

以下变量仅用于当前 smoke 脚本与联调场景，不作为 UniStudy 应用级正式运行时命名。

- `UNISTUDY_TEST_MODE`
  - `temp`：临时目录 smoke
  - `real-data`：真实目录测试
- `UNISTUDY_REAL_AGENT_ID`
  - 真实模式下复用的 Agent ID
- `UNISTUDY_REAL_DATA_ROOT`
  - 必填，显式指定 smoke 脚本 real-data 模式的外部真实数据根，不等同于应用级 `UNISTUDY_DATA_ROOT`
- `UNISTUDY_TEST_FIXTURE_ROOT`
  - 可选，覆盖默认测试 fixture 根；默认使用 `tests/fixtures/runtime-data-root`
- `UNISTUDY_TEST_REPORT_DIR`
  - 可选，默认输出到 `docs/test-reports`
- `KB_BASE_URL` / `KB_API_KEY`
  - Source 检索服务配置
- `VCP_SERVER_URL` / `VCP_API_KEY`
  - 当前 smoke / 联调脚本使用的对话服务配置，不作为 UniStudy 应用级正式命名

其中，`VCP_SERVER_URL`、`VCP_API_KEY` 只应在脚本、smoke、联调说明中保留，不能提升为通用产品或应用正式运行时契约。

## 真实模式会做什么

真实模式下，脚本会在指定 Agent 下自动新建测试 Topic，并执行三轮测试：

1. 单文件测试
   - 上传 1 个带唯一编号的文本样本
   - 询问该编号对应的知识点
2. 多文件测试
   - 上传 `docs/第五届上海市青少年人工智能与编程实践活动项目手册.pdf`
   - 再上传 2 个带唯一编号的文本样本
   - 验证 PDF 和文本资料都能被准确检索
3. 中等压力测试
   - 上传 PDF + 多个 txt / md 文件
   - 连续发 3 个问题
   - 验证多来源检索与历史持久化

## 输出解读

脚本会打印一段 JSON，并额外写一份报告到 `docs/test-reports`。

重点字段：

- `mode`
  - 当前运行模式，`temp` 或 `real-data`
- `dataRoot`
  - 本次实际使用的数据目录
- `targetAgentId`
  - 真实模式下复用的 Agent
- `reportPath`
  - 已保存的测试报告路径
- `scenarios[]`
  - 每个测试场景的详细结果
- `scenarios[].historyFilePath`
  - 本轮真实聊天记录落盘位置
- `scenarios[].uploadedDocuments[]`
  - 上传文件的最终状态、chunk 数量、错误信息
- `scenarios[].retrievalAssertions[]`
  - 每条问题的检索真实性断言
- `scenarios[].guideAssertions[]`
  - 每个抽检文档的来源指南生成断言、缓存断言与错误信息
- `scenarios[].persistedAssistantKbRefs`
  - 落进 `history.json` 的最后一条助手消息引用数
- `success`
  - 所有场景都通过时为 `true`

## 检索真实性通过标准

每条测试问题都必须满足：

1. 助手消息不是 `Thinking...`
2. 助手消息存在 `kbContextRefs`
3. 回答命中了预设关键词
4. 引用文件名命中预期来源

## 来源指南通过标准

每轮抽检文档都必须满足：

1. 左侧阅读模式能打开目标文档，默认停留在 `来源指南`
2. `guide_status` 最终为 `done`
3. `guide_markdown` 非空且长度达到最低阈值
4. 指南正文命中该文档的唯一事实点
5. 再次请求同一文档指南时命中缓存，而不是重新失败或返回空内容

## 推荐手工复核

脚本跑完后，建议再手工打开 UniStudy 检查：

1. 测试 Topic 是否真实出现在目标学科下
2. Source 文档列表是否可见
3. 对话区回答是否显示 KB 引用
4. `<外部 data root>/UserData/<agentId>/topics/<topicId>/history.json` 是否存在对应消息
5. `docs/test-reports/*.json` 是否和 UI 结果一致
