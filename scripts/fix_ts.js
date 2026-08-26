const fs = require('fs');
let c = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

c = c.replace(/Object\.defineProperty\(process\.env, 'NODE_ENV', \{ value: '(.*?)';/g, "Object.defineProperty(process.env, 'NODE_ENV', { value: '$1' });");

// Fix TS2571
c = c.replace(/} catch\(e: any\) { assert\(e\.message/g, "} catch(e: any) { assert(e.message");
c = c.replace(/catch\(e\) \{ assert\(e\.message/g, "catch(e: any) { assert(e.message");

fs.writeFileSync('tests/milestone6_comprehensive.test.ts', c);
