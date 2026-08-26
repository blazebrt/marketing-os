const fs = require('fs');
let code = fs.readFileSync('src/lib/safeguards.ts', 'utf-8');
code = code.replace(/integrations\.some\(i =>/g, 'integrations.some((i: any) =>');
fs.writeFileSync('src/lib/safeguards.ts', code);
