import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'fs';
import path from 'path';

export async function createM7Database() {
  // Build the database from the real migrations rather than a hand-written
  // partial copy, so these tests exercise the schema and RPCs we actually ship.
  const db = new PGlite({ extensions: { pgcrypto } });

  // Supabase provides the auth schema; PGlite does not. The policies and RPCs
  // in the migrations call auth.uid(), so it has to exist before they load.
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql as $$ select null::uuid; $$;
  `);

  const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
  for (const file of fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }

  return db;
}

export async function setAuthUid(db: PGlite, userId: string | null) {
  if (!userId) {
    await db.exec(`create or replace function auth.uid() returns uuid language sql as $$ select null::uuid; $$;`);
    return;
  }
  await db.exec(`create or replace function auth.uid() returns uuid language sql as $$ select '${userId}'::uuid; $$;`);
}

export function createPgLiteSupabase(db: PGlite, userId: string | null) {
  const quote = (v: unknown) => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (Array.isArray(v) || (typeof v === 'object')) return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
    return `'${String(v).replace(/'/g, "''")}'`;
  };

  async function execute(ctx: any) {
    try {
      if (ctx.op === 'insert') {
        const rows = Array.isArray(ctx.payload) ? ctx.payload : [ctx.payload];
        const inserted: any[] = [];
        for (const row of rows) {
          const keys = Object.keys(row);
          const vals = keys.map((k) => {
            const v = row[k];
            if (v === null || v === undefined) return 'NULL';
            if (typeof v === 'number' || typeof v === 'boolean') return String(v);
            if (Array.isArray(v) && keys.includes('channels') === false && typeof v[0] !== 'string') {
              return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
            }
            if (Array.isArray(v) && typeof v[0] === 'object') {
              return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
            }
            if (Array.isArray(v) && typeof v[0] === 'string') {
              return `ARRAY[${v.map((x) => `'${String(x).replace(/'/g, "''")}'`).join(',')}]`;
            }
            if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
            return `'${String(v).replace(/'/g, "''")}'`;
          });
          const sql = `insert into public.${ctx.table} (${keys.join(',')}) values (${vals.join(',')}) returning *`;
          const res = await db.query(sql);
          inserted.push(...(res.rows as any[]));
        }
        return { rows: inserted, error: null };
      }

      if (ctx.op === 'update') {
        const sets = Object.entries(ctx.payload)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k} = ${quote(v)}`);
        const wheres = ctx.filters.map((f: any[]) => {
          if (f[0] === 'eq') return `${f[1]} = ${quote(f[2])}`;
          if (f[0] === 'neq') return `${f[1]} <> ${quote(f[2])}`;
          return 'TRUE';
        });
        const sql = `update public.${ctx.table} set ${sets.join(', ')} where ${wheres.join(' and ')} returning *`;
        const res = await db.query(sql);
        return { rows: res.rows as any[], error: null };
      }

      const wheres = ctx.filters.map((f: any[]) => {
        if (f[0] === 'eq') return `${f[1]} = ${quote(f[2])}`;
        if (f[0] === 'neq') return `${f[1]} <> ${quote(f[2])}`;
        return 'TRUE';
      });
      const sql = `select * from public.${ctx.table} ${wheres.length ? 'where ' + wheres.join(' and ') : ''}`;
      const res = await db.query(sql);
      return { rows: res.rows as any[], error: null };
    } catch (e: any) {
      return { rows: [], error: { message: e.message } };
    }
  }

  const from = (table: string) => {
    const ctx: any = { table, filters: [], op: 'select', payload: null };
    const api: any = {
      select: () => api,
      insert: (payload: any) => {
        ctx.op = 'insert';
        ctx.payload = payload;
        return api;
      },
      update: (payload: any) => {
        ctx.op = 'update';
        ctx.payload = payload;
        return api;
      },
      eq: (k: string, v: any) => {
        ctx.filters.push(['eq', k, v]);
        return api;
      },
      neq: (k: string, v: any) => {
        ctx.filters.push(['neq', k, v]);
        return api;
      },
      single: async () => {
        const res = await execute(ctx);
        if (res.error) return { data: null, error: res.error };
        return { data: res.rows[0] || null, error: res.rows[0] ? null : { message: 'not found' } };
      },
      then: (resolve: any, reject: any) =>
        execute(ctx).then((res) => resolve({ data: res.rows, error: res.error }), reject),
    };
    return api;
  };

  return {
    auth: {
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: userId ? null : { message: 'Auth required' },
      }),
    },
    rpc: async (name: string, args: any) => {
      try {
        if (name === 'rpc_acquire_generation_lock') {
          const res = await db.query('select public.rpc_acquire_generation_lock($1) as result', [args.p_campaign_id]);
          return { data: (res.rows[0] as any).result, error: null };
        }
        if (name === 'rpc_approve_campaign') {
          const res = await db.query('select public.rpc_approve_campaign($1, $2) as result', [
            args.p_campaign_id,
            args.p_owner_id,
          ]);
          return { data: (res.rows[0] as any).result, error: null };
        }
        return { data: null, error: { message: 'unknown rpc' } };
      } catch (e: any) {
        return { data: null, error: { message: e.message } };
      }
    },
    from,
  };
}
