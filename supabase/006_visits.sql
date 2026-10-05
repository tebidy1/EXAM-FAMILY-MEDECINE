-- ============================================================
-- Oman EM Prep — 006: the visitor funnel
-- Run in the SQL Editor AFTER 005_launch_offer.sql.
-- ADDITIVE: drops no data.
--
-- Until now nothing was recorded before sign-in: public.events only
-- accepts rows from a signed-in user, so a doctor who opened the app and
-- left was invisible. This table records the steps BEFORE the account
-- exists, so the place where people stop can be seen and fixed.
--
-- What is stored: a random id kept in the visitor's own browser, the step,
-- the kind of device, and — when the sign-up fails — the reason it failed.
-- No name, no email, no IP address, no tracking cookie.
--
-- Anyone holding the public key may insert a row (that is what makes an
-- anonymous visitor countable at all); nobody but an admin can read one,
-- and no one can change or delete one. Treat the numbers as a guide to
-- where the friction is, not as an audited count.
-- ============================================================

create table if not exists public.visits (
  id bigint generated always as identity primary key,
  vid uuid not null,                               -- the browser, not the person
  step text not null check (step in (
    'landing',        -- the landing page was opened
    'landing_cta',    -- the first button was tapped
    'guide',          -- the install guide was opened
    'app_open',       -- the app itself was opened
    'auth_view',      -- the sign-up / sign-in form was shown
    'auth_try',       -- the form was submitted
    'auth_fail',      -- the server or the form refused it (meta.reason says why)
    'auth_ok',        -- the account exists
    'install_sheet',  -- the install sheet was shown
    'install_ok',     -- the app reached the home screen
    'install_skip',   -- the install was declined
    'first_question'  -- the first question was answered
  )),
  device text not null default 'other' check (device in ('iphone', 'android', 'desktop', 'other')),
  in_app text,                                     -- Facebook / Instagram / TikTok … built-in browser
  standalone boolean not null default false,       -- already running as an installed app
  user_id uuid references auth.users(id) on delete set null,
  meta jsonb check (meta is null or pg_column_size(meta) < 2000),
  ts timestamptz not null default now()
);

create index if not exists visits_ts_idx on public.visits (ts desc);
create index if not exists visits_vid_idx on public.visits (vid, ts);
create index if not exists visits_step_idx on public.visits (step, ts desc);

alter table public.visits enable row level security;

-- a visitor has no account yet: the write has to be open, or there is
-- nothing to count. Reading stays with the admin, and no policy grants
-- update or delete to anyone.
drop policy if exists "anyone may log a step" on public.visits;
create policy "anyone may log a step" on public.visits
  for insert to anon, authenticated with check (true);

drop policy if exists "admin read" on public.visits;
create policy "admin read" on public.visits
  for select using (public.is_admin());

-- ---------- the funnel, counted by distinct browser per day ----------
create or replace view public.v_admin_funnel with (security_invoker = on) as
select ts::date                as day,
       step,
       device,
       (in_app is not null)    as in_app,
       standalone,
       count(distinct vid)     as visitors,
       count(*)                as hits
  from public.visits
 group by 1, 2, 3, 4, 5;

-- ---------- why sign-ups fail ----------
create or replace view public.v_admin_signup_errors with (security_invoker = on) as
select ts::date                            as day,
       device,
       coalesce(meta->>'reason', 'other')  as reason,
       count(distinct vid)                 as visitors,
       count(*)                            as hits
  from public.visits
 where step = 'auth_fail'
 group by 1, 2, 3;

-- ---------- which built-in browsers swallow visitors ----------
create or replace view public.v_admin_visit_sources with (security_invoker = on) as
select ts::date                   as day,
       coalesce(in_app, 'browser') as source,
       coalesce(meta->>'from', '') as came_from,
       count(distinct vid)        as visitors
  from public.visits
 where step in ('landing', 'app_open')
 group by 1, 2, 3;
