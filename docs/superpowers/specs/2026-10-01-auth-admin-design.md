# Auth, Access Codes & Admin Platform — Design Spec

Date: 2026-10-01 · Status: approved (user said "واصل" on the recommended options)

## Goal
Gate the platform behind access codes, give each doctor a persistent account
(progress follows them across devices), and give the founder a small admin
platform that answers: who is using the product, are they progressing, where
do they drop off.

## Decisions
- **Backend: Supabase free tier** (Postgres + Auth + PostgREST + RLS). Chosen over Firebase (analytical queries are painful) and over a custom Node server (hosting/auth/security burden, slower to market).
- **Identity: email + password, gated by an access code at signup.** Code-only device identity rejected: progress trapped on one device, codes leak as shared passwords, no email channel for future comms.
- **Client stays dependency-free**: plain `fetch` against Supabase Auth + PostgREST — no SDK.
- **Local-first sync**: localStorage remains the working store; server is source of truth after login. Offline-tolerant queue.

## Data model (Supabase Postgres)
- `access_codes(id, code unique, label, max_uses, uses, expires_at, active, created_by, created_at)`
- `profiles(id → auth.users, email, name, role doctor|admin, code_id, created_at, last_seen)`
  - trigger copies email on signup; **the first user ever becomes admin** (bootstrap)
  - trigger prevents non-admins from changing `role`
- `progress(user_id, question_id, section_id, streak, attempts, correct, last_seen)` PK(user_id, question_id)
- `sessions_log(id, user_id, kind, ref_id, title, score, total, ts)`
- `events(id, user_id, name, meta jsonb, ts)`
- RPCs (security definer): `check_code(code)` (anon, existence check), `redeem_code(code)` (atomic: validates active/expiry/uses, increments uses, stamps profile.code_id)
- Admin views (`security_invoker = on`): `v_admin_users`, `v_admin_codes`, `v_admin_sessions`
- RLS: doctors read/write only their own rows; `is_admin()` unlocks read-all + code management

## App integration
- `js/config.js` holds `{ url, anonKey }`; empty → **local mode** (current behavior, no gate, nothing breaks)
- Boot: `SB.init()` (load/refresh session, fetch profile) → not authed ⇒ auth screen; authed doctor without redeemed code ⇒ redeem screen
- Sync: on login merge server/local progress (newer `last_seen` wins per question); every attempt queues its question; flush upserts every 30 s and after sessions; exam finishes log a `sessions_log` row + event; heartbeat updates `profiles.last_seen`
- Topbar gains a user chip (name · logout) on tab screens

## Admin platform (`admin.html` + `js/admin.js`, same design system)
1. **Overview** — cards: doctors, active last 7 days, avg coverage, codes remaining; 14-day activity bars (pure CSS)
2. **Doctors** — table (search, last seen, coverage, attempts, mastered), drill-down per doctor (weak sections via `progress.section_id`, recent sessions)
3. **Codes** — batch generate (count, label, max_uses, expiry days), table with usage + redeemed-by, revoke/restore

MVP cuts (phase 2+): email verification UI, password-reset UI, billing, question-difficulty analytics, leaderboards.

## Testing
- Local mode unaffected (empty config ⇒ no gate) — verified in browser
- Auth screens + error paths verified in browser (live backend requires the owner's Supabase project)
- Live end-to-end requires the owner to: create the Supabase project, run `supabase/schema.sql`, paste URL + anon key into `js/config.js`
