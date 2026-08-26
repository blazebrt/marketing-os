const fs = require('fs');
let c = fs.readFileSync('src/lib/providers/google/reconciliation.ts', 'utf-8');
c = c.replace(
  "import { createServerClient } from '../../supabase/server';", 
  "import { createClient as createServerClient } from '../../supabase/server';"
);
fs.writeFileSync('src/lib/providers/google/reconciliation.ts', c);
