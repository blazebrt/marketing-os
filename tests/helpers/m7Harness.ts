import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

export async function createM7Database() {
  const db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql as $$ select null::uuid; $$;

    create type unified_campaign_status as enum ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'READY_TO_DEPLOY', 'ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED');
    create type channel_deployment_status as enum ('PENDING', 'PREPARING', 'DEPLOYED', 'FAILED', 'PAUSED', 'READY_TO_DEPLOY', 'DEPLOYMENT_LOCKED', 'CREATING_CAMPAIGN', 'CREATING_AD_GROUP', 'CREATING_ADS', 'CREATING_KEYWORDS', 'VERIFYING', 'ACTIVE');

    create table public.unified_campaigns (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      service text not null,
      offer text not null,
      budget_type text not null,
      budget_amount numeric(15, 2) not null,
      duration_days int not null,
      max_daily_spend numeric(15, 2) not null,
      max_campaign_spend numeric(15, 2) not null,
      max_auto_budget_increase numeric(15, 2) not null default 0,
      destination text not null,
      channels text[] not null,
      creative_id text,
      status unified_campaign_status not null default 'DRAFT',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table public.channel_deployments (
      id uuid primary key default gen_random_uuid(),
      campaign_id uuid not null references public.unified_campaigns(id) on delete cascade,
      owner_id uuid not null,
      provider text not null,
      status channel_deployment_status not null default 'PENDING',
      target_state jsonb not null default '{}'::jsonb,
      actual_state jsonb not null default '{}'::jsonb,
      reconciliation_status text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(campaign_id, provider)
    );

    create table public.creatives (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      name text not null,
      type text not null,
      file_url text,
      created_at timestamptz not null default now()
    );

    create table public.creatives_google (
      id uuid primary key default gen_random_uuid(),
      creative_id uuid not null references public.creatives(id) on delete cascade,
      owner_id uuid not null,
      google_asset_id text,
      headlines jsonb not null default '[]'::jsonb,
      descriptions jsonb not null default '[]'::jsonb,
      keywords jsonb not null default '[]'::jsonb,
      created_at timestamptz not null default now()
    );

    create table public.integrations (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      provider text not null,
      status text not null
    );

    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      action text not null,
      resource_type text,
      resource_id text,
      details jsonb,
      created_at timestamptz not null default now()
    );
  `);

  const migration = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/011_milestone7_creatives.sql'), 'utf8');
  await db.exec(migration);
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
