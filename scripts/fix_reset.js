const fs = require('fs');

let content = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

content = content.replace(
  "const resetDeployment = async (status = 'READY_TO_DEPLOY', ts = targetState) => {",
  "const resetDeployment = async (status = 'READY_TO_DEPLOY', ts = targetState, ext = {}) => {"
);
content = content.replace(
  "VALUES ($1, $2, 'google', $3, $4, '{}')\", [campId, ownerA, status, JSON.stringify(ts)]);",
  "VALUES ($1, $2, 'google', $3, $4, $5)\", [campId, ownerA, status, JSON.stringify(ts), JSON.stringify(ext)]);"
);

fs.writeFileSync('tests/milestone6_comprehensive.test.ts', content);
