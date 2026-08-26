const fs = require('fs');

function replaceAnyType(file, search, replace) {
  let text = fs.readFileSync(file, 'utf-8');
  text = text.replace(search, replace);
  fs.writeFileSync(file, text);
}

replaceAnyType('src/app/campaigns/[id]/page.tsx', 'deployments.map((d) =>', 'deployments.map((d: any) =>');
replaceAnyType('src/app/campaigns/page.tsx', 'campaigns.map((c) =>', 'campaigns.map((c: any) =>');
replaceAnyType('src/app/integrations/page.tsx', 'integrations.map((i) =>', 'integrations.map((i: any) =>');
replaceAnyType('src/app/leads/page.tsx', 'leads.map((lead) =>', 'leads.map((lead: any) =>');
replaceAnyType('src/app/page.tsx', 'leads.filter((l) =>', 'leads.filter((l: any) =>');
replaceAnyType('src/app/page.tsx', 'leads.filter((l) =>', 'leads.filter((l: any) =>');
replaceAnyType('src/app/page.tsx', 'leads.filter((l) =>', 'leads.filter((l: any) =>');
replaceAnyType('src/app/page.tsx', 'leads.filter((l) =>', 'leads.filter((l: any) =>');
replaceAnyType('src/app/page.tsx', 'leads.reduce((sum, l) =>', 'leads.reduce((sum: any, l: any) =>');
replaceAnyType('src/lib/prelaunch.ts', 'items.filter((i) =>', 'items.filter((i: any) =>');
replaceAnyType('src/lib/safeguards.ts', 'items.filter((i) =>', 'items.filter((i: any) =>');
