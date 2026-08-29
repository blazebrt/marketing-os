import type { PGlite } from '@electric-sql/pglite';

/**
 * A PGlite-backed stand-in for the supabase-js client.
 *
 * Enough of the query builder to run the real server actions against a real
 * database with the real migrations, so the end-to-end test exercises actual
 * SQL rather than a hand-written mock that agrees with whatever the code does.
 */

type Filter = [string, string, unknown];

function literal(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (Array.isArray(v)) {
    if (v.length === 0) return `'{}'`;
    if (v.every((x) => typeof x === 'string')) {
      return `ARRAY[${v.map((x) => `'${String(x).replace(/'/g, "''")}'`).join(',')}]::text[]`;
    }
    return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  }
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

function whereClause(filters: Filter[]): string {
  if (filters.length === 0) return '';
  const parts = filters.map(([op, col, val]) => {
    switch (op) {
      case 'eq': return `${col} = ${literal(val)}`;
      case 'neq': return `${col} <> ${literal(val)}`;
      case 'gt': return `${col} > ${literal(val)}`;
      case 'gte': return `${col} >= ${literal(val)}`;
      case 'lt': return `${col} < ${literal(val)}`;
      case 'lte': return `${col} <= ${literal(val)}`;
      case 'is': return val === null ? `${col} is null` : `${col} is ${literal(val)}`;
      case 'notIsNull': return `${col} is not null`;
      default: return 'TRUE';
    }
  });
  return ` where ${parts.join(' and ')}`;
}

export function createPgliteSupabase(db: PGlite, userId: string | null) {
  const from = (table: string) => {
    const filters: Filter[] = [];
    let op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
    let payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
    let onConflict: string | null = null;
    let orderBy: { column: string; asc: boolean }[] = [];
    let limitN: number | null = null;
    let wantsReturn = false;

    async function run(): Promise<{ data: unknown; error: { message: string } | null }> {
      try {
        if (op === 'insert' || op === 'upsert') {
          const rows = Array.isArray(payload) ? payload : [payload as Record<string, unknown>];
          const out: unknown[] = [];
          const conflictCols = onConflict ? onConflict.split(',').map((c) => c.trim()) : [];
          for (const row of rows) {
            const keys = Object.keys(row).filter((k) => row[k] !== undefined);
            const updatable = keys.filter((k) => !conflictCols.includes(k));
            const conflict = onConflict
              ? ` on conflict (${conflictCols.join(',')}) ` +
                (updatable.length === 0
                  ? 'do nothing'
                  : `do update set ${updatable.map((k) => `${k} = excluded.${k}`).join(', ')}`)
              : '';
            const sql =
              `insert into public.${table} (${keys.join(',')}) values (${keys.map((k) => literal(row[k])).join(',')})` +
              conflict + ` returning *`;
            const res = await db.query(sql);
            out.push(...(res.rows as unknown[]));
          }
          return { data: out, error: null };
        }

        if (op === 'update') {
          const body = payload as Record<string, unknown>;
          const sets = Object.keys(body)
            .filter((k) => body[k] !== undefined)
            .map((k) => `${k} = ${literal(body[k])}`);
          if (sets.length === 0) return { data: [], error: null };
          const res = await db.query(
            `update public.${table} set ${sets.join(', ')}${whereClause(filters)} returning *`
          );
          return { data: res.rows, error: null };
        }

        if (op === 'delete') {
          const res = await db.query(`delete from public.${table}${whereClause(filters)} returning *`);
          return { data: res.rows, error: null };
        }

        const order = orderBy.length
          ? ` order by ${orderBy.map((o) => `${o.column} ${o.asc ? 'asc' : 'desc'}`).join(', ')}`
          : '';
        const lim = limitN !== null ? ` limit ${limitN}` : '';
        const res = await db.query(`select * from public.${table}${whereClause(filters)}${order}${lim}`);
        return { data: res.rows, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    }

    const api: Record<string, unknown> = {
      select: (_cols?: string) => { wantsReturn = true; return api; },
      insert: (p: Record<string, unknown> | Record<string, unknown>[]) => { op = 'insert'; payload = p; return api; },
      upsert: (p: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string }) => {
        op = 'upsert'; payload = p; onConflict = opts?.onConflict ?? null; return api;
      },
      update: (p: Record<string, unknown>) => { op = 'update'; payload = p; return api; },
      delete: () => { op = 'delete'; return api; },
      eq: (c: string, v: unknown) => { filters.push(['eq', c, v]); return api; },
      neq: (c: string, v: unknown) => { filters.push(['neq', c, v]); return api; },
      gt: (c: string, v: unknown) => { filters.push(['gt', c, v]); return api; },
      gte: (c: string, v: unknown) => { filters.push(['gte', c, v]); return api; },
      lt: (c: string, v: unknown) => { filters.push(['lt', c, v]); return api; },
      lte: (c: string, v: unknown) => { filters.push(['lte', c, v]); return api; },
      is: (c: string, v: unknown) => { filters.push(['is', c, v]); return api; },
      not: (c: string, _op: string, _v: unknown) => { filters.push(['notIsNull', c, null]); return api; },
      order: (column: string, opts?: { ascending?: boolean }) => {
        orderBy.push({ column, asc: opts?.ascending !== false }); return api;
      },
      limit: (n: number) => { limitN = n; return api; },
      single: async () => {
        const { data, error } = await run();
        const rows = (data as unknown[]) || [];
        if (error) return { data: null, error };
        if (rows.length !== 1) return { data: rows[0] ?? null, error: { message: 'no rows' } };
        return { data: rows[0], error: null };
      },
      maybeSingle: async () => {
        const { data, error } = await run();
        const rows = (data as unknown[]) || [];
        return { data: rows[0] ?? null, error };
      },
      then: (resolve: (v: unknown) => unknown) => run().then(resolve),
    };
    void wantsReturn;
    return api;
  };

  return {
    from,
    auth: {
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      const argSql = Object.entries(args).map(([k, v]) => `${k} => ${literal(v)}`).join(', ');
      try {
        const res = await db.query(`select public.${fn}(${argSql}) as result`);
        return { data: (res.rows[0] as { result: unknown }).result, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
  };
}
