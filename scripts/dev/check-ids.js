const fs = require('fs');

const js = fs.readFileSync('src/renderer/renderer.js', 'utf-8');
const html = fs.readFileSync('src/renderer/index.html', 'utf-8');

const regex = /document\.getElementById\('([^']+)'\)/g;
let match;
while ((match = regex.exec(js)) !== null) {
  const id = match[1];
  if (!html.includes(`id="${id}"`)) {
    console.log(`Missing ID in HTML: ${id}`);
  }
}
