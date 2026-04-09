const fs = require('fs');

let css = fs.readFileSync('style.css', 'utf8');

// 1. Fix global scrollbars to look more MD3 and less native
const scrollbarCSS = `
/* Custom Scrollbars */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.25); }
body.dark-theme ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); }
body.dark-theme ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }

/* Hide scrollbar for lists to make it cleaner, but keep functionality */
.list::-webkit-scrollbar { width: 4px; }
.chat-messages-container::-webkit-scrollbar { width: 8px; }
`;

// Replace existing scrollbar css
css = css.replace(/::-webkit-scrollbar \{ width: 8px; height: 8px; \}[\s\S]*?body\.dark-theme ::-webkit-scrollbar-thumb \{ background: rgba\(255,255,255,0\.2\); \}/, scrollbarCSS.trim());


// 2. Fix Left Sidebar Topics header and items
css += `
/* Topic Item Fixes */
.topic-item__header { flex-wrap: nowrap; }
.topic-item__title-wrap { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
.topic-item__meta-row { gap: 6px; }
.topic-actions { flex-shrink: 0; margin-left: auto; }

/* Panel Header Fixes */
.panel__header--stacked { flex-direction: column; gap: 8px; align-items: stretch; }
.panel__header--stacked .panel__actions { justify-content: flex-start; }
`;

// 3. Fix Right Panel Avatar & Inputs
css += `
/* Avatar & Profile Fixes */
.bento-identity .identity-grid { grid-template-columns: 80px 1fr; gap: 16px; align-items: center; }
.avatar-editor { position: relative; cursor: pointer; border-radius: 20px; overflow: hidden; display: block; }
.avatar-editor img { width: 100%; height: 100%; object-fit: cover; transition: filter 0.2s; display: block; }
.avatar-editor:hover img { filter: brightness(0.8); }
.avatar-editor input[type="file"] { position: absolute; inset: 0; opacity: 0; cursor: pointer; height: 100%; width: 100%; }

.bento-identity .field-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
.bento-identity label { flex-direction: row; align-items: center; gap: 12px; }
.bento-identity label span { width: 40px; flex-shrink: 0; color: var(--muted); }
.bento-identity input { padding: 8px 12px; }
`;

// 4. Fix Right Panel Header (Settings Title & Delete)
css += `
/* Settings Header Fix */
.settings-panel__header { align-items: center; }
.settings-panel__header h2 { font-size: 16px; }
.settings-panel__header > div { min-width: 0; }
`;

// 5. Fix Composer Proportions
css += `
/* Composer Proportions Fix */
.composer__row { align-items: center; }
#attachFileBtn { width: 40px; height: 40px; background: transparent; color: var(--muted); transition: background 0.2s, color 0.2s; }
#attachFileBtn:hover { background: var(--paper); color: var(--ink); }
#sendMessageBtn { height: 40px; border-radius: 20px; font-weight: 600; padding: 0 20px; }
#messageInput { min-height: 40px; padding: 10px 0; align-self: center; }
`;

// Fix parameters card
css += `
/* Params spacing */
.bento-params .field-grid label { flex-direction: row; justify-content: space-between; align-items: center; }
.bento-params input { width: 80px; text-align: right; padding: 6px 10px; }
.bento-limits .field-grid label { flex-direction: row; justify-content: space-between; align-items: center; }
.bento-limits input { width: 80px; text-align: right; padding: 6px 10px; }
`;


fs.writeFileSync('style.css', css, 'utf8');
console.log("Appended CSS fixes");


// Now let's fix the HTML structure for the avatar and topics
let html = fs.readFileSync('index.html', 'utf8');

// Fix identity profile HTML structure for the new CSS
const newIdentityHtml = `<section class="settings-card bento-identity">
              <h3>Profile</h3>
              <div class="identity-grid">
                <div class="avatar-editor" title="Click to upload avatar">
                  <img id="agentAvatarPreview" src="assets/default_avatar.png" alt="avatar" />
                  <input id="agentAvatarInput" type="file" accept="image/*" />
                </div>
                <div class="field-grid">
                  <label>
                    <span>Name</span>
                    <input id="agentNameInput" type="text" />
                  </label>
                  <label>
                    <span>Model</span>
                    <input id="agentModel" type="text" />
                  </label>
                </div>
              </div>
              <input id="editingAgentId" type="hidden" />
            </section>`;

// Basic replacement via regex to handle slight formatting differences
html = html.replace(/<section class="settings-card bento-identity">[\s\S]*?<input id="editingAgentId" type="hidden" \/>\s*<\/section>/, newIdentityHtml);


fs.writeFileSync('index.html', html, 'utf8');
console.log("Updated HTML structures");

