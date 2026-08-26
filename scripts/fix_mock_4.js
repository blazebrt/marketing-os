const fs = require('fs');
let code = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');
code = code.replace(/await db\.query\("UPDATE public\.unified_campaigns SET budget_amount=50001/g, 'await resetDeployment();\n  await db.query("UPDATE public.unified_campaigns SET budget_amount=50001');
code = code.replace(/await db\.query\("UPDATE public\.unified_campaigns SET budget_type='LIFETIME'/g, 'await resetDeployment();\n  await db.query("UPDATE public.unified_campaigns SET budget_type=\'LIFETIME\'');
code = code.replace(/await db\.query\("UPDATE public\.unified_campaigns SET duration_days=0/g, 'await resetDeployment();\n  await db.query("UPDATE public.unified_campaigns SET duration_days=0');
code = code.replace(/await db\.query\("UPDATE channel_deployments SET target_state = jsonb_set/g, 'await resetDeployment();\n  await db.query("UPDATE channel_deployments SET target_state = jsonb_set');
code = code.replace(/existingRemoteResources = \{ budget: 'b1'/g, 'await resetDeployment();\n  existingRemoteResources = { budget: \'b1\'');
fs.writeFileSync('tests/milestone6_comprehensive.test.ts', code);
