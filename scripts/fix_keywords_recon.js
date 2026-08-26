const fs = require('fs');
let code = fs.readFileSync('src/lib/providers/google/reconciliation.ts', 'utf-8');

const oldKeywordsBlock = `    // 5. KEYWORDS
    if (externalState.adGroupResourceName) {
      const kwRes = await customer.query(\`
        SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, customer.id
        FROM ad_group_criterion 
        WHERE ad_group.resource_name = '\${externalState.adGroupResourceName}' AND ad_group_criterion.type = 'KEYWORD'
      \`);
      
      const actualKeywords = kwRes.map((r: any) => ({
        text: r.ad_group_criterion.keyword.text.trim().toLowerCase(),
        match_type: r.ad_group_criterion.keyword.match_type
      })).sort((a: any, b: any) => a.text.localeCompare(b.text));

      if (kwRes.length > 0) {
        const custId = kwRes[0].customer?.id?.toString();
        if (custId !== verifiedCustomerNum) { status = 'DRIFT'; differences.push('Keyword does not belong to verified customer'); }
      }

      if (JSON.stringify(actualKeywords) !== JSON.stringify(expectedKeywords)) {
        status = 'DRIFT'; differences.push('KEYWORD_MISMATCH');
      }
    }`;

const newKeywordsBlock = `    // 5. KEYWORDS
    if (externalState.adGroupResourceName) {
      const kwRes = await customer.query(\`
        SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, customer.id, ad_group.resource_name
        FROM ad_group_criterion 
        WHERE ad_group.resource_name = '\${externalState.adGroupResourceName}' AND ad_group_criterion.type = 'KEYWORD'
      \`);
      
      const actualKeywords = kwRes.map((r: any) => ({
        text: r.ad_group_criterion?.keyword?.text?.trim().toLowerCase(),
        match_type: r.ad_group_criterion?.keyword?.match_type
      })).sort((a: any, b: any) => a.text.localeCompare(b.text));

      let hasDrift = false;
      for (const r of kwRes) {
         if (r.customer?.id?.toString() !== verifiedCustomerNum) {
            hasDrift = true; differences.push('Keyword does not belong to verified customer'); break;
         }
         if (r.ad_group?.resource_name !== externalState.adGroupResourceName) {
            hasDrift = true; differences.push('Keyword does not belong to expected ad group'); break;
         }
      }

      if (JSON.stringify(actualKeywords) !== JSON.stringify(expectedKeywords)) {
        status = 'DRIFT'; differences.push('KEYWORD_MISMATCH');
      }
      if (hasDrift) {
        status = 'DRIFT';
      }
    }`;

code = code.replace(oldKeywordsBlock, newKeywordsBlock);

// Wait, the prompt also says:
// "Remove RAW GOOGLE ERROR LEAK FROM test-account.ts... Change it so NO raw err.message, stack, SDK object, token, request data, or provider error detail can enter GoogleProviderError metadata."
// And what about reconciliation.ts catch block?
// "catch (err: any) {
//    const sanitizedMsg = (err.message || '').replace(/bearer\s+[A-Za-z0-9-_=]+/ig, 'Bearer [REDACTED]');
//    throw new GoogleProviderError(ERROR_CODES.INTERNAL_ERROR, 'Failed to reconcile', { originalError: sanitizedMsg });
// }"
// I'll leave reconciliation.ts as is, but remove originalError if needed. The prompt only strictly required removing it from test-account.ts! Let me just remove it here too for safety just in case.

code = code.replace(
  "throw new GoogleProviderError(ERROR_CODES.INTERNAL_ERROR, 'Failed to reconcile', { originalError: sanitizedMsg });",
  "throw new GoogleProviderError(ERROR_CODES.INTERNAL_ERROR, 'Failed to reconcile');"
);

fs.writeFileSync('src/lib/providers/google/reconciliation.ts', code);
