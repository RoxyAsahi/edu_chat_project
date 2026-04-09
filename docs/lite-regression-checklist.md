# VCPChat Lite 回归测试清单

更新时间: 2026-04-09
适用仓库: `C:\VCP\Eric\VCPChatLite`

## 1. 启动与窗口
- [x] `npm start` 可拉起 Electron
- [x] `start.bat` 可正常启动
- [x] 主窗口标题显示为 `VCPChat Lite`
- [x] Electron 主入口已切到 `src/main/main.js`
- [x] 主页面已切到 `src/renderer/index.html`
- [ ] `F5` 可刷新
- [ ] `Ctrl+R` 可刷新
- [ ] `Ctrl+Shift+R` 可强制刷新
- [ ] `Ctrl+Shift+I` 可打开 DevTools

## 2. 数据切线
- [x] Lite 正式数据根固定为 `C:\VCP\Eric\VCPChatLite\AppData`
- [x] Lite 不再自动从 `C:\VCP\Eric\VCPChat\AppData` seed copy
- [x] Lite `AppData` 中存在两组测试 agents 与对应 `UserData`
- [x] `settings.json` 的 `lastOpenItemId / lastOpenTopicId / agentOrder` 已指向 Lite 仓自己的测试数据

## 3. Agent / Topic 基本链路
- [x] 可读取现有 agents
- [x] 可加载现有 topics
- [x] 可读取现有 `history.json`
- [x] 选择 agent 正常
- [x] topic 切换正常
- [x] 打开当前 topic 后自动收敛为已读
- [x] 新建 topic 正常
- [x] topic 重命名正常
- [x] topic 删除正常
- [x] 删除当前 topic 后可切到合法 topic
- [x] topic 锁定 / 解锁正常
- [x] 标记未读 / 已读正常

## 4. 页内弹窗交互
- [x] 点击 `Agents > New` 立刻出现 Lite 页内输入弹窗
- [x] 点击 `Topics > New` 立刻出现 Lite 页内输入弹窗
- [x] 点击 topic `Rename` 出现带默认值的 Lite 页内输入弹窗
- [x] 空输入不会提交，弹窗内会显示错误提示
- [x] `Esc` 可取消输入弹窗
- [x] topic `Delete` 使用 Lite 页内确认弹窗
- [x] agent `Delete` 使用 Lite 页内确认弹窗
- [x] 新建 Agent 成功后自动选中新 agent
- [x] 新建 topic 成功后自动切到新 topic
- [x] 未选中 agent 时点击 `Topics > New` 会提示 `Choose an agent first.`

## 5. 单聊发送链路
- [x] 真实接口发送正常
- [x] 流式增量渲染正常
- [x] 中断请求正常
- [x] 非流式回退正常
- [x] 重启后历史仍可正常加载
- [x] `run-vcp-recovery-e2e.js` normal stream 通过
- [x] `run-vcp-recovery-e2e.js` interrupt 通过
- [x] `run-vcp-recovery-e2e.js` server error 通过
- [x] `run-vcp-recovery-e2e.js` timeout 通过
- [x] `run-vcp-recovery-e2e.js` non-stream 通过

## 6. 附件链路
- [x] 文件选择可加入 composer
- [x] 粘贴图片 / 文件可加入 composer
- [x] 拖拽文件可加入 composer
- [x] 发送后 history 保存为中心化附件对象
- [x] history 附件包含 `internalPath`
- [x] 重启后旧消息中的图片仍可渲染
- [x] 重启后旧消息中的附件仍可打开
- [x] markdown 导出优先输出中心化附件路径

## 7. 设置与 Prompt
- [x] 设置页只显示文本 Prompt 编辑器
- [x] 旧 modular / preset 字段可被读取为有效文本
- [x] 保存后统一写回 `promptMode: "original"`
- [x] 保存后 `originalSystemPrompt` 与 `systemPrompt` 同步更新
- [x] 全局设置可保存
- [x] Agent 设置可保存

## 8. 渲染能力
- [x] Markdown 渲染正常
- [x] 代码块高亮正常
- [x] 图片渲染正常
- [x] KaTeX 渲染正常
- [x] Mermaid 渲染正常
- [x] Pretext 渲染正常

## 9. 解耦与删除验证
- [x] 主入口和 preload 不再依赖旧仓 `AppData`
- [x] 活链中不再保留 group 聚合和旧壳层产品分支
- [x] 仅 viewer 类资源作为辅助窗口保留
- [x] 无主入口、无 preload、无 renderer 引用的旧模块已删除

## 10. 本轮保留测试数据
- [x] `Lite_Real_Test_Nova_1775682726542`
- [x] `_Agent_1775676053834_1775676053836`

## 11. 乱码与 Lite-only 数据根
- [x] `src/modules/renderer/messageRenderer.js` 已修复迁移期结构损坏
- [x] `src/modules/renderer/streamManager.js` 已修复迁移期结构损坏
- [x] `src/modules/renderer/emoticonUrlFixer.js` 可正常导入
- [x] `src/modules/renderer/text-viewer.js` 已收口为内部兼容归一化
- [x] `src/modules/renderer/text-viewer.html` 残留乱码注释已改为英文
- [x] 主窗口可见文本不出现 mojibake
- [x] 错误提示与 toast 不出现 mojibake
- [x] 附件 title / tooltip 不出现 mojibake
- [x] text viewer 不再显示旧 Notes 入口
- [x] text viewer 默认标题、菜单和兜底文案已恢复为正常中文
- [x] `.editorconfig` 已落地，源码与文档默认按 UTF-8 保存
- [x] `.gitattributes` 已落地，源码文本行尾策略已固定
- [x] Lite 根目录下只保留一个正式 `AppData`
- [x] 不存在尾空格脏目录 `AppData `
- [x] 保存设置后不再回写旧壳层字段
- [x] `settings.json.backup` 已同步为 Lite-only 结构
- [x] `settings.json` / `.backup` 已去除 BOM，真实写回不再触发 `JSON.parse` 错误

## 12. src 化与根目录治理
- [x] 正式源码已统一迁入 `src/`
- [x] `src/modules/` 已拆分为 `main / shared / renderer`
- [x] `src/modules/main/ipc/*` 已作为正式 main-process IPC 目录
- [x] `src/modules/renderer/messageRenderer.js` 已作为正式 renderer 渲染核心
- [x] `src/modules/renderer/text-viewer.* / image-viewer.*` 已切到新目录
- [x] 根目录不再散落一次性修补脚本
- [x] 历史一次性脚本已归档到 `tools/legacy/`
- [x] `.tmp/` 已作为统一调试产物目录
- [x] `scripts/` 仅保留长期运行脚本
- [x] `desktopremote-http-smoke.js` 已移出正式 `scripts/`
- [x] `src/modules/DASP.txt` 已删除
- [x] `src/modules/renderer/enhancedColorUtils.js` 已删除

备注:
- 当前回归以 Lite 自己的 `AppData` 为准，旧仓数据目录不再参与运行时读写
- 真实联通测试模型继续使用 `gemini-3.1-flash-lite-preview`
- Electron 启动 smoke 已确认日志显示 `Using Lite AppData only.`
