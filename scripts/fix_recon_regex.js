const fs = require('fs');

let content = fs.readFileSync('src/lib/providers/google/reconciliation.ts', 'utf-8');

// Replace the metadata error
content = content.replace(
  /catch\s*\(\s*err:\s*any\s*\)\s*\{\s*const\s*sanitizedMsg[\s\S]*?throw\s*new\s*GoogleProviderError[^;]+;\s*\}/,
  `catch (err: any) {
    if (err instanceof GoogleProviderError) {
      throw err;
    }
    throw new GoogleProviderError(ERROR_CODES.INTERNAL_ERROR, 'Failed to reconcile');
  }`
);

// Replace the keywords check
const kwSearch = /if\s*\(\s*kwRes\.length\s*>\s*0\s*\)\s*\{\s*const\s*custId\s*=\s*kwRes\[0\]\.customer\?\.id\?\.toString\(\);\s*if\s*\(\s*custId\s*!==\s*verifiedCustomerNum\s*\)\s*\{\s*status\s*=\s*'DRIFT';\s*differences\.push\('Keyword does not belong to verified customer'\);\s*\}\s*\}/;

const kwReplace = `for (const r of kwRes) {
        const custId = r.customer?.id?.toString();
        const parentAdGroup = r.ad_group?.resource_name;
        if (custId !== verifiedCustomerNum) {
          status = 'DRIFT'; differences.push('Keyword does not belong to verified customer');
        }
        if (parentAdGroup !== externalState.adGroupResourceName) {
          status = 'DRIFT'; differences.push('Keyword does not belong to expected ad group');
        }
      }`;

content = content.replace(kwSearch, kwReplace);

fs.writeFileSync('src/lib/providers/google/reconciliation.ts', content);
