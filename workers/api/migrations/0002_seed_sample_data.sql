-- Migration 0002 — dev/demo seed data.
--
-- Two campaigns × three missions each, designed for "maximum coverage" of the
-- rule engine landing in TASK-009:
--   * windows  : daily, weekly, lifetime  (each used twice)
--   * filters  : none, eq, in, gte (on numeric and on field-value)
--   * rewards  : currency (coin, gem, point) + badge
--
-- All timestamps are Unix epoch milliseconds (UTC):
--   start_at = 2026-04-01T00:00:00.000Z = 1775001600000
--   end_at   = 2026-06-30T23:59:59.999Z = 1782863999999
--
-- Re-runnability: `wrangler d1 migrations apply` will run this file exactly
-- once per environment because the d1_migrations table tracks the filename.
-- We still use `INSERT OR REPLACE` so a manual re-run via
-- `wrangler d1 execute --file=` (the seed:local / seed:remote scripts) is
-- idempotent and updates rows in place if the spec evolves.

-------------------------------------------------------------------------------
-- Campaigns
-------------------------------------------------------------------------------
INSERT OR REPLACE INTO campaigns (id, title, description, start_at, end_at, theme_json, banner_url) VALUES
  (
    'camp_ecom_2026q2',
    'E-commerce Spring 2026',
    'Spring shopping campaign — daily, category, and big-ticket missions.',
    1775001600000,
    1782863999999,
    '{"primaryColor":"#7c3aed"}',
    NULL
  ),
  (
    'camp_stream_2026q2',
    'Streaming Spring 2026',
    'Watch more, earn more — daily streaks, genre dives, and longform binges.',
    1775001600000,
    1782863999999,
    '{"primaryColor":"#06b6d4"}',
    NULL
  );

-------------------------------------------------------------------------------
-- Campaign 1: E-commerce missions
-------------------------------------------------------------------------------

-- M1: Triple Treat — 3 purchases today (daily window, no filter)
INSERT OR REPLACE INTO missions (id, title, description, criteria_json, reward_json, campaign_id, expires_at, icon_url) VALUES
  (
    'mis_ecom_daily_purchase_3',
    'Triple Treat',
    'Make 3 purchases today',
    '{"eventName":"purchase.completed","count":3,"window":"daily"}',
    '{"kind":"currency","currency":"coin","amount":100}',
    'camp_ecom_2026q2',
    NULL,
    NULL
  );

-- M2: Power User — single $50+ electronics purchase (lifetime, two filter clauses)
INSERT OR REPLACE INTO missions (id, title, description, criteria_json, reward_json, campaign_id, expires_at, icon_url) VALUES
  (
    'mis_ecom_electronics_50',
    'Power User',
    'Spend $50+ on a single electronics purchase',
    '{"eventName":"purchase.completed","count":1,"window":"lifetime","filter":{"amount":{"gte":50},"category":{"eq":"electronics"}}}',
    '{"kind":"badge","badgeId":"power_user"}',
    'camp_ecom_2026q2',
    NULL,
    NULL
  );

-- M3: Variety Pack — 5 weekly purchases across books/games/toys (weekly, `in` filter)
INSERT OR REPLACE INTO missions (id, title, description, criteria_json, reward_json, campaign_id, expires_at, icon_url) VALUES
  (
    'mis_ecom_variety_week',
    'Variety Pack',
    'Make 5 purchases this week across books, games, or toys',
    '{"eventName":"purchase.completed","count":5,"window":"weekly","filter":{"category":{"in":["books","games","toys"]}}}',
    '{"kind":"currency","currency":"gem","amount":5}',
    'camp_ecom_2026q2',
    NULL,
    NULL
  );

-------------------------------------------------------------------------------
-- Campaign 2: Streaming missions
-------------------------------------------------------------------------------

-- M4: Daily Watcher — watch any video today (daily, no filter)
INSERT OR REPLACE INTO missions (id, title, description, criteria_json, reward_json, campaign_id, expires_at, icon_url) VALUES
  (
    'mis_stream_daily_watch_1',
    'Daily Watcher',
    'Watch any video today',
    '{"eventName":"video.watched","count":1,"window":"daily"}',
    '{"kind":"currency","currency":"coin","amount":20}',
    'camp_stream_2026q2',
    NULL,
    NULL
  );

-- M5: Curious Mind — 3 documentaries (lifetime, eq filter on string field)
INSERT OR REPLACE INTO missions (id, title, description, criteria_json, reward_json, campaign_id, expires_at, icon_url) VALUES
  (
    'mis_stream_documentary_3',
    'Curious Mind',
    'Watch 3 documentaries',
    '{"eventName":"video.watched","count":3,"window":"lifetime","filter":{"genre":{"eq":"documentary"}}}',
    '{"kind":"badge","badgeId":"curious_mind"}',
    'camp_stream_2026q2',
    NULL,
    NULL
  );

-- M6: Deep Diver — 10 weekly long-form videos (weekly, gte filter on numeric)
INSERT OR REPLACE INTO missions (id, title, description, criteria_json, reward_json, campaign_id, expires_at, icon_url) VALUES
  (
    'mis_stream_longform_week',
    'Deep Diver',
    'Watch 10 videos over 20 minutes long this week',
    '{"eventName":"video.watched","count":10,"window":"weekly","filter":{"durationMin":{"gte":20}}}',
    '{"kind":"currency","currency":"point","amount":500}',
    'camp_stream_2026q2',
    NULL,
    NULL
  );

-------------------------------------------------------------------------------
-- M:N junction — campaign_missions
-------------------------------------------------------------------------------
INSERT OR REPLACE INTO campaign_missions (campaign_id, mission_id) VALUES
  ('camp_ecom_2026q2',   'mis_ecom_daily_purchase_3'),
  ('camp_ecom_2026q2',   'mis_ecom_electronics_50'),
  ('camp_ecom_2026q2',   'mis_ecom_variety_week'),
  ('camp_stream_2026q2', 'mis_stream_daily_watch_1'),
  ('camp_stream_2026q2', 'mis_stream_documentary_3'),
  ('camp_stream_2026q2', 'mis_stream_longform_week');
