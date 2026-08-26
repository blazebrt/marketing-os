const fs = require('fs');

let content = fs.readFileSync('src/lib/providers/google/test-account.ts', 'utf-8');

// Change `return customerId;` to `return customerData.id.toString();`
content = content.replace(/return customerId;/, 'return customerData.id.toString();');

fs.writeFileSync('src/lib/providers/google/test-account.ts', content);
