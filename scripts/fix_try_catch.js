const fs = require('fs');
let code = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');
code = code.replace(
  "try { await deployGoogleCampaign(campId, ownerA); console.log('NO ERROR THROWN!'); } catch(e: any) { console.log('ERROR:', e.message); assert(e.message.includes('reconciliation failed'), '10. Missing headline DRIFT'); }",
  "try { await deployGoogleCampaign(campId, ownerA); } catch(e: any) { assert(e.message.includes('reconciliation failed'), '10. Missing headline DRIFT'); }"
);
fs.writeFileSync('tests/milestone6_comprehensive.test.ts', code);
