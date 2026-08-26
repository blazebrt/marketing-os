const fs = require('fs');
let code = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');
const oldText = `let audits = await db.query("SELECT details FROM audit_logs WHERE action='GOOGLE_DEPLOYMENT_FAILED'");
  let diffs = (audits.rows[audits.rows.length-1] as any).details.after.error;
  assert(diffs.includes('DRIFT'), '10. Headline drift logged properly');`;
const newText = `let logEntry = logs.find(l => l.action === 'GOOGLE_DEPLOYMENT_FAILED');
  assert(logEntry && logEntry.after.error.includes('DRIFT'), '10. Headline drift logged properly');`;
code = code.replace(oldText, newText);
fs.writeFileSync('tests/milestone6_comprehensive.test.ts', code);
