-- Migration 0003 — add a Daily Visitor mission so the demo's /daily route
-- has something to progress against when a user clicks "Check in".
--
-- Before this migration, the daily.login event fired by the daily-streak
-- route had no matching mission in the seed data — the EventLog drawer
-- stayed empty even though the event ingested fine server-side. Adding
-- this mission gives the route a visible progression + claim path, same
-- shape as the ecommerce/streaming missions.
--
-- Mission: "Daily Visitor"
--   eventName: daily.login
--   count: 1   (one check-in resets the chain — the mission resets daily)
--   window: daily  (rule-engine treats this as "between UTC midnights")
--   reward: badge "daily_visitor"  (keeps coin-balance separate from spins
--                                   and ecommerce claims so the demo can
--                                   showcase non-currency rewards too)
--
-- Re-runnability: INSERT OR REPLACE so manual seed re-runs are idempotent.

INSERT OR REPLACE INTO missions (id, title, description, criteria_json, reward_json, campaign_id, expires_at, icon_url) VALUES
  (
    'mis_daily_visitor',
    'Daily Visitor',
    'Check in once per day to keep the streak alive.',
    '{"eventName":"daily.login","count":1,"window":"daily"}',
    '{"kind":"badge","badgeId":"daily_visitor"}',
    'camp_ecom_2026q2',
    NULL,
    NULL
  );

INSERT OR IGNORE INTO campaign_missions (campaign_id, mission_id) VALUES
  ('camp_ecom_2026q2', 'mis_daily_visitor');
