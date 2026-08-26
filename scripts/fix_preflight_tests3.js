const fs = require('fs');
let code = fs.readFileSync('tests/milestone6_preflight.test.ts', 'utf8');

const replacement = `
  const mockSupabase = {
    from: (table: string) => ({
      update: (updates: any) => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => {
                if (updates.status === 'ACTIVE') {
                  throw new Error('Reconciliation set status to ACTIVE incorrectly');
                }
                return Promise.resolve({ error: null });
              }
            })
          })
        })
      }),
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: () => Promise.resolve({
              data: {
                encrypted_credentials: JSON.stringify({ refresh_token: 'dummy' })
              },
              error: null
            })
          })
        })
      })
    })
  };
`;

code = code.replace(/const mockSupabase = \{[\s\S]*?from: \(\) => \(\{[\s\S]*?\}\n  \};\n/g, replacement);

fs.writeFileSync('tests/milestone6_preflight.test.ts', code);
