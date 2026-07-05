const fs = require('fs');
let c = fs.readFileSync('D:\\art\\file-transfer\\server.js', 'utf8');

// Find and list all problematic escape sequences inside template literals
const issues = [];
const patterns = ['what\\u0027', "what's", "it's", "can't", "don't", "won't", "doesn't"];
for (const p of patterns) {
  let idx = 0;
  while ((idx = c.indexOf(p, idx)) !== -1) {
    const lineStart = c.lastIndexOf('\n', idx) + 1;
    const lineEnd = c.indexOf('\n', idx);
    issues.push({ pattern: p, pos: idx, line: c.substring(lineStart, lineEnd) });
    idx += p.length;
  }
}

if (issues.length === 0) {
  console.log('No issues found');
} else {
  console.log('Found ' + issues.length + ' issues:');
  issues.forEach(i => console.log('  "' + i.pattern + '" at pos ' + i.pos + ': ' + i.line.trim()));
}

// Fix: replace what\u0027 with what's (using actual apostrophe in double-quoted context)
if (c.includes('what\\u0027')) {
  c = c.replace(/what\\u0027/g, "what's");
  fs.writeFileSync('D:\\art\\file-transfer\\server.js', c, 'utf8');
  console.log('Fixed what\\u0027 -> what\'s');
} else {
  console.log('No what\\u0027 to fix');
}
