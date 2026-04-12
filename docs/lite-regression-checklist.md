# UniStudy 回归测试清单

更新时间: 2026-04-13
适用仓库: `C:\VCP\Eric\VCPChatLite`

## 自动化入口
- `npm run test:main`
  覆盖 settings schema / repository 恢复与并发 / IPC guard / preload 契约
- `npm run test:renderer`
  覆盖 renderer sanitize / text viewer HTML sanitize
- `npm run test:e2e:controlled`
  覆盖窗口快捷键、受控 viewer 流程、topic Source 绑定、watcher guard
- `npm test`
  串行执行上述三层测试

## 仍需手工确认的体验项

### 1. 启动与视觉
- [ ] 主窗口标题、品牌文案、图标与 UniStudy 当前视觉一致
- [ ] 标题栏按钮 hover / active / danger 态正常
- [ ] 桌面宽度变化时左右栏布局不抖动、不重叠

### 2. 聊天与渲染观感
- [ ] Markdown、代码块、公式、Mermaid、图片的视觉样式符合预期
- [ ] 流式输出时动画、滚动、气泡宽度和字体观感正常
- [ ] viewer / image viewer 的主题切换、标题栏与关闭按钮体验正常

### 3. 资料与阅读体验
- [ ] Source 列表空态、加载态、错误态文案自然
- [ ] 来源指南与原文阅读区的切换、分页、返回操作观感正常
- [ ] 资料卡片、tooltip、操作菜单没有错位或截断

### 4. 输入与弹窗体验
- [ ] 页内输入弹窗与确认弹窗的焦点、Esc、错误提示体验自然
- [ ] 附件拖拽、粘贴、选择后的预览与移除交互符合预期
- [ ] 设置页滚动、保存反馈、分区切换没有明显卡顿或错位

## 备注
- 安全/持久化/IPC/快捷键等边界回归已转为自动化保护，不再重复写入手工 checklist
- 当前回归以 UniStudy 运行时数据目录为准；默认使用 Electron `userData`，如需显式覆盖只使用 `UNISTUDY_DATA_ROOT`
- 真实联通测试模型继续使用 `gemini-3.1-flash-lite-preview`
