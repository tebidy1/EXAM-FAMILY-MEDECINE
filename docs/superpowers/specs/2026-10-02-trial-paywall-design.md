# Free Trial → Payment Receipt → Admin Approval — Design Spec

Date: 2026-10-02 · Status: built (owner delegated the choices: "pick the easiest path for the doctor, pilot phase")

## Goal
A doctor opens a public link, signs up without a code, tries 15 questions, pays by
bank transfer, uploads the receipt, and is unlocked by the owner with one click.
The owner sees who is waiting instead of handing out codes blind.

## Decisions
- **Codes stay** as a side door (entered on the payment screen); requests are the main path.
- **Approval = permanent access.** No expiry, no renewal.
- **Trial = 15 unique questions across all sections**, counted from the `progress`
  rows the server holds. Trial answers are flushed immediately; the count is merged
  from the server before the first screen, so clearing the browser does not reset it.
- **Contact is collected at signup** (WhatsApp), so the payment screen needs no typing:
  pick the receipt, send.
- **Rejection is not a dead end**: preset reason, shown to the doctor, re-upload at once.
- **Gate lives in the client** (pilot phase). Known limit: the question JSON files are
  static and publicly fetchable; moving them behind RLS is a separate, later piece of work.

## Data model (`supabase/002_trial_paywall.sql`, additive)
- `profiles` + `phone`, `access_status` (`trial|pending|active|rejected`), `reject_reason`
- `protect_role()` now also freezes `code_id`, `access_status`, `reject_reason` for
  non-admins; RPCs lift it through the transaction-local `app.access_rpc` setting
- `payment_settings` (single row): price, beneficiary, bank, account, pay_link, whatsapp, note
- `access_requests(id, user_id, receipt_path, status, reject_reason, created_at, reviewed_at, reviewed_by)`
- RPCs: `submit_request(path)`, `approve_request(id)`, `reject_request(id, reason)`; `redeem_code` also sets `active`
- Storage: private bucket `receipts`, files at `<user id>/<timestamp>.<ext>`; owner uploads, owner + admin read
- Views: `v_admin_users` (+phone, access_status), `v_admin_requests`

## App (`js/app.js`)
- Full access = admin, redeemed code, or `access_status = 'active'`
- New visitor lands on onboarding/signup; a browser that has had an account lands on login
- Trial bar on tab screens, pill in the quiz; a timed test is cut to the questions left
- Trial used up ⇒ every route shows the payment screen: price, account (copy button),
  optional pay link, receipt upload (image shrunk to 1600px in the browser, PDF as-is), code box
- `pending` screen polls the profile every 15 s and unlocks itself on approval
- Local cache is tied to the account (`store.uid`): a second account on the same browser starts clean
- Fixed along the way: `window.Sync` was undefined (top-level `const`), so answers were
  never queued and sessions never logged — progress only uploaded on the next boot

## Admin (`js/admin.js`)
- **Requests** tab (opens first when something is waiting, badge + count in the page title,
  refreshes every 45 s): receipt thumbnail, WhatsApp link, approve / reject with reason
- **Payment** tab: the details doctors see
- **Doctors**: status chip, WhatsApp link, manual activate / deactivate

## Testing
- `tools/dev-server.js`: in-memory stand-in for the Supabase endpoints. Verified in the
  browser on it: signup validation, 15-question limit, paywall, receipt upload + shrink,
  reject → re-upload → approve → auto-unlock, code redemption, second account on the same
  browser, local-storage wipe keeping the count, timed-test cap, payment settings, manual activation.
- Not verified: the SQL file against a real Postgres (no database access from the dev machine).

## Not in this piece
Protecting the question bank behind RLS · admin notification by email/WhatsApp on a new
receipt · online payment gateway.
