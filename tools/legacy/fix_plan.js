const fs = require('fs');
let plan = fs.readFileSync('.kilo/plans/1775683404518-happy-wolf.md', 'utf8');

const phase9 = `
## 阶段 9：跃升至 Material 3 Expressive (去线留白、非对称与纯粹色块)
- **解决图标加载失败问题 (Fallback 兜底)**：
  - 截图显示 \`send\` 按钮渲染为了文字，这通常是因为网络原因导致 Google Fonts 的 Material Symbols 没有加载成功。方案：为了绝对稳定，我们将几个核心图标（\`Send\`, \`Attach\`, \`Settings\`, \`Theme\`, \`Add\`, \`Tune\`, 空状态图标等）直接替换为 **内联 SVG (Inline SVG)**。
- **无边框化 (Borderless) 与去线留白**：
  - 贯彻“去线留白”规范：移除全局所有的 \`border: 1px solid var(--line)\`，包括所有面板 (Panels)、卡片 (Cards)、输入框 (Inputs) 和主题头部 (Header)。
  - 深度依赖 **动态对比 (Dynamic Contrast)**：通过底层 \`--paper\` 颜色与表层 \`--panel\` 颜色的极微弱差异（如白与浅灰），辅以弥散的 \`--shadow-elevation-1\`（流光阴影），来确立视觉层级。
- **超大圆角与自适应布局 (Shape Scale & Adaptive)**：
  - **Panels 和 Composer**：圆角从现有的 \`24px\` 激进提升到 **\`32px\`** (Fully Circular 风格)，让界面呈现“流体”的亲和感。
  - **内部 Cards 和 Lists**：圆角提升到 **\`20px\`**，使所有可交互元素都像一个浑圆的果冻块。
  - **左侧导航栏重组 (Navigation Suite)**：不再使用两个僵硬的白色 Panel 包裹 Agents 和 Topics。我们将去除这两个外层容器的白色背景和阴影，让列表项直接悬浮在底色 \`--paper\` 上（或者给每个列表项独立的胶囊背景），这才是真正的“以内容为容器”。
- **右侧 Bento Grid 的极致表现力 (Expressive)**：
  - 加深马卡龙背景色的饱和度/亮度对比，去除所有多余的 padding 留白（让色块更纯粹）。
  - 让每个便当盒成为一个独立漂浮的、完全没有边线的“岛屿”。
- **输入框交互 (Predictive/Soft Interaction)**：
  - 所有的 Input 失去默认的描边，在平常状态下仅仅是一块微弱的凹陷色块 (\`rgba(0,0,0,0.03)\`)，只有 \`focus\` 时才会泛起主题色光晕 (\`box-shadow\`)。

1. **无需更改主进程逻辑**：`;

plan = plan.replace('1. **无需更改主进程逻辑**：', phase9);
fs.writeFileSync('.kilo/plans/1775683404518-happy-wolf.md', plan, 'utf8');
console.log('Plan updated with Phase 9');
