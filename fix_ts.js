const fs = require('fs');

let content = fs.readFileSync('src/app/campaigns/actions.ts', 'utf8');
content = content.replace(
  /await supabase\.from\('channel_deployments'\)\.insert\(\{[\s\S]*?\}\)\.catch\(e => \{[\s\S]*?\}\);/g,
  `try {
        await supabase.from('channel_deployments').insert({
          campaign_id: campaignId,
          owner_id: user.id,
          provider: provider.toLowerCase(),
          status: 'PENDING'
        });
      } catch (e) {
         // Silently catch duplicate insertion errors due to unique constraints for idempotency
      }`
);
fs.writeFileSync('src/app/campaigns/actions.ts', content);

let ui = fs.readFileSync('src/app/campaigns/new/page.tsx', 'utf8');
ui = ui.replace(/delete payload\.creative_id;/g, "payload.creative_id = undefined;");
fs.writeFileSync('src/app/campaigns/new/page.tsx', ui);

let test = fs.readFileSync('tests/milestone4_fixes.test.ts', 'utf8');
test = test.replace(/const connectedProviders = creds\.map\(c => c\.provider\);/g, "const connectedProviders = creds.map((c: any) => c.provider);");
fs.writeFileSync('tests/milestone4_fixes.test.ts', test);
console.log('Fixes applied');
