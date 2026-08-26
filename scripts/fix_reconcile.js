const fs = require('fs');

let code = fs.readFileSync('src/lib/providers/google/reconciliation.ts', 'utf-8');

// Replace the query and ad processing logic
code = code.replace(
  "SELECT ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.final_urls, customer.id",
  "SELECT ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.final_urls, customer.id, ad_group.resource_name"
);

const oldAdsBlock = `      if (adRes.length === 0) {
        status = 'MISSING'; differences.push('No ads found in AdGroup');
      } else {
        const ad = adRes[0].ad_group_ad?.ad;
        const custId = adRes[0].customer?.id?.toString();
        if (custId !== verifiedCustomerNum) { status = 'DRIFT'; differences.push('Ad does not belong to verified customer'); }
        
        const rsa = ad?.responsive_search_ad || {};
        const actualHeadlines = (rsa.headlines || []).map((h: any) => h.text.trim().toLowerCase()).sort();
        const actualDescriptions = (rsa.descriptions || []).map((d: any) => d.text.trim().toLowerCase()).sort();
        const actualUrls = (ad?.final_urls || []).map((u: any) => u.trim().toLowerCase()).sort();

        if (JSON.stringify(actualHeadlines) !== JSON.stringify(expectedHeadlines)) {
          status = 'DRIFT'; differences.push('HEADLINE_MISMATCH');
        }
        if (JSON.stringify(actualDescriptions) !== JSON.stringify(expectedDescriptions)) {
          status = 'DRIFT'; differences.push('DESCRIPTION_MISMATCH');
        }
        if (JSON.stringify(actualUrls) !== JSON.stringify(expectedUrls)) {
          status = 'DRIFT'; differences.push('DESTINATION_URL_MISMATCH');
        }
      }`;

const newAdsBlock = `      const expectedAdCount = 1;
      if (adRes.length === 0) {
        status = 'MISSING'; differences.push('No ads found in AdGroup');
      } else if (adRes.length !== expectedAdCount) {
        status = 'DRIFT'; differences.push(\`Ad count mismatch: Expected \${expectedAdCount}, found \${adRes.length}\`);
      } else {
        const row = adRes[0];
        const ad = row.ad_group_ad?.ad;
        const custId = row.customer?.id?.toString();
        const parentAdGroup = row.ad_group?.resource_name;
        if (custId !== verifiedCustomerNum) { status = 'DRIFT'; differences.push('Ad does not belong to verified customer'); }
        if (parentAdGroup !== externalState.adGroupResourceName) { status = 'DRIFT'; differences.push('Ad does not belong to expected ad group'); }
        
        const rsa = ad?.responsive_search_ad || {};
        const actualHeadlines = (rsa.headlines || []).map((h: any) => h.text.trim().toLowerCase()).sort();
        const actualDescriptions = (rsa.descriptions || []).map((d: any) => d.text.trim().toLowerCase()).sort();
        const actualUrls = (ad?.final_urls || []).map((u: any) => u.trim().toLowerCase()).sort();

        if (JSON.stringify(actualHeadlines) !== JSON.stringify(expectedHeadlines)) {
          status = 'DRIFT'; differences.push('HEADLINE_MISMATCH');
        }
        if (JSON.stringify(actualDescriptions) !== JSON.stringify(expectedDescriptions)) {
          status = 'DRIFT'; differences.push('DESCRIPTION_MISMATCH');
        }
        if (JSON.stringify(actualUrls) !== JSON.stringify(expectedUrls)) {
          status = 'DRIFT'; differences.push('DESTINATION_URL_MISMATCH');
        }
      }`;

code = code.replace(oldAdsBlock, newAdsBlock);
fs.writeFileSync('src/lib/providers/google/reconciliation.ts', code);
