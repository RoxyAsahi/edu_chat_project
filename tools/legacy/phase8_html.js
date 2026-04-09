const fs = require('fs');

let html = fs.readFileSync('index.html', 'utf8');

// 1. Add Material Symbols font to head
const fontLink = `  <link rel="stylesheet" href="Promptmodules/prompt-modules.css" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
  <link rel="stylesheet" href="style.css" />`;
html = html.replace(/<link rel="stylesheet" href="Promptmodules\/prompt-modules.css" \/>\s*<link rel="stylesheet" href="style.css" \/>/, fontLink);

// 2. Update Header buttons
html = html.replace('<button id="globalSettingsBtn" class="ghost-button">Settings</button>', 
                    '<button id="globalSettingsBtn" class="ghost-button icon-btn" title="Settings"><span class="material-symbols-outlined">settings</span></button>');
html = html.replace('<button id="themeToggleBtn" class="ghost-button">Theme</button>', 
                    '<button id="themeToggleBtn" class="ghost-button icon-btn" title="Toggle Theme"><span class="material-symbols-outlined">dark_mode</span></button>');

// 3. Update Sidebar Panel Headers
html = html.replace('<button id="createNewAgentBtn" class="accent-button">New</button>', 
                    '<button id="createNewAgentBtn" class="accent-button icon-text-btn"><span class="material-symbols-outlined">add</span> New</button>');
html = html.replace('<button id="quickNewTopicBtn" class="ghost-button">New Topic</button>', 
                    '<button id="quickNewTopicBtn" class="ghost-button icon-text-btn"><span class="material-symbols-outlined">add_comment</span> New</button>');
html = html.replace('<button id="exportTopicBtn" class="ghost-button">Export</button>', 
                    '<button id="exportTopicBtn" class="ghost-button icon-btn" title="Export"><span class="material-symbols-outlined">download</span></button>');

// 4. Update Chat Stage Header & Empty State
html = html.replace('<button id="currentAgentSettingsBtn" class="ghost-button">Open Settings</button>', 
                    '<button id="currentAgentSettingsBtn" class="ghost-button icon-text-btn"><span class="material-symbols-outlined">tune</span> Settings</button>');

// Empty state in chatMessages (the default placeholder needs to be updated via JS later, but we can add a container wrapper if needed. 
// For now, let's just make sure the composer buttons are updated.

// 5. Update Composer Buttons
html = html.replace('<button id="attachFileBtn" class="ghost-button">Attach</button>', 
                    '<button id="attachFileBtn" class="ghost-button icon-btn" title="Attach File"><span class="material-symbols-outlined">attach_file</span></button>');
html = html.replace('<button id="sendMessageBtn" class="accent-button">Send</button>', 
                    '<button id="sendMessageBtn" class="accent-button icon-btn rounded-btn" title="Send Message"><span class="material-symbols-outlined">send</span></button>');

// 6. Right Panel Empty State
html = html.replace('<div id="selectAgentPromptForSettings" class="empty-state">Choose an agent to edit its prompt and model settings.</div>', 
                    '<div id="selectAgentPromptForSettings" class="empty-state"><span class="material-symbols-outlined empty-icon">smart_toy</span><p>Select an agent to configure</p></div>');

// 7. Right Panel Bento Headers (Adding icons)
html = html.replace('<h3>Profile</h3>', '<h3><span class="material-symbols-outlined bento-icon">account_circle</span> Profile</h3>');
html = html.replace('<h3>System Prompt</h3>', '<h3><span class="material-symbols-outlined bento-icon">code_blocks</span> System Prompt</h3>');
html = html.replace('<h3>Parameters</h3>', '<h3><span class="material-symbols-outlined bento-icon">instant_mix</span> Parameters</h3>');
html = html.replace('<h3>Constraints</h3>', '<h3><span class="material-symbols-outlined bento-icon">rule</span> Constraints</h3>');
html = html.replace('<h3>Chat Styling</h3>', '<h3><span class="material-symbols-outlined bento-icon">palette</span> Chat Styling</h3>');

// Also update the Global Connection panel
html = html.replace('<h3>Global Connection</h3>', '<h3><span class="material-symbols-outlined bento-icon">public</span> Global Connection</h3>');
html = html.replace('<h3>Rendering</h3>', '<h3><span class="material-symbols-outlined bento-icon">brush</span> Rendering</h3>');
html = html.replace('<h3>Theme</h3>', '<h3><span class="material-symbols-outlined bento-icon">contrast</span> Theme</h3>');

fs.writeFileSync('index.html', html, 'utf8');
console.log("HTML Material Symbols update complete");
