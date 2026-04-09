const fs = require('fs');

let css = fs.readFileSync('style.css', 'utf8');

// 1. Remove all 1px solid var(--line) borders globally
// Instead of simple replacement which might break things, we'll add overrides 
// that reset borders and add shadow/background rules for MD3 Expressive.

const overrides = `
/* --- MD3 Expressive Overrides --- */

/* Global border removal & Shape updates */
.panel, .chat-stage, .settings-panel, .settings-card, .composer, .empty-state, textarea, input, select {
  border: none !important;
}

/* Hyper Rounded Shapes */
.panel, .chat-stage {
  border-radius: 32px !important;
}
.settings-card, .empty-state {
  border-radius: 20px !important;
}
.composer {
  border-radius: 32px !important;
  box-shadow: var(--shadow-elevation-2) !important;
}
.search-input {
  border-radius: 24px !important;
}

}

/* Soft Input Interactions */
.settings-card input[type="text"], 
.settings-card input[type="number"], 
.settings-card input[type="password"], 
.settings-card select,
.search-input {
  background: rgba(0,0,0,0.03) !important;
  transition: background 0.3s, box-shadow 0.3s !important;
}
body.dark-theme .settings-card input, 
body.dark-theme .settings-card select,
body.dark-theme .search-input {
  background: rgba(255,255,255,0.05) !important;
}

.settings-card input:focus, 
.settings-card select:focus,
.search-input:focus {
  background: var(--panel) !important;
  box-shadow: 0 0 0 3px var(--accent-soft) !important;
}

/* Bento Background Enhancements */
.bento-prompt { background: var(--macaron-blue) !important; }
.bento-params { background: var(--macaron-yellow) !important; }
.bento-style { background: var(--macaron-green) !important; }

/* SVG Icon alignment fix */
svg {
  display: inline-block;
  vertical-align: middle;
}
.icon-btn svg {
  margin: auto;
}
.icon-text-btn svg {
  margin-right: 6px;
}
.bento-icon {
  margin-right: 6px;
  opacity: 0.8;
}
.empty-icon {
  margin-bottom: 12px;
  opacity: 0.5;
  color: var(--accent);
}
`;

fs.writeFileSync('style.css', css + overrides, 'utf8');
console.log("CSS MD3 Expressive overrides applied");

// Update renderer.js SVG strings
let renderer = fs.readFileSync('renderer.js', 'utf8');
const rendererSvgs = {
    edit: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
    mark_email_unread: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>',
    drafts: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>',
    lock: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>',
    lock_open: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>',
    delete: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>',
    forum: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4; color:var(--accent); margin-bottom:12px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>'
};

renderer = renderer.replace(/<span class="material-symbols-outlined"[^>]*>edit<\/span>/g, rendererSvgs.edit);
renderer = renderer.replace(/<span class="material-symbols-outlined"[^>]*>mark_email_unread<\/span>/g, rendererSvgs.mark_email_unread);
renderer = renderer.replace(/<span class="material-symbols-outlined"[^>]*>drafts<\/span>/g, rendererSvgs.drafts);
renderer = renderer.replace(/<span class="material-symbols-outlined"[^>]*>lock<\/span>/g, rendererSvgs.lock);
renderer = renderer.replace(/<span class="material-symbols-outlined"[^>]*>lock_open_right<\/span>/g, rendererSvgs.lock_open);
renderer = renderer.replace(/<span class="material-symbols-outlined"[^>]*>delete<\/span>/g, rendererSvgs.delete);
renderer = renderer.replace(/<span class="material-symbols-outlined empty-icon"[^>]*>forum<\/span>/g, rendererSvgs.forum);

fs.writeFileSync('renderer.js', renderer, 'utf8');
console.log("Renderer.js Inline SVGs applied.");
