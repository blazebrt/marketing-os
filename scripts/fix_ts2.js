const fs = require('fs');
let code;
code = fs.readFileSync('src/app/campaigns/page.tsx', 'utf-8');
code = code.replace(/campaigns\?\.map\(c =>/g, 'campaigns?.map((c: any) =>');
fs.writeFileSync('src/app/campaigns/page.tsx', code);

code = fs.readFileSync('src/app/integrations/page.tsx', 'utf-8');
code = code.replace(/integrations\?\.map\(i =>/g, 'integrations?.map((i: any) =>');
fs.writeFileSync('src/app/integrations/page.tsx', code);

code = fs.readFileSync('src/app/leads/page.tsx', 'utf-8');
code = code.replace(/leads\?\.map\(lead =>/g, 'leads?.map((lead: any) =>');
fs.writeFileSync('src/app/leads/page.tsx', code);

code = fs.readFileSync('src/app/page.tsx', 'utf-8');
code = code.replace(/leads\?\.filter\(l =>/g, 'leads?.filter((l: any) =>');
code = code.replace(/leads\?\.reduce\(\(sum, l\) =>/g, 'leads?.reduce((sum: number, l: any) =>');
fs.writeFileSync('src/app/page.tsx', code);

code = fs.readFileSync('src/lib/prelaunch.ts', 'utf-8');
code = code.replace(/creds\.filter\(i =>/g, 'creds.filter((i: any) =>');
fs.writeFileSync('src/lib/prelaunch.ts', code);

code = fs.readFileSync('src/lib/safeguards.ts', 'utf-8');
code = code.replace(/history\.some\(i =>/g, 'history.some((i: any) =>');
fs.writeFileSync('src/lib/safeguards.ts', code);
