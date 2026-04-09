const fs = require('fs');

let css = fs.readFileSync('style.css', 'utf8');

// The major issue from Screenshot 3 was the topic-actions menu. 
// Let's rewrite .topic-actions completely.
const actionCSS = `
/* --- Material Symbols Global --- */
.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: 20px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  font-feature-settings: 'liga';
  -webkit-font-smoothing: antialiased;
}

/* Base button resets */
button { border: none; background: transparent; outline: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }

/* Icon buttons */
.icon-btn { width: 36px; height: 36px; border-radius: 50%; padding: 0 !important; color: var(--muted); }
.icon-btn:hover { background: rgba(0,0,0,0.05); color: var(--ink); }
body.dark-theme .icon-btn:hover { background: rgba(255,255,255,0.1); }
.icon-text-btn { padding: 6px 12px; border-radius: 18px; font-weight: 500; }
.icon-text-btn .material-symbols-outlined { font-size: 18px; }

/* Composer overrides */
.composer__row { align-items: flex-end; }
#attachFileBtn { width: 44px; height: 44px; color: var(--muted); align-self: flex-start; margin-top: 4px; }
#sendMessageBtn { width: 44px; height: 44px; padding: 0 !important; display: flex; align-items: center; justify-content: center; }
#sendMessageBtn .material-symbols-outlined { font-size: 20px; }
#messageInput { min-height: 52px; padding: 14px 0; }

/* Topic Action Menu Rewrite */
/* We want it floating on the right side, horizontal, translucent background */
.topic-actions {
  display: flex;
  flex-direction: row; /* Force horizontal */
  gap: 4px;
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(8px);
  padding: 4px;
  border-radius: 20px;
  box-shadow: var(--shadow-elevation-1);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s, transform 0.2s;
  z-index: 10;
}
body.dark-theme .topic-actions { background: rgba(30, 30, 32, 0.85); }
.list-item:hover .topic-actions { opacity: 1; pointer-events: auto; }

.topic-action-btn {
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  background: transparent;
  transition: all 0.2s;
}
.topic-action-btn:hover { background: rgba(0,0,0,0.06); color: var(--ink); }
body.dark-theme .topic-action-btn:hover { background: rgba(255,255,255,0.1); }
.topic-action-btn--danger:hover { color: #d93025; background: rgba(217, 48, 37, 0.1); }

/* Make sure topic title doesn't overlap actions on hover */
.topic-item:hover .topic-item__title-wrap { padding-right: 120px; }

/* Empty States */
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 40px; color: var(--muted); background: var(--paper); border-radius: 24px; border: 1px dashed var(--line); }
.empty-icon { font-size: 48px; opacity: 0.5; }

/* Bento Icons */
.bento-icon { font-size: 20px; vertical-align: text-bottom; margin-right: 4px; opacity: 0.7; }
.settings-card h3 { display: flex; align-items: center; }

/* Settings button fix */
.settings-panel__header .ghost-button { padding: 6px 12px; border-radius: 12px; color: #d93025; }
.settings-panel__header .ghost-button:hover { background: rgba(217, 48, 37, 0.1); }

/* Fix header layout */
.titlebar__meta { gap: 4px; }
.titlebar__meta .ghost-button { color: var(--muted); }
.titlebar__meta .ghost-button:hover { color: var(--ink); }

/* Fix missing icons in topic render */
/* We will inject this via JS replace in renderer.js */
`;

css += actionCSS;

// Clean up some old rules that might conflict
css = css.replace(/\.topic-actions \{ display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; opacity: 0; transition: opacity 0\.2s; \}/g, '/* removed old .topic-actions */');
css = css.replace(/\.topic-action-btn \{[\s\S]*?body\.dark-theme \.topic-action-btn:hover \{ background: rgba\(255,255,255,0\.1\); \}\n\.topic-action-btn--danger:hover \{ color: #d93025; background: rgba\(217, 48, 37, 0\.1\); \}/, '/* removed old .topic-action-btn */');

fs.writeFileSync('style.css', css, 'utf8');
console.log("CSS Material Symbols and Action Menu fixes complete");
