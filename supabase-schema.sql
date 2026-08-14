-- Run once in a NEW Supabase project (separate from PentScribe/SentraMap) -> SQL Editor -> Run.

create table if not exists org_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  provider text not null,
  refresh_token text,
  access_token text,
  connected_at timestamptz default now(),
  unique(user_id, provider)
);

create table if not exists subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'inactive',
  stripe_customer_id text,
  updated_at timestamptz default now()
);

alter table org_connections enable row level security;
alter table subscriptions enable row level security;

create policy "Users manage their own connections"
  on org_connections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users read their own subscription"
  on subscriptions for select
  using (auth.uid() = user_id);

-- refresh_token/access_token are sensitive credentials. Only the server's service_role
-- key (never exposed to the browser) can read them, bypassing RLS for API calls.
