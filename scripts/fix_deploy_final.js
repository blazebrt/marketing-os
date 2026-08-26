const fs = require('fs');

let depCode = fs.readFileSync('src/lib/providers/google/deployment.ts', 'utf8');

const injection = `
    const budgetAmount = Number(campaign.budget_amount);
    const durationDays = Number(campaign.duration_days);

    if (durationDays <= 0 || isNaN(durationDays)) {
      throw new Error('Invalid duration');
    }

    const rawBudgetType = campaign.budget_type?.toLowerCase();
    if (rawBudgetType !== 'daily' && rawBudgetType !== 'lifetime') {
      throw new GoogleProviderError('INVALID_BUDGET_TYPE', 'Budget type must be exactly daily or lifetime.');
    }
    const budgetTypeStr = rawBudgetType as 'daily' | 'lifetime';
    if (Number(campaign.max_auto_budget_increase) !== 0) {
      throw new GoogleProviderError('SAFETY_VIOLATION', 'max_auto_budget_increase must be exactly 0.');
    }
    const limits = calculateSafetyLimits(budgetTypeStr, budgetAmount, durationDays);

    // 4. Authorize Mutation Gate
`;

depCode = depCode.replace('// 4. Authorize Mutation Gate', injection);

fs.writeFileSync('src/lib/providers/google/deployment.ts', depCode);
