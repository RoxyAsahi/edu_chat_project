const fs = require('fs');

// Ensure we don't have duplicate conflicting rules in style.css
let css = fs.readFileSync('style.css', 'utf8');

// The fixes applied in the previous step were just appended to the end of style.css.
// To ensure they take precedence and don't cause weird CSS cascading issues, 
// let's verify if there are any old styles breaking the layout.

// Look for older .message-item rules that might conflict with the flexbox ones
// The original was:
// .message-item { max-width: 100%; width: fit-content; }
// .message-item.user { align-self: flex-end; }
// .message-item.assistant, .message-item.system { align-self: flex-start; }

if (css.includes('.message-item { max-width: 100%; width: fit-content; }')) {
    css = css.replace('.message-item { max-width: 100%; width: fit-content; }', '/* Removed conflicting message-item rule */');
}

fs.writeFileSync('style.css', css, 'utf8');
console.log("Cleanup complete");
