-- Use the server-only service_role key as SUPABASE_KEY. Never expose it to browser code.
-- The application enforces tenant ownership in every query; RLS keeps public client access closed.
create table if not exists public.sales_users (
  id uuid primary key,
  email text not null unique,
  password_hash text not null,
  tenant_id uuid not null unique,
  plan text not null default 'free' check (plan in ('free', 'pro', 'enterprise')),
  created_at timestamptz not null default now()
);

create table if not exists public.sales_leads (
  id uuid primary key,
  tenant_id uuid not null,
  user_id uuid not null references public.sales_users(id) on delete cascade,
  name text not null,
  email text not null default '',
  company text not null default '',
  status text not null default 'COLD'
    check (status in ('COLD', 'QUALIFIED', 'OBJECTION_HANDLING', 'CLOSING')),
  score integer not null default 0 check (score between 0 and 100),
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_leads_tenant_user_updated_idx
  on public.sales_leads (tenant_id, user_id, updated_at desc);

alter table public.sales_users enable row level security;
alter table public.sales_leads enable row level security;
