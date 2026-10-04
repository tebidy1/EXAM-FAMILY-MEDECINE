-- ============================================================
-- Oman EM Prep — 005: launch offer
-- Run in the SQL Editor AFTER 004_promo_referral.sql.
-- ADDITIVE: drops no data.
--
--   • Referral rewards: the inviter earns 30 questions when a colleague
--     signs up through their link, and 50 more when that colleague
--     subscribes. The invited colleague's welcome bonus is left as it is
--     (0 unless changed in the admin Growth tab).
--   • Promo code NOOR130: 45 extra questions on top of the 25 free ones
--     (70 in total), for the first 130 accounts that enter it.
--
-- Re-running sets the two reward numbers back to 30 / 50; the promo code
-- is only created if it does not exist, so edits made to it from the
-- Growth tab (max uses, revoke) survive.
-- ============================================================

update public.payment_settings
   set referral_reward_signup = 30,
       referral_reward_paid   = 50,
       updated_at = now()
 where id = 1;

insert into public.promo_codes (code, label, reward_questions, max_uses)
values ('NOOR130', 'عرض الانطلاق', 45, 130)
on conflict (code) do nothing;
