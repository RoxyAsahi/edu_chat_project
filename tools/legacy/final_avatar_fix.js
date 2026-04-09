const fs = require('fs');

let css = fs.readFileSync('style.css', 'utf8');

// Replace .message-avatar with .chat-avatar in our recently added rules
css = css.replace(/\.message-avatar/g, '.chat-avatar');

// Make absolutely sure there's no rogue message-item rule overriding our flex layout
// We added the flex layout at the end, so it should win, but let's be safe.
if (!css.includes('.chat-avatar {')) {
    // Just in case the replace didn't work exactly as expected due to formatting
    css += `
    /* Emergency Fallback for Chat Avatar */
    img.chat-avatar {
        width: 40px !important;
        height: 40px !important;
        max-width: 40px !important;
        max-height: 40px !important;
        min-width: 40px !important;
        min-height: 40px !important;
        border-radius: 50% !important;
        object-fit: cover !important;
        flex-shrink: 0 !important;
        align-self: flex-start !important;
        border: none !important;
        box-shadow: var(--shadow-elevation-1) !important;
    }
    `;
}

fs.writeFileSync('style.css', css, 'utf8');
console.log("Avatar class fixed from .message-avatar to .chat-avatar");
