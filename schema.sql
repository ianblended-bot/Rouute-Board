-- ============================================================
-- Route Board — Supabase schema
--
-- HOW TO RUN THIS:
-- 1. Open your Supabase project
-- 2. Left sidebar → SQL Editor → New query
-- 3. Paste this whole file in and click "Run"
-- 4. You should see "Success. No rows returned"
--
-- Safe to re-run: every statement uses IF NOT EXISTS / OR REPLACE.
-- ============================================================

create table if not exists technicians (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  region text not null default 'floating',
  area text default '',
  tech_frequency_days int default 30,
  one_on_one_frequency_days int default 30,
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists sites (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  region text default 'floating',
  type text default 'qa',
  address text default '',
  technician_id bigint,
  qa_frequency_days int,
  notes text default '',
  active boolean default true,
  is_general boolean default false,
  created_at timestamptz default now()
);

create table if not exists events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  time text default '',
  type text not null,
  technician_id bigint,
  site_id bigint,
  title text default '',
  notes text default '',
  completed boolean default false,
  created_at timestamptz default now()
);

create table if not exists settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tech_visits_per_week_min int default 3,
  qa_visits_per_week_min int default 4,
  one_on_ones_per_week_max int default 3,
  wfh_weekday int default 3,
  updated_at timestamptz default now()
);

alter table technicians enable row level security;
alter table sites enable row level security;
alter table events enable row level security;
alter table settings enable row level security;

drop policy if exists "own rows" on technicians;
drop policy if exists "own rows" on sites;
drop policy if exists "own rows" on events;
drop policy if exists "own rows" on settings;

create policy "own rows" on technicians for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on sites       for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on events      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on settings    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
