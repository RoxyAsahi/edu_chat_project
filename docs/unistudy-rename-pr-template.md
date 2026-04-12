# UniStudy Rename PR Template

适用范围: `PR-01`、`PR-02`、`PR-03`、`PR-04`、`PR-05`、`PR-99`

## 基本信息

- PR 编号:
- PR 标题:
- 负责组:
- 负责人:
- 依赖 PR:
- 是否触碰热点文件:

## 本 PR 目标

- 本 PR 解决的问题:
- 本 PR 明确不解决的问题:

## 修改范围

- 允许修改的目录:
- 本次实际修改的核心文件:
- 是否触碰独占文件:

## 明确保留项

列出本 PR 中刻意保留、不得误改的名称或接口:

- `vcpServerUrl`
- `vcpApiKey`
- `vcpLogUrl`
- `vcpLogKey`
- `send-to-vcp`
- `interrupt-vcp-request`
- `vcp-stream-event`

如有新增保留项，必须说明裁决来源。

## 风险

- 可能影响的模块:
- 可能引入的回归:
- 是否影响其他并行组:

## 验证项

- 本 PR 自测命令:
- 关键手工验证:
- 是否需要全量回归:
- 是否需要 preload runtime bundle 重建:

## 交付检查

- [ ] 未越界修改他组独占文件
- [ ] 未误改保留的 VCP 语义
- [ ] 已按治理契约处理旧产品名
- [ ] 已同步相关测试或文档
- [ ] 如涉及生成产物，已说明生成方式

