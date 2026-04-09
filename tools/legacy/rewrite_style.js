const fs = require('fs');
const css = `
@font-face {
  font-family: 'MavenProExtraBold';
  src: url('./assets/font/MavenPro-ExtraBold.ttf') format('truetype');
}

:root {
  --paper: #f0f4f9;
  --ink: #1f1f1f;
  --muted: #444746;
  --panel: #ffffff;
  --panel-strong: #f8fafd;
  --line: rgba(0, 0, 0, 0.06);
  --accent: #0b57d0;
  --accent-strong: #0842a0;
  --accent-soft: #d3e3fd;
  --shadow-elevation-1: 0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1);
  --shadow-elevation-2: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1);
  
  --macaron-blue: #e8f0fe;
  --macaron-green: #e6f4ea;
  --macaron-purple: #f3e8fd;
  --macaron-yellow: #fef7e0;

  --lite-chat-max-width: 92%;
  --lite-chat-font: 'Segoe UI', 'PingFang SC', sans-serif;
  --lite-code-font: 'Cascadia Code', 'Consolas', monospace;
}

body.dark-theme {
  --paper: #131314;
  --ink: #e3e3e3;
  --muted: #c4c7c5;
  --panel: #1e1e20;
  --panel-strong: #282a2c;
  --line: rgba(255, 255, 255, 0.08);
  --accent: #a8c7fa;
  --accent-strong: #d3e3fd;
  --accent-soft: rgba(168, 199, 250, 0.16);
  --shadow-elevation-1: 0 1px 3px 0 rgba(0,0,0,0.3);
  --shadow-elevation-2: 0 4px 6px -1px rgba(0,0,0,0.4);

  --macaron-blue: rgba(138, 180, 248, 0.08);
  --macaron-green: rgba(129, 201, 149, 0.08);
  --macaron-purple: rgba(197, 138, 249, 0.08);
  --macaron-yellow: rgba(253, 214, 99, 0.08);
}

* { box-sizing: border-box; }
html, body {
  margin: 0;
  min-height: 100%;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--lite-chat-font);
}
body { overflow: hidden; }
button, input, textarea, select { font: inherit; color: inherit; }
button { cursor: pointer; touch-action: manipulation; }
textarea, input, select {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: transparent;
  padding: 12px 14px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}
textarea:focus, input:focus, select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.window-shell { height: 100vh; display: grid; grid-template-rows: 64px 1fr; overflow: hidden; }
.titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 24px;
  background: var(--paper);
  user-select: none;
  -webkit-app-region: drag;
}
.titlebar button { -webkit-app-region: no-drag; }
.titlebar__brand, .titlebar__meta { display: flex; align-items: center; gap: 12px; min-width: 0; }
.titlebar__meta > * { flex-shrink: 0; }
.brand-mark {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-family: 'MavenProExtraBold', sans-serif;
  background: var(--accent);
  color: white;
}
.titlebar__title {
  font-weight: 600;
  font-size: 16px;
  letter-spacing: 0.02em;
}
.titlebar__subtitle {
  color: var(--muted);
  font-size: 12px;
}

.layout {
  min-height: 0;
  width: 100%;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr) auto;
  gap: 20px;
  padding: 0 20px 20px;
  overflow: hidden;
}

.sidebar {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
}
.panel {
  background: var(--panel);
  border-radius: 24px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: var(--shadow-elevation-1);
  min-height: 0;
  overflow: hidden;
}
.panel--agents { flex: 0 0 40%; }
.panel--topics { flex: 1 1 60%; }

.panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.panel__header--stacked { align-items: flex-start; }
.panel__actions, .chat-stage__header-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.chat-stage {
  min-width: 0;
  background: var(--panel);
  border-radius: 24px;
  box-shadow: var(--shadow-elevation-1);
  display: grid;
  grid-template-rows: auto 1fr;
  overflow: hidden;
  position: relative;
}
.chat-stage__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--line);
}
.chat-messages-container {
  min-height: 0;
  overflow: auto;
  padding: 24px 24px 120px; /* space for composer */
}
.chat-messages { display: flex; flex-direction: column; gap: 24px; }

.settings-panel {
  width: 380px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 0;
  overflow: auto;
  transition: width 0.3s cubic-bezier(0.2, 0, 0, 1), opacity 0.2s ease, margin 0.3s ease;
}
.settings-panel.settings-panel--collapsed {
  width: 0;
  min-width: 0;
  opacity: 0;
  overflow: hidden;
  margin-left: -20px; /* pull layout tight */
  pointer-events: none;
}

.eyebrow { margin: 0 0 4px; color: var(--accent); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; }
h1, h2, h3, p { margin: 0; }
.panel h2, .chat-stage h1, .settings-card h3 { font-size: 18px; font-weight: 600; }
.search-input { border-radius: 20px; padding: 10px 16px; background: var(--paper); border-color: transparent; }

/* Lists */
.list { list-style: none; margin: 0; padding: 0 4px 0 0; overflow: auto; display: flex; flex-direction: column; gap: 4px; }
.list-item {
  cursor: pointer;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 10px;
  border-radius: 12px;
  background: transparent;
  transition: background 0.2s;
}
.list-item:hover { background: var(--paper); }
.list-item.active { background: var(--accent-soft); }
.avatar { width: 40px; height: 40px; border-radius: 12px; object-fit: cover; }
.list-item__body { min-width: 0; overflow: hidden; display: flex; flex-direction: column; gap: 2px; }
.list-item__title { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.list-item__meta, .settings-caption, .topic-lock { font-size: 12px; color: var(--muted); }
.badge { min-width: 30px; text-align: center; color: transparent; font-weight: 700; }
.badge--active { color: var(--accent); }
.badge--active::before { content: '• '; }
.topic-item { grid-template-columns: minmax(0, 1fr) auto; align-items: flex-start; }
.topic-item__main { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.topic-item__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.topic-item__meta-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.topic-statuses { display: flex; gap: 6px; flex-wrap: wrap; }
.topic-status {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 2px 6px;
  font-size: 11px;
  color: var(--muted);
}
.topic-status--unread { color: var(--accent-strong); border-color: transparent; background: var(--accent-soft); }
.topic-actions { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; opacity: 0; transition: opacity 0.2s; }
.list-item:hover .topic-actions { opacity: 1; }
.topic-action-btn {
  border: none;
  border-radius: 8px;
  padding: 6px;
  background: var(--paper);
  color: var(--muted);
}
.topic-action-btn:hover { background: rgba(0,0,0,0.05); color: var(--ink); }
body.dark-theme .topic-action-btn:hover { background: rgba(255,255,255,0.1); }
.topic-action-btn--danger:hover { color: #d93025; background: rgba(217, 48, 37, 0.1); }

/* Buttons */
.ghost-button, .accent-button, .window-button {
  border: none;
  border-radius: 20px;
  padding: 8px 16px;
  font-weight: 500;
  font-size: 14px;
  transition: background 0.2s, color 0.2s;
}
.ghost-button { background: transparent; color: var(--accent); }
.ghost-button:hover { background: var(--accent-soft); }
.ghost-button--danger { color: #d93025; }
.ghost-button--danger:hover { background: rgba(217, 48, 37, 0.1); }
.accent-button { background: var(--accent); color: white; }
.accent-button:hover { background: var(--accent-strong); }
.accent-button--danger { background: #d93025; }
.window-button { width: 36px; padding: 0; text-align: center; border-radius: 18px; color: var(--muted); background: transparent; }
.window-button:hover { background: rgba(0,0,0,0.05); color: var(--ink); }
body.dark-theme .window-button:hover { background: rgba(255,255,255,0.1); }
