const fs = require('fs');
const content = fs.readFileSync('modules/renderer/domBuilder.js', 'utf8');

const regex = /export function createMessageSkeleton[\s\S]*?return/;
const match = content.match(regex);
if (match) {
    console.log(match[0].substring(0, 1000));
    console.log("...");
    console.log(match[0].substring(match[0].length - 1000));
} else {
    console.log("Not found");
}
