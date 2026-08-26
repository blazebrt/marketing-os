const fs = require('fs');
let text = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');
text = text.replace(
  "let audits = await db.query(\"SELECT details FROM audit_logs WHERE action='GOOGLE_RECONCILIATION_COMPLETED' LIMIT 1\");\n  let diffs = (audits.rows[0] as any).details.after.differences;",
  "let audits = await db.query(\"SELECT details FROM audit_logs WHERE action='GOOGLE_RECONCILIATION_COMPLETED'\");\n  let diffs = (audits.rows[audits.rows.length-1] as any).details.after.differences;"
);
fs.writeFileSync('tests/milestone6_comprehensive.test.ts', text);
