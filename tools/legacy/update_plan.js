const fs = require('fs');
let plan = fs.readFileSync('.kilo/plans/1775683404518-happy-wolf.md', 'utf8');

const newSection = `
## 阶段 6：UI 细节精修与 Bug 修复 (基于截图反馈)
- **左侧 Sidebar (导航/历史)**：
  - 修复 Topic 列表头部按钮（New Topic, Export）的挤压问题，优化纵向空间分布。
  - 修复 Topic 列表项内部的排版，确保日期、状态和操作按钮横向对齐或优雅折叠，避免现有的错位叠加。
  - 统一 Agent 和 Topic 卡片的内部滚动条样式，使其更细、更符合 MD3 规范。
- **右侧 Studio (设置/Bento)**：
  - 修复 \`Profile\` 卡片中输入框（Name, Model）宽度被过度压缩的问题，调整 \`grid-template-columns\` 占比。
  - 美化头像上传控件（原生的 \`<input type="file">\` 非常破坏视觉），将其隐藏，改为点击头像直接触发上传。
  - 修复设置面板头部（Agent Settings 标题与 Delete 按钮）的排版冲突。
  - 调整各参数卡片（Parameters）中 input 输入框的内边距和高度，去除多余外边距，使其更紧凑、协调。
  - 修复原生滚动条过粗的问题，全局应用自定义的细长圆角滚动条（半透明灰/白）。
- **中间 Chat Stage (对话/输入)**：
  - 优化悬浮输入框 (Composer) 的内部比例：统一 Attach 和 Send 按钮的高度与视觉比重，使 Attach 按钮呈现完美的圆形或与 Send 匹配的药丸形。
  - 调整 textarea 的行高和 padding，确保占位符 (placeholder) 垂直居中。

## 执行步骤与风险`;

plan = plan.replace('## 执行步骤与风险', newSection);
fs.writeFileSync('.kilo/plans/1775683404518-happy-wolf.md', plan, 'utf8');
console.log("Plan updated");
