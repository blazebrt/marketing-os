const fs = require('fs');

let content = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

const target = `async query(q: string) {
          if (q.includes('test_account')) return [{ customer: { test_account: true } }];`;

const replacement = `async query(q: string) {
          if (typeof (global as any).mockQueryFunc === 'function') {
            const res = await (global as any).mockQueryFunc(q);
            if (res !== '__FALLTHROUGH__') return res;
          }
          if (q.includes('test_account')) return [{ customer: { test_account: true } }];`;

content = content.replace(target, replacement);

fs.writeFileSync('tests/milestone6_comprehensive.test.ts', content);
