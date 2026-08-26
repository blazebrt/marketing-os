const fs = require('fs');

let code = fs.readFileSync('src/app/integrations/page.tsx', 'utf-8');
code = code.replace(/integrations\.find\(i =>/g, 'integrations.find((i: any) =>');
code = code.replace(/integrations\?\.find\(i =>/g, 'integrations?.find((i: any) =>');
fs.writeFileSync('src/app/integrations/page.tsx', code);

code = fs.readFileSync('src/lib/prelaunch.ts', 'utf-8');
code = code.replace(/creds\.find\(i =>/g, 'creds.find((i: any) =>');
code = code.replace(/creds\?\.find\(i =>/g, 'creds?.find((i: any) =>');
fs.writeFileSync('src/lib/prelaunch.ts', code);

code = fs.readFileSync('src/lib/safeguards.ts', 'utf-8');
code = code.replace(/history\.find\(i =>/g, 'history.find((i: any) =>');
code = code.replace(/history\?\.find\(i =>/g, 'history?.find((i: any) =>');
fs.writeFileSync('src/lib/safeguards.ts', code);
