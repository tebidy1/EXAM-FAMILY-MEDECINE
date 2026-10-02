-- ============================================================
-- Oman EM Prep — 003: two ways to pay — full, or the bank in 3 parts
-- Run ONCE in the SQL Editor, AFTER 002_trial_paywall.sql.
-- ADDITIVE: drops no data, safe to re-run.
--
-- A doctor either pays the full price (access_status = 'active', as
-- before) or buys the bank one third at a time: each approved "part"
-- receipt adds 1 to profiles.parts, and the app lets the doctor cover
-- parts/3 of the bank. The third part is full access.
-- ============================================================

-- ---------- 1) profiles: parts paid for (0..3) ----------
alter table public.profiles add column if not exists parts int not null default 0;

do $$ begin
  alter table public.profiles add constraint profiles_parts_check check (parts between 0 and 3);
exception when duplicate_object then null; end $$;

-- doctors cannot grant themselves parts either
create or replace function public.protect_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin()
     or current_setting('app.access_rpc', true) = '1' then
    return new;
  end if;
  new.role := old.role;
  new.code_id := old.code_id;
  new.access_status := old.access_status;
  new.reject_reason := old.reject_reason;
  new.parts := old.parts;
  return new;
end $$;

-- ---------- 2) prices: one for the full plan, one per part ----------
alter table public.payment_settings add column if not exists part_price text;
update public.payment_settings
   set price = coalesce(nullif(trim(price), ''), '25 ر.ع'),
       part_price = coalesce(nullif(trim(part_price), ''), '10 ر.ع')
 where id = 1;

-- ---------- 3) each receipt says what it pays for ----------
alter table public.access_requests add column if not exists plan text not null default 'full';

do $$ begin
  alter table public.access_requests add constraint access_requests_plan_check check (plan in ('full','part'));
exception when duplicate_object then null; end $$;

-- ---------- 4) request RPCs ----------
-- the one-argument version must go, or a call without p_plan is ambiguous
drop function if exists public.submit_request(text);

-- doctor: "I uploaded my receipt at p_path, for this plan" (replaces any earlier pending one)
create or replace function public.submit_request(p_path text, p_plan text default 'full') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> auth.uid()::text then
    raise exception 'bad receipt path';
  end if;
  if p_plan not in ('full', 'part') then raise exception 'bad plan'; end if;
  if exists (select 1 from public.profiles
              where id = auth.uid() and (access_status = 'active' or parts >= 3)) then
    return null;
  end if;
  delete from public.access_requests where user_id = auth.uid() and status = 'pending';
  insert into public.access_requests (user_id, receipt_path, plan)
  values (auth.uid(), p_path, p_plan) returning id into v_id;
  perform set_config('app.access_rpc', '1', true);
  update public.profiles set access_status = 'pending', reject_reason = null where id = auth.uid();
  perform set_config('app.access_rpc', '', true);
  insert into public.events (user_id, name, meta)
  values (auth.uid(), 'receipt_submitted', jsonb_build_object('request', v_id, 'plan', p_plan));
  return v_id;
end $$;

-- admin: approve → full access, or one more part (the third part is full access)
-- only a pending request counts, so a second click cannot add a second part
create or replace function public.approve_request(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_plan text;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.access_requests
     set status = 'approved', reject_reason = null, reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_id and status = 'pending'
   returning user_id, plan into v_user, v_plan;
  if v_user is null then return false; end if;
  if v_plan = 'part' then
    update public.profiles
       set parts = least(parts + 1, 3),
           access_status = case when parts + 1 >= 3 then 'active' else 'trial' end,
           reject_reason = null
     where id = v_user;
  else
    update public.profiles set access_status = 'active', reject_reason = null where id = v_user;
  end if;
  return true;
end $$;

grant execute on function public.submit_request(text, text) to authenticated;
grant execute on function public.approve_request(uuid) to authenticated;

-- ---------- 5) admin views (new columns appended at the end) ----------
create or replace view public.v_admin_users with (security_invoker = on) as
select p.id, p.email, p.name, p.role, p.created_at, p.last_seen, p.code_id,
       coalesce(st.attempts, 0) as attempts,
       coalesce(st.covered, 0) as covered,
       coalesce(st.mastered, 0) as mastered,
       p.phone, p.access_status, p.parts
from public.profiles p
left join (
  select user_id,
         sum(attempts) as attempts,
         count(*) as covered,
         sum(case when streak >= 3 then 1 else 0 end) as mastered
  from public.progress group by user_id
) st on st.user_id = p.id;

create or replace view public.v_admin_requests with (security_invoker = on) as
select r.id, r.user_id, r.receipt_path, r.status, r.reject_reason,
       r.created_at, r.reviewed_at,
       p.name, p.email, p.phone,
       (select count(*) from public.progress g where g.user_id = r.user_id) as covered,
       r.plan, p.parts
from public.access_requests r
join public.profiles p on p.id = r.user_id;

grant select on public.v_admin_requests to authenticated;
