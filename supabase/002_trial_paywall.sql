-- ============================================================
-- Saudi Prep — 002: free trial → payment receipt → admin approval
-- Run ONCE in the SQL Editor, AFTER schema.sql.
-- ADDITIVE: drops nothing, keeps all data, safe to re-run.
-- Access codes keep working; this adds a second way in.
-- ============================================================

-- ---------- 1) profiles: contact + access state ----------
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists access_status text not null default 'trial';
alter table public.profiles add column if not exists reject_reason text;

do $$ begin
  alter table public.profiles add constraint profiles_access_status_check
    check (access_status in ('trial','pending','active','rejected'));
exception when duplicate_object then null; end $$;

-- ---------- 2) guard: doctors cannot grant themselves access ----------
-- (replaces the role-only guard; the existing trigger keeps pointing here)
-- Access fields change only through: an admin, the SQL editor / service role
-- (auth.uid() is null), or the RPCs below (they raise app.access_rpc).
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
  return new;
end $$;

-- everyone who already has access stays in
update public.profiles set access_status = 'active'
 where (code_id is not null or role = 'admin') and access_status <> 'active';

-- accounts created before this file ran: recover the WhatsApp number from signup
update public.profiles p set phone = nullif(trim(u.raw_user_meta_data ->> 'phone'), '')
  from auth.users u
 where u.id = p.id and p.phone is null;

-- signup: keep the WhatsApp number; first user ever is still the admin
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.profiles;
  insert into public.profiles (id, email, name, phone, role, access_status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), ''),
    case when n = 0 then 'admin' else 'doctor' end,
    case when n = 0 then 'active' else 'trial' end
  );
  return new;
end $$;

-- a redeemed code now also flips the account to active
create or replace function public.redeem_code(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and code_id is not null) then
    return true;
  end if;
  update public.access_codes set uses = uses + 1
   where code = upper(trim(p_code)) and active
     and (expires_at is null or expires_at > now())
     and uses < max_uses
   returning id into v_id;
  if v_id is null then return false; end if;
  perform set_config('app.access_rpc', '1', true);
  update public.profiles
     set code_id = v_id, access_status = 'active', reject_reason = null
   where id = auth.uid();
  perform set_config('app.access_rpc', '', true);
  insert into public.events (user_id, name, meta)
  values (auth.uid(), 'code_redeemed', jsonb_build_object('code', upper(trim(p_code))));
  return true;
end $$;

-- ---------- 3) payment details shown to doctors (single row) ----------
create table if not exists public.payment_settings (
  id int primary key default 1 check (id = 1),
  price text,
  beneficiary text,
  bank text,
  account text,
  pay_link text,
  whatsapp text,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.payment_settings enable row level security;
insert into public.payment_settings (id) values (1) on conflict (id) do nothing;

drop policy if exists "signed-in read settings" on public.payment_settings;
create policy "signed-in read settings" on public.payment_settings
  for select to authenticated using (true);
drop policy if exists "admins manage settings" on public.payment_settings;
create policy "admins manage settings" on public.payment_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- 4) access requests (one row per receipt sent) ----------
create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  receipt_path text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reject_reason text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);
create index if not exists access_requests_status_idx
  on public.access_requests (status, created_at desc);
alter table public.access_requests enable row level security;

-- read-only through the API; every write goes through the RPCs below
drop policy if exists "read own or admin" on public.access_requests;
create policy "read own or admin" on public.access_requests
  for select using (user_id = auth.uid() or public.is_admin());

grant select on public.payment_settings, public.access_requests to authenticated;
grant insert, update on public.payment_settings to authenticated;

-- ---------- 5) request RPCs ----------
-- doctor: "I uploaded my receipt at p_path" (replaces any earlier pending one)
create or replace function public.submit_request(p_path text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> auth.uid()::text then
    raise exception 'bad receipt path';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and access_status = 'active') then
    return null;
  end if;
  delete from public.access_requests where user_id = auth.uid() and status = 'pending';
  insert into public.access_requests (user_id, receipt_path)
  values (auth.uid(), p_path) returning id into v_id;
  perform set_config('app.access_rpc', '1', true);
  update public.profiles set access_status = 'pending', reject_reason = null where id = auth.uid();
  perform set_config('app.access_rpc', '', true);
  insert into public.events (user_id, name, meta)
  values (auth.uid(), 'receipt_submitted', jsonb_build_object('request', v_id));
  return v_id;
end $$;

-- admin: approve → permanent full access
create or replace function public.approve_request(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.access_requests
     set status = 'approved', reject_reason = null, reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_id returning user_id into v_user;
  if v_user is null then return false; end if;
  update public.profiles set access_status = 'active', reject_reason = null where id = v_user;
  return true;
end $$;

-- admin: reject with a reason the doctor sees (they can re-upload at once)
create or replace function public.reject_request(p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.access_requests
     set status = 'rejected', reject_reason = p_reason, reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_id returning user_id into v_user;
  if v_user is null then return false; end if;
  update public.profiles set access_status = 'rejected', reject_reason = p_reason
   where id = v_user and access_status <> 'active';
  return true;
end $$;

grant execute on function public.submit_request(text) to authenticated;
grant execute on function public.approve_request(uuid) to authenticated;
grant execute on function public.reject_request(uuid, text) to authenticated;

-- ---------- 6) admin views ----------
-- (new columns appended at the end so "create or replace" is accepted)
create or replace view public.v_admin_users with (security_invoker = on) as
select p.id, p.email, p.name, p.role, p.created_at, p.last_seen, p.code_id,
       coalesce(st.attempts, 0) as attempts,
       coalesce(st.covered, 0) as covered,
       coalesce(st.mastered, 0) as mastered,
       p.phone, p.access_status
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
       (select count(*) from public.progress g where g.user_id = r.user_id) as covered
from public.access_requests r
join public.profiles p on p.id = r.user_id;

grant select on public.v_admin_requests to authenticated;

-- ---------- 7) receipts bucket (private) ----------
-- files live at receipts/<user id>/<timestamp>.<ext>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "receipts: upload own" on storage.objects;
create policy "receipts: upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "receipts: read own or admin" on storage.objects;
create policy "receipts: read own or admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
