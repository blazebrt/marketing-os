const fs = require('fs');

let content = fs.readFileSync('src/lib/providers/google/deployment.ts', 'utf-8');

// The chunk starting from `try {` down to `await client.initialize();`
// We need to replace it.

const tryBlockStart = content.indexOf('  try {');
const clientInitEnd = content.indexOf('    await client.initialize();') + '    await client.initialize();'.length;

const originalTryBlock = content.substring(tryBlockStart, clientInitEnd);

const newTryBlock = `  try {
    // 2. Fetch campaign
    const { data: campaign, error: campError } = await supabase
      .from('unified_campaigns')
      .select('*')
      .eq('id', campaignId)
      .eq('owner_id', authenticatedUid)
      .single();

    if (campError || !campaign) throw new Error('Campaign not found');

    const targetState = deployment.target_state as GoogleTargetState;

    // 3. Fetch credentials
    const { data: creds, error: credError } = await supabase
      .from('integration_credentials')
      .select('encrypted_credentials')
      .eq('owner_id', authenticatedUid)
      .eq('provider', 'google')
      .single();

    if (credError || !creds) throw new GoogleProviderError(ERROR_CODES.AUTH_FAILED, 'Google integration credentials missing');

    const decrypted = JSON.parse(creds.encrypted_credentials);
    const refreshToken = decryptCredential(decrypted.refresh_token);

    // 4. verifyTestAccount
    const verifiedCustomerId = await verifyTestAccount(
      process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
      refreshToken,
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      process.env.GOOGLE_ADS_TEST_CUSTOMER_ID!,
      process.env.GOOGLE_ADS_TEST_MANAGER_ID!
    );

    // 5. Authoritative budget validation
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

    if (
      targetState.campaign.budget !== budgetAmount ||
      Number(campaign.max_daily_spend) !== limits.maxDaily ||
      Number(campaign.max_campaign_spend) !== limits.maxTotal
    ) {
      throw new Error('Budget mismatch: Target state or campaign budget properties do not match authoritative calculation.');
    }
    
    // Validate creatives
    const allCreatives = [...targetState.headlines, ...targetState.descriptions, ...targetState.keywords];
    for (const item of allCreatives) {
      if (item.rejected || item.owner_approved !== true) {
        throw new Error('Unapproved or rejected creative found in target state.');
      }
    }

    // 6. EXPLICIT MUTATION KILL SWITCH
    if (process.env.GOOGLE_ADS_EXECUTION_MODE !== 'test') {
      throw new GoogleProviderError('REAL_TEST_MUTATION_NOT_AUTHORIZED', 'Execution mode must be exactly "test".');
    }
    if (process.env.GOOGLE_ADS_ALLOW_MUTATIONS !== 'true') {
      throw new GoogleProviderError('REAL_TEST_MUTATION_NOT_AUTHORIZED', 'Mutations are explicitly disabled.');
    }
    if (process.env.NODE_ENV === 'production') {
      throw new GoogleProviderError('REAL_TEST_MUTATION_NOT_AUTHORIZED', 'Test mutations cannot run in a production environment.');
    }
    if (verifiedCustomerId !== process.env.GOOGLE_ADS_TEST_CUSTOMER_ID) {
      throw new GoogleProviderError('REAL_TEST_MUTATION_NOT_AUTHORIZED', 'Verified customer ID does not match configured test customer ID.');
    }
    if (process.env.GOOGLE_ADS_DEPLOYMENT_CONFIRMATION !== 'CONFIRMED') {
      throw new GoogleProviderError('REAL_TEST_MUTATION_NOT_AUTHORIZED', 'Missing explicit deployment confirmation.');
    }
    // Note: verifyTestAccount already strictly ensures test_account === true.

    const client = new GoogleAdsMutationClient({
      developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
      refreshToken: refreshToken,
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      customerId: verifiedCustomerId,
      managerId: process.env.GOOGLE_ADS_TEST_MANAGER_ID!,
    });

    await client.initialize();`;

content = content.replace(originalTryBlock, newTryBlock);

// Replace `-d1-` with `-E2E-`
content = content.replace(/MKTOS-\$\{deployment.id\}-BUDGET/g, 'MKTOS-E2E-${deployment.id}-BUDGET');
content = content.replace(/MKTOS-\$\{deployment.id\}-CAMPAIGN/g, 'MKTOS-E2E-${deployment.id}-CAMPAIGN');
content = content.replace(/MKTOS-\$\{deployment.id\}-ADGROUP/g, 'MKTOS-E2E-${deployment.id}-ADGROUP');

fs.writeFileSync('src/lib/providers/google/deployment.ts', content);
