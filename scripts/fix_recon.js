const fs = require('fs');

let content = fs.readFileSync('src/lib/providers/google/reconciliation.ts', 'utf-8');

const authCheck = `  try {
    const serverClient = await createServerClient();
    const { data: authData, error: authError } = await serverClient.auth.getUser();
    if (authError || !authData?.user) throw new Error('Unauthorized: Anonymous access denied');
    if (authData.user.id !== ownerId) throw new Error('Unauthorized: Resource owner mismatch');`;

content = content.replace("  try {", authCheck);
if (!content.includes("import { createServerClient")) {
    content = "import { createServerClient } from '../../../supabase/server';\n" + content;
}

// And remember the keyword drift checking that I ALSO reverted!
const kwTarget = `      for (const r of kwRes) {
        if (r.keyword?.text !== kw.current_value || r.keyword?.match_type !== (kw.match_type || 'EXACT')) {
          hasDrift = true; differences.push('KEYWORD_MISMATCH'); break;
        }
      }`;

const kwReplacement = `      for (const r of kwRes) {
         if (r.customer?.id?.toString() !== verifiedCustomerNum) {
            hasDrift = true; differences.push('Keyword does not belong to verified customer'); break;
         }
         if (r.ad_group?.resource_name !== externalState.adGroupResourceName) {
            hasDrift = true; differences.push('Keyword does not belong to expected ad group'); break;
         }
         if (r.ad_group_criterion?.keyword?.text !== kw.current_value || r.ad_group_criterion?.keyword?.match_type !== (kw.match_type || 'EXACT')) {
            hasDrift = true; differences.push('KEYWORD_MISMATCH'); break;
         }
      }`;

content = content.replace(kwTarget, kwReplacement);

// And the query for keyword needs to include ad_group.resource_name and customer.id!
const qTarget = `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type`;
const qReplacement = `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, customer.id, ad_group.resource_name`;
content = content.replace(qTarget, qReplacement);

fs.writeFileSync('src/lib/providers/google/reconciliation.ts', content);
