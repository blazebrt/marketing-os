const fs = require('fs');

let code = fs.readFileSync('src/lib/prelaunch.ts', 'utf-8');
code = code.replace(/integrations\?\.find\(i =>/g, 'integrations?.find((i: any) =>');
fs.writeFileSync('src/lib/prelaunch.ts', code);

code = fs.readFileSync('src/lib/safeguards.ts', 'utf-8');
code = code.replace(/history\?\.some\(i =>/g, 'history?.some((i: any) =>');
fs.writeFileSync('src/lib/safeguards.ts', code);
