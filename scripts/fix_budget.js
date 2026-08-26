const fs = require('fs');
let code = fs.readFileSync('src/lib/providers/google/deployment.ts', 'utf-8');
code = code.replace(
  "let budgetTypeStr = campaign.budget_type?.toLowerCase() === 'lifetime' ? 'lifetime' : 'daily';",
  `const rawBudgetType = campaign.budget_type?.toLowerCase();
    if (rawBudgetType !== 'daily' && rawBudgetType !== 'lifetime') {
      throw new GoogleProviderError('INVALID_BUDGET_TYPE', 'Budget type must be exactly daily or lifetime.');
    }
    const budgetTypeStr = rawBudgetType as 'daily' | 'lifetime';
    if (Number(campaign.max_auto_budget_increase) !== 0) {
      throw new GoogleProviderError('SAFETY_VIOLATION', 'max_auto_budget_increase must be exactly 0.');
    }`
);
fs.writeFileSync('src/lib/providers/google/deployment.ts', code);
