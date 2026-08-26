const fs = require('fs');

let content = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

// The string we want to replace starts after `await resetDeployment();` and goes up to `const p1 = deployGoogleCampaign(campId, ownerA).catch(e => e.message);`
const lines = content.split('\n');
let newLines = [];
let skip = false;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('// Test 1: Concurrent lock')) {
    newLines.push(lines[i]);
    newLines.push(lines[i+1]); // await resetDeployment();
    newLines.push('  (global as any).mockQueryFunc = async function(q: string) { return "__FALLTHROUGH__"; };');
    skip = true;
    continue;
  }
  if (skip && lines[i].includes('const p1 = deployGoogleCampaign')) {
    skip = false;
  }
  if (!skip) {
    newLines.push(lines[i]);
  }
}

fs.writeFileSync('tests/milestone6_comprehensive.test.ts', newLines.join('\n'));
