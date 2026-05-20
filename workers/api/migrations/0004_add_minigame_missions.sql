-- Migration 0004 — add Lucky Spinner + Scratch Master missions so the
-- mini-games route generates visible SDKUpdates (mission.progress /
-- mission.completed) in addition to the existing reward toast.
--
-- Before this migration, the demo's /minigames page fired
-- `qk.minigame.spin` (and `qk.minigame.scratch`) when the wheel landed
-- or the card was scratched, but no mission matched those event names
-- so the rule engine returned an empty update list and the EventLog
-- drawer stayed silent. The toast was the only visible feedback.
--
-- Two new missions:
--   1. Lucky Spinner — 5 wheel spins (lifetime), reward badge.
--   2. Scratch Master — 3 scratch cards (lifetime), reward badge.
--
-- Both are tied to the existing camp_ecom_2026q2 campaign so the
-- demo's mission list surfaces them on the e-commerce page too (the
-- demo doesn't have a dedicated minigame campaign, and creating one
-- just for this would be a richer change than this migration scope).
-- Reward kind is badge to keep coin minting in the ecommerce/daily
-- routes; spin rewards remain the wheel's local toast (which is the
-- entire point of the spin mini-game — see SpinWheel.onSpin).
--
-- Re-runnability: INSERT OR REPLACE so manual seed re-runs are
-- idempotent.

INSERT OR REPLACE INTO missions (id, title, description, criteria_json, reward_json, campaign_id, expires_at, icon_url) VALUES
  (
    'mis_lucky_spinner',
    'Lucky Spinner',
    'Spin the wheel 5 times.',
    '{"eventName":"qk.minigame.spin","count":5,"window":"lifetime"}',
    '{"kind":"badge","badgeId":"lucky_spinner"}',
    'camp_ecom_2026q2',
    NULL,
    NULL
  ),
  (
    'mis_scratch_master',
    'Scratch Master',
    'Reveal 3 scratch cards.',
    '{"eventName":"qk.minigame.scratch","count":3,"window":"lifetime"}',
    '{"kind":"badge","badgeId":"scratch_master"}',
    'camp_ecom_2026q2',
    NULL,
    NULL
  );

INSERT OR IGNORE INTO campaign_missions (campaign_id, mission_id) VALUES
  ('camp_ecom_2026q2', 'mis_lucky_spinner'),
  ('camp_ecom_2026q2', 'mis_scratch_master');
