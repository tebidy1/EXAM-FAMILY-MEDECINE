-- ============================================================
-- Oman EM Prep — Supabase schema (v2 — correct creation order)
-- Run ONCE in the SQL Editor.
-- ⚠ Re-running after real usage DROPS ALL DATA (guards at top).
-- The FIRST user to sign up becomes admin (bootstrap).
-- Then run 002_trial_paywall.sql (free trial + payment receipts).
-- ============================================================

-- ---------- 0) clean-slate guards (safe on first run) ----------
drop view if exists public.v_admin_sessions;
drop view if exists public.v_admin_codes;
drop view if exists public.v_admin_users;
drop table if exists public.events cascade;
drop table if exists public.sessions_log cascade;
drop table if exists public.progress cascade;
drop table if exists public.access_codes cascade;
drop table if exists public.profiles cascade;
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.redeem_code(text);
drop function if exists public.check_code(text);
drop function if exists public.protect_role();
drop function if exists public.handle_new_user();
drop function if exists public.is_admin();

-- ---------- 1) tables first (no policies yet) ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  role text not null default 'doctor' check (role in ('doctor','admin')),
  code_id uuid,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
alter table public.profiles enable row level security;

create table public.access_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  label text,
  max_uses int not null default 1 check (max_uses between 1 and 10000),
  uses int not null default 0,
  expires_at timestamptz,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.access_codes enable row level security;

-- ---------- 2) is_admin() — needs profiles, precedes all policies ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

-- ---------- 3) policies (is_admin now exists) ----------
create policy "read own or admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy "insert own" on public.profiles
  for insert with check (id = auth.uid());
create policy "update own or admin" on public.profiles
  for update using (id = auth.uid() or public.is_admin());

create policy "admins manage codes" on public.access_codes
  for all using (public.is_admin()) with check (public.is_admin());

-- role tampering guard: only admins may change role
create or replace function public.protect_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role <> old.role and not public.is_admin() then
    new.role := old.role;
  end if;
  return new;
end $$;
create trigger profiles_protect_role before update on public.profiles
  for each row execute function public.protect_role();

-- auto-create profile on signup; FIRST user ever becomes admin
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.profiles;
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    case when n = 0 then 'admin' else 'doctor' end
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 4) code RPCs (need access_codes) ----------
create or replace function public.check_code(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.access_codes
    where code = upper(trim(p_code)) and active
      and (expires_at is null or expires_at > now())
      and uses < max_uses
  );
$$;

create or replace function public.redeem_code(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then return false; end if;
  -- already redeemed by this account? treat as success
  if exists (select 1 from public.profiles where id = auth.uid() and code_id is not null) then
    return true;
  end if;
  update public.access_codes set uses = uses + 1
   where code = upper(trim(p_code)) and active
     and (expires_at is null or expires_at > now())
     and uses < max_uses
   returning id into v_id;
  if v_id is null then return false; end if;
  update public.profiles set code_id = v_id where id = auth.uid();
  insert into public.events (user_id, name, meta)
  values (auth.uid(), 'code_redeemed', jsonb_build_object('code', upper(trim(p_code))));
  return true;
end $$;

-- ---------- 5) progress ----------
create table public.progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null,
  section_id text,
  streak int not null default 0,
  attempts int not null default 0,
  correct int not null default 0,
  last_seen timestamptz not null default now(),
  primary key (user_id, question_id)
);
create index on public.progress (user_id);
alter table public.progress enable row level security;
create policy "own write" on public.progress
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "admin read" on public.progress
  for select using (public.is_admin());

-- ---------- 6) sessions log ----------
create table public.sessions_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text,
  ref_id text,
  title text,
  score int,
  total int,
  ts timestamptz not null default now()
);
create index on public.sessions_log (user_id, ts desc);
alter table public.sessions_log enable row level security;
create policy "own insert" on public.sessions_log
  for insert with check (user_id = auth.uid());
create policy "own read" on public.sessions_log
  for select using (user_id = auth.uid() or public.is_admin());

-- ---------- 7) events (funnel) ----------
create table public.events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  meta jsonb,
  ts timestamptz not null default now()
);
create index on public.events (user_id, ts desc);
alter table public.events enable row level security;
create policy "own insert" on public.events
  for insert with check (user_id = auth.uid());
create policy "admin read" on public.events
  for select using (public.is_admin());

-- ---------- 8) admin views (RLS-aware via security_invoker) ----------
create or replace view public.v_admin_users with (security_invoker = on) as
select p.id, p.email, p.name, p.role, p.created_at, p.last_seen, p.code_id,
       coalesce(st.attempts, 0) as attempts,
       coalesce(st.covered, 0) as covered,
       coalesce(st.mastered, 0) as mastered
from public.profiles p
left join (
  select user_id,
         sum(attempts) as attempts,
         count(*) as covered,
         sum(case when streak >= 3 then 1 else 0 end) as mastered
  from public.progress group by user_id
) st on st.user_id = p.id;

create or replace view public.v_admin_codes with (security_invoker = on) as
select c.id, c.code, c.label, c.max_uses, c.uses, c.expires_at, c.active, c.created_at,
       (select count(*) from public.profiles p where p.code_id = c.id) as redeemed_by
from public.access_codes c;

create or replace view public.v_admin_sessions with (security_invoker = on) as
select s.id, s.user_id, s.kind, s.ref_id, s.title, s.score, s.total, s.ts,
       p.email, p.name
from public.sessions_log s
join public.profiles p on p.id = s.user_id;

-- ---------- 9) (optional) admin fallback code ----------
-- Un-comment, run once, and keep this code to reach the admin panel
-- if you ever lose access to the first (admin) account:
-- insert into public.access_codes (code, label, max_uses)
-- values ('ADMIN-2026', 'bootstrap admin', 1);
