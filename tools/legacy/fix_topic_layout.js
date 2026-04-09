const fs = require('fs');
let css = fs.readFileSync('style.css', 'utf8');

// The panel__header--stacked currently puts flex-direction column.
// We want the Title (History/Topics) and the Buttons (New Topic/Export) to be side-by-side if there's room, 
// or well-spaced. Let's adjust the topics panel header CSS.

css += `
/* Make the topics panel header look like NotebookLM */
.panel--topics .panel__header--stacked { flex-direction: row; align-items: center; flex-wrap: wrap; gap: 8px; }
.panel--topics .panel__header--stacked .panel__actions { margin-left: auto; display: flex; gap: 4px; }
.panel--topics .panel__header--stacked .ghost-button { padding: 6px 10px; font-size: 12px; border-radius: 12px; }

/* Further fixes for topic item content to prevent squishing */
.topic-item__main { flex: 1; min-width: 0; }
.topic-item__header { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.topic-item__title { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; }
.topic-item__meta-row { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--muted); flex-wrap: wrap; width: 100%; }
.topic-actions { position: absolute; right: 10px; top: 10px; background: var(--panel); border-radius: 12px; padding: 2px; box-shadow: var(--shadow-elevation-1); }
.topic-item { position: relative; padding-right: 10px; }
.topic-item:hover .topic-actions { display: flex; }
`;

fs.writeFileSync('style.css', css, 'utf8');
console.log('Topic layout fixed in CSS');
