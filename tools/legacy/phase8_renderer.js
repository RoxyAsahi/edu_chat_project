const fs = require('fs');

let js = fs.readFileSync('renderer.js', 'utf8');

// Update Render Topic to use Material Symbols instead of text
js = js.replace(/<button class="topic-action-btn rename-btn" title="Rename">Rename<\/button>/g, 
                '<button class="topic-action-btn rename-btn" title="Rename"><span class="material-symbols-outlined" style="font-size: 16px;">edit</span></button>');
js = js.replace(/<button class="topic-action-btn toggle-read-btn" title="Mark Unread">Mark Unread<\/button>/g, 
                '<button class="topic-action-btn toggle-read-btn" title="Mark Unread"><span class="material-symbols-outlined" style="font-size: 16px;">mark_email_unread</span></button>');
js = js.replace(/<button class="topic-action-btn toggle-read-btn" title="Mark Read">Mark Read<\/button>/g, 
                '<button class="topic-action-btn toggle-read-btn" title="Mark Read"><span class="material-symbols-outlined" style="font-size: 16px;">drafts</span></button>');
js = js.replace(/<button class="topic-action-btn toggle-lock-btn" title="Lock">Lock<\/button>/g, 
                '<button class="topic-action-btn toggle-lock-btn" title="Lock"><span class="material-symbols-outlined" style="font-size: 16px;">lock</span></button>');
js = js.replace(/<button class="topic-action-btn toggle-lock-btn" title="Unlock">Unlock<\/button>/g, 
                '<button class="topic-action-btn toggle-lock-btn" title="Unlock"><span class="material-symbols-outlined" style="font-size: 16px;">lock_open_right</span></button>');
js = js.replace(/<button class="topic-action-btn topic-action-btn--danger delete-btn" title="Delete">Delete<\/button>/g, 
                '<button class="topic-action-btn topic-action-btn--danger delete-btn" title="Delete"><span class="material-symbols-outlined" style="font-size: 16px;">delete</span></button>');

// Empty state in chatMessages
const emptyChatHtml = `<div class="empty-state" style="margin-top: 100px; background: transparent; border: none;">
  <span class="material-symbols-outlined empty-icon" style="font-size: 64px; color: var(--accent-soft);">forum</span>
  <p style="font-size: 16px; font-weight: 500; color: var(--muted);">No messages yet. Start a conversation.</p>
</div>`;

// Find where empty chat is rendered
js = js.replace(/chatMessages\.innerHTML = '<div class="empty-chat">No messages yet\. Start the conversation\.<\/div>';/g, 
                `chatMessages.innerHTML = \`${emptyChatHtml}\`;`);

fs.writeFileSync('renderer.js', js, 'utf8');
console.log("Renderer.js Material Symbols update complete");
