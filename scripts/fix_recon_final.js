const fs = require('fs');
let content = fs.readFileSync('src/lib/providers/google/reconciliation.ts', 'utf-8');

const target1 = `      if (kwRes.length > 0) {
        const custId = kwRes[0].customer?.id?.toString();
        if (custId !== verifiedCustomerNum) { status = 'DRIFT'; differences.push('Keyword does not belong to verified customer'); }
      }`;
      
const replace1 = `      for (const r of kwRes) {
        const customerId = r.customer?.id?.toString();
        const adGroupResourceName = r.ad_group?.resource_name;

        if (customerId !== verifiedCustomerNum) {
          status = 'DRIFT';
          differences.push('Keyword does not belong to verified customer');
        }

        if (adGroupResourceName !== externalState.adGroupResourceName) {
          status = 'DRIFT';
          differences.push('Keyword does not belong to expected ad group');
        }
      }`;

content = content.replace(target1, replace1);

const target2 = `  } catch (err: any) {
    const sanitizedMsg = (err.message || '').replace(/bearer\\s+[A-Za-z0-9-_=]+/ig, 'Bearer [REDACTED]');
    throw new GoogleProviderError(ERROR_CODES.INTERNAL_ERROR, 'Failed to reconcile', { originalError: sanitizedMsg });
  }`;

const replace2 = `  } catch (err: any) {
    if (err instanceof GoogleProviderError) {
      throw err;
    }
    throw new GoogleProviderError(
      ERROR_CODES.INTERNAL_ERROR,
      'Failed to reconcile'
    );
  }`;
  
content = content.replace(target2, replace2);

fs.writeFileSync('src/lib/providers/google/reconciliation.ts', content);
