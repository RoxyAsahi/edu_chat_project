const fs = require('fs');
let css = fs.readFileSync('style.css', 'utf8');

// The screenshot showed right panel inputs were still a bit uneven
css += `
/* Input refinements */
.field-grid label span { font-size: 13px; font-weight: 500; color: var(--muted); }
.settings-card input[type="text"], 
.settings-card input[type="number"], 
.settings-card input[type="password"], 
.settings-card select {
    padding: 8px 12px;
    font-size: 14px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: transparent;
    box-shadow: none;
    transition: all 0.2s;
}
.settings-card input:focus, .settings-card select:focus {
    border-color: var(--accent);
    background: var(--paper);
}

body.dark-theme .settings-card input, 
body.dark-theme .settings-card select {
    background: rgba(0,0,0,0.1);
}
body.dark-theme .settings-card input:focus, 
body.dark-theme .settings-card select:focus {
    background: rgba(0,0,0,0.3);
}

.radio-row label, .checkbox-row label {
    cursor: pointer;
    user-select: none;
}
`;

fs.writeFileSync('style.css', css, 'utf8');
console.log("Input padding fixed");
