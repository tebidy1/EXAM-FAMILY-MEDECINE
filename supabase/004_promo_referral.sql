-- ============================================================
-- Saudi Prep — 004: promo codes + referrals (bonus free questions)
-- Run ONCE in the SQL Editor, AFTER 003_plans.sql.
-- ADDITIVE: drops no data, safe to re-run.
--
-- A new, lighter currency than full access: BONUS QUESTIONS. They add
-- to the free-trial limit (profiles.bonus_questions), so a doctor can
-- keep studying for free beyond the free trial without paying. Two ways
-- to earn them, both configured from the admin platform:
--
--   • Promo codes — the doctor enters a code and it opens N more
--     questions (N is set per code when the admin generates it).
--   • Referrals  — every doctor gets a personal invite link. When a
--     friend signs up through it the inviter earns a small reward; when
--     that friend later subscribes the inviter earns a bigger one; and
--     the friend themselves starts with a welcome bonus. All three
--     numbers are admin settings, and 0 disables that reward.
--
-- Nothing a doctor can touch grants questions to themselves: every
-- increment runs through the security-definer RPC / triggers below,
-- guarded by the same app.access_rpc flag the paywall already uses.
-- ============================================================

-- ---------- 1) profiles: bonus balance + referral identity ----------
alter table public.profiles add column if not exists bonus_questions int not null default 0;
alter table public.profiles add column if not exists referral_code text;
alter table public.profiles add column if not exists referred_by uuid references auth.users(id) on delete set null;
alter table public.profiles add column if not exists referrals int not null default 0;        -- friends who signed up
alter table public.profiles add column if not exists referrals_paid int not null default 0;   -- of those, how many subscribed
alter table public.profiles add column if not exists ref_paid_rewarded boolean not null default false; -- the paid bonus for MY inviter was granted

do $$ begin
  alter table public.profiles add constraint profiles_bonus_check check (bonus_questions between 0 and 1000000);
exception when duplicate_object then null; end $$;

-- ---------- 2) a short, unique, unambiguous referral code ----------
create or replace function public.gen_referral_code() returns text
language plpgsql security definer set search_path = public as $$
declare a text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; c text; i int;
begin
  loop
    c := '';
    for i in 1..6 loop c := c || substr(a, 1 + floor(random() * length(a))::int, 1); end loop;
    exit when not exists (select 1 from public.profiles where referral_code = c);
  end loop;
  return c;
end $$;

-- every existing account gets one, then enforce uniqueness
update public.profiles set referral_code = public.gen_referral_code() where referral_code is null;
create unique index if not exists profiles_referral_code_key on public.profiles (referral_code);

-- ---------- 3) guard: doctors cannot grant themselves anything ----------
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
  new.bonus_questions := old.bonus_questions;
  new.referral_code := old.referral_code;
  new.referred_by := old.referred_by;
  new.referrals := old.referrals;
  new.referrals_paid := old.referrals_paid;
  new.ref_paid_rewarded := old.ref_paid_rewarded;
  return new;
end $$;

-- ---------- 4) referral + bonus settings (reuse the single settings row) ----------
alter table public.payment_settings add column if not exists referral_reward_signup int not null default 0; -- inviter, when a friend signs up
alter table public.payment_settings add column if not exists referral_reward_paid   int not null default 0; -- inviter, when that friend subscribes
alter table public.payment_settings add column if not exists referral_signup_bonus  int not null default 0; -- the invited friend's welcome bonus

-- ---------- 5) signup: referral code, welcome bonus, inviter reward ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n int; v_ref text; v_inviter uuid;
  v_signup int := 0; v_welcome int := 0;
begin
  select count(*) into n from public.profiles;

  v_ref := nullif(upper(trim(new.raw_user_meta_data ->> 'ref')), '');
  if v_ref is not null then
    select id into v_inviter from public.profiles where referral_code = v_ref;
  end if;

  select coalesce(referral_reward_signup, 0), coalesce(referral_signup_bonus, 0)
    into v_signup, v_welcome
    from public.payment_settings where id = 1;

  insert into public.profiles (id, email, name, phone, role, access_status,
                               referral_code, referred_by, bonus_questions)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), ''),
    case when n = 0 then 'admin' else 'doctor' end,
    case when n = 0 then 'active' else 'trial' end,
    public.gen_referral_code(),
    v_inviter,
    case when v_inviter is not null then coalesce(v_welcome, 0) else 0 end
  );

  if v_inviter is not null and v_inviter <> new.id then
    update public.profiles
       set bonus_questions = bonus_questions + coalesce(v_signup, 0),
           referrals = referrals + 1
     where id = v_inviter;
    insert into public.events (user_id, name, meta)
    values (v_inviter, 'referral_signup',
            jsonb_build_object('invitee', new.id, 'reward', v_signup));
  end if;
  return new;
end $$;

