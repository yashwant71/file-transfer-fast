const fs = require('fs');
const c = fs.readFileSync('D:\\art\\file-transfer\\server.js', 'utf8');
const lines = c.split('\n');
const bad = ["what's", "it's", "can't", "don't", "won't", "doesn't", "isn't", "aren't", "couldn't", "shouldn't", "wouldn't"];
lines.forEach((l, i) => {
  for (const word of bad) {
    if (l.includes(word)) {
      console.log('APOSTROPHE Line ' + (i+1) + ': ' + l.trim().substring(0, 100));
    }
  }
});
