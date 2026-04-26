# UniStudy 回归测试清单

更新时间: 2026-04-27
适用仓库: `C:\VCP\Eric\edu_chat_project`

## 自动化入口
- `npm run test:main`
  覆盖 settings schema / repository 恢复与并发 / IPC guard / preload 契约
- `npm run test:renderer`
  覆盖 renderer 架构守护、流式渲染、HTML / Three preview、Source / Notes、history diff sync、visibility optimizer 与 DOM sanitize
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
- [ ] 裸 HTML / SVG 片段在流式阶段直接渲染为可交互内容，不先退化成长段源码
- [ ] HTML 代码块的播放 / 返回切换、iframe 高度回传和错误提示正常
- [ ] Three.js 代码块预览能显示 canvas；vendor、WebGL 或脚本失败时有可见诊断
- [ ] 工具请求文本可正常流式显示，完成后再美化为对应工具块
- [ ] viewer / image viewer 的主题切换、标题栏与关闭按钮体验正常

### 3. 资料与阅读体验
- [ ] Source 列表空态、加载态、错误态文案自然
- [ ] 来源指南与原文阅读区的切换、分页、返回操作观感正常
- [ ] 资料卡片、tooltip、操作菜单没有错位或截断

### 4. 输入与弹窗体验
- [ ] 页内输入弹窗与确认弹窗的焦点、Esc、错误提示体验自然
- [ ] 附件拖拽、粘贴、选择后的预览与移除交互符合预期
- [ ] 头像裁剪器反复选择、取消、确认后没有残留旧预览或明显内存增长
- [ ] 设置页滚动、保存反馈、分区切换没有明显卡顿或错位

### 5. 长对话与历史同步
- [ ] 长对话滚动时离屏动画、media、canvas、Three.js 内容暂停 / 恢复自然
- [ ] 外部修改当前 `history.json` 时，前端只更新受影响消息，不整页闪烁
- [ ] AI 正在流式输出时，外部历史变动不覆盖当前流式气泡

## 备注
- 安全/持久化/IPC/快捷键等边界回归已转为自动化保护，不再重复写入手工 checklist
- 当前回归以 UniStudy 运行时数据目录为准；默认使用 Electron `userData`，如需显式覆盖只使用 `UNISTUDY_DATA_ROOT`
- 真实联通测试模型继续使用 `gemini-3.1-flash-lite-preview`
