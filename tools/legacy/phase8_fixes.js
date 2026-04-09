const fs = require('fs');
let css = fs.readFileSync('style.css', 'utf8');

// Ensure the topic action menu is perfectly aligned vertically and horizontally
css += `
/* Topic Actions Alignment Fixes */
.topic-item { position: relative; padding: 12px 14px; overflow: hidden; display: flex; flex-direction: column; gap: 6px; }
.topic-item:hover .topic-item__title-wrap { padding-right: 120px; }
.topic-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 2px;
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  padding: 4px 6px;
  border-radius: 20px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 10;
}
body.dark-theme .topic-actions { background: rgba(30, 30, 32, 0.95); box-shadow: 0 4px 12px rgba(0,0,0,0.3); }

.list-item:hover .topic-actions { 
  opacity: 1; 
  pointer-events: auto; 
  transform: translateY(-50%) translateX(0); 
}

.topic-action-btn {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.topic-action-btn .material-symbols-outlined { font-size: 18px !important; }
.topic-action-btn:hover { background: rgba(0,0,0,0.05); color: var(--ink); }
body.dark-theme .topic-action-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
.topic-action-btn--danger:hover { color: #d93025; background: rgba(217, 48, 37, 0.1); }
`;

fs.writeFileSync('style.css', css, 'utf8');
console.log("Topic actions final alignment fixed");