-- ---------- 6) when an invited friend subscribes, reward the inviter ----------
-- fires once, the first time the invitee reaches full access by any path
-- (admin approval, a redeemed code, or buying the last part).
create or replace function public.grant_referral_paid() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_paid int := 0; v_new_full boolean; v_old_full boolean;
begin
  if new.referred_by is null or coalesce(old.ref_paid_rewarded, false) then
    return new;
  end if;
  v_new_full := (new.access_status = 'active' or coalesce(new.parts, 0) >= 3
                 or new.code_id is not null or new.role = 'admin');
  v_old_full := (old.access_status = 'active' or coalesce(old.parts, 0) >= 3
                 or old.code_id is not null or old.role = 'admin');
  if v_new_full and not v_old_full then
    select coalesce(referral_reward_paid, 0) into v_paid from public.payment_settings where id = 1;
    new.ref_paid_rewarded := true;
    update public.profiles
       set bonus_questions = bonus_questions + coalesce(v_paid, 0),
           referrals_paid = referrals_paid + 1
     where id = new.referred_by;
    insert into public.events (user_id, name, meta)
    values (new.referred_by, 'referral_paid',
            jsonb_build_object('invitee', new.id, 'reward', v_paid));
  end if;
  return new;
end $$;

drop trigger if exists profiles_referral_paid on public.profiles;
create trigger profiles_referral_paid before update on public.profiles
  for each row execute function public.grant_referral_paid();

-- ---------- 7) promo codes (each opens N questions, re-usable up to max_uses) ----------
create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  label text,
  reward_questions int not null default 0 check (reward_questions between 0 and 1000000),
  max_uses int not null default 1 check (max_uses between 1 and 1000000),
  uses int not null default 0,
  expires_at timestamptz,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.promo_codes enable row level security;
drop policy if exists "admins manage promos" on public.promo_codes;
create policy "admins manage promos" on public.promo_codes
  for all using (public.is_admin()) with check (public.is_admin());

-- one redemption per account per code, so a code can't be spent twice by one doctor
create table if not exists public.promo_redemptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  promo_id uuid not null references public.promo_codes(id) on delete cascade,
  reward int not null default 0,
  redeemed_at timestamptz not null default now(),
  primary key (user_id, promo_id)
);
alter table public.promo_redemptions enable row level security;
drop policy if exists "own or admin read redemptions" on public.promo_redemptions;
create policy "own or admin read redemptions" on public.promo_redemptions
  for select using (user_id = auth.uid() or public.is_admin());

grant select, insert, update, delete on public.promo_codes to authenticated;
grant select on public.promo_redemptions to authenticated;

-- ---------- 8) redeem a promo: validate, bank the questions, report back ----------
-- returns {ok, reward} on success, {ok:false, error:'invalid'|'used'|'auth'} otherwise
create or replace function public.redeem_promo(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_reward int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  select id, reward_questions into v_id, v_reward
    from public.promo_codes
   where code = upper(trim(p_code)) and active
     and (expires_at is null or expires_at > now())
     and uses < max_uses
   for update;
  if v_id is null then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if exists (select 1 from public.promo_redemptions where user_id = auth.uid() and promo_id = v_id) then
    return jsonb_build_object('ok', false, 'error', 'used');
  end if;
  update public.promo_codes set uses = uses + 1 where id = v_id;
  insert into public.promo_redemptions (user_id, promo_id, reward) values (auth.uid(), v_id, v_reward);
  perform set_config('app.access_rpc', '1', true);
  update public.profiles set bonus_questions = bonus_questions + coalesce(v_reward, 0) where id = auth.uid();
  perform set_config('app.access_rpc', '', true);
  insert into public.events (user_id, name, meta)
  values (auth.uid(), 'promo_redeemed', jsonb_build_object('code', upper(trim(p_code)), 'reward', v_reward));
  return jsonb_build_object('ok', true, 'reward', coalesce(v_reward, 0));
end $$;

grant execute on function public.redeem_promo(text) to authenticated;

-- ---------- 9) admin views (new columns appended at the end) ----------
create or replace view public.v_admin_users with (security_invoker = on) as
select p.id, p.email, p.name, p.role, p.created_at, p.last_seen, p.code_id,
       coalesce(st.attempts, 0) as attempts,
       coalesce(st.covered, 0) as covered,
       coalesce(st.mastered, 0) as mastered,
       p.phone, p.access_status, p.parts,
       p.bonus_questions, p.referral_code, p.referred_by, p.referrals, p.referrals_paid
from public.profiles p
left join (
  select user_id,
         sum(attempts) as attempts,
         count(*) as covered,
         sum(case when streak >= 3 then 1 else 0 end) as mastered
  from public.progress group by user_id
) st on st.user_id = p.id;

create or replace view public.v_admin_promos with (security_invoker = on) as
select c.id, c.code, c.label, c.reward_questions, c.max_uses, c.uses,
       c.expires_at, c.active, c.created_at,
       (select count(*) from public.promo_redemptions r where r.promo_id = c.id) as redeemed_by
from public.promo_codes c;

grant select on public.v_admin_promos to authenticated;
