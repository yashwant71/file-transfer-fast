const fs = require('fs');
const c = fs.readFileSync('D:\\art\\file-transfer\\server.js', 'utf8');
const s = c.indexOf("senderHtml = `") + 14;
const e = c.indexOf("`;", s);
const html = c.substring(s, e);
const lines = html.split('\n');
lines.forEach((l, i) => {
  if (l.match(/'[^']*'[a-zA-Z]/)) console.log('Line', i+1, ':', l.trim());
});
