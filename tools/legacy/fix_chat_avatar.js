const fs = require('fs');
let css = fs.readFileSync('style.css', 'utf8');

// The issue is `.avatar` was set to 40px but `.message-item img` might be catching the avatar
// or the avatar lacks `.avatar` class.
// Looking at DOM builder, avatar is `img.message-avatar`.
css += `
/* Message Layout & Avatar Fixes */
.message-item { 
    display: flex; 
    gap: 12px; 
    max-width: var(--lite-chat-max-width); 
    width: 100%;
    margin-bottom: 8px;
}
.message-item.assistant { flex-direction: row; }
.message-item.user { flex-direction: row-reverse; }

.message-item .message-avatar {
    width: 40px !important;
    height: 40px !important;
    border-radius: 50% !important;
    object-fit: cover !important;
    flex-shrink: 0;
    align-self: flex-start;
    border: none !important;
    box-shadow: var(--shadow-elevation-1);
    background: var(--paper);
}

.message-item .details-and-bubble-wrapper {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    max-width: calc(100% - 52px); /* Account for avatar + gap */
}

.message-item.user .details-and-bubble-wrapper {
    align-items: flex-end;
}
.message-item.assistant .details-and-bubble-wrapper {
    align-items: flex-start;
}

.message-item .message-name-time {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 12px;
    margin-bottom: 2px;
    padding: 0 4px;
}

.message-item.user .message-name-time {
    flex-direction: row-reverse;
}

.message-item .sender-name {
    font-weight: 600;
    color: var(--muted);
}
.message-item .message-timestamp {
    color: var(--muted);
    opacity: 0.7;
    font-size: 11px;
}

/* Ensure images inside message content are distinct from avatars */
.message-item .md-content img:not(.message-avatar) { 
    max-width: 100%; 
    max-height: 400px;
    border-radius: 12px; 
    display: block;
    margin: 8px 0;
}
`;

fs.writeFileSync('style.css', css, 'utf8');
console.log("Chat avatar layout CSS updated");
