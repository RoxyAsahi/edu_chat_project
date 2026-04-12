# Promptmodules 说明更新

更新时间: 2026-04-09

## 说明
本文件原先记录的是旧 VCPChat 三模式 Prompt 系统的改进内容。

由于 `UniStudy` 已收敛为单文本 Prompt 模式，这些历史改进记录不再对应当前 UniStudy 运行形态。

## UniStudy 当前结论
- UniStudy 仅保留 `OriginalPromptModule`
- UniStudy 不再暴露 modular / preset Prompt UI
- UniStudy 仍兼容读取旧 Prompt 字段，但不再维护旧三模式的交互说明

## 后续建议
- 若需要继续记录 UniStudy Prompt 相关改动，请直接写入:
  - `docs/development-progress.md`
  - `docs/lite-user-guide.md`
  - `docs/lite-regression-checklist.md`
