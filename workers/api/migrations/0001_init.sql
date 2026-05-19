-- Migration 0001 — initial schema for questkit-d1-main.
--
-- Design notes:
--   * All `*_json` columns are TEXT — D1 cannot index inside JSON, so any query
--     that needs to filter must use one of the scalar columns (or json_extract
--     in read-time only).
--   * Timestamps are INTEGER (Unix epoch milliseconds) to align with the number
--     fields on `@questkit/types`: Event.timestamp, MissionProgress.updatedAt,
--     Mission.expiresAt, Campaign.startAt/endAt, Balance.updatedAt.
--   * `IF NOT EXISTS` everywhere so this migration is re-runnable in dev (the
--     `d1_migrations` table tracks applied migrations, but local resets and
--     accidental re-runs should be safe).
--   * Foreign keys are declared inline for documentation. D1 leaves FK
--     enforcement off by default; the constraints still help future readers
--     and any future `PRAGMA foreign_keys = ON` scenarios.
--   * Status CHECK constraints lock the column to the exact strings used in
--     the domain types (MissionProgress.status, webhook lifecycle states).

-------------------------------------------------------------------------------
-- users — opaque, host-provided IDs (we never store PII)
-------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id          TEXT    PRIMARY KEY,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_created_at
  ON users(created_at);

-------------------------------------------------------------------------------
-- campaigns — collections of missions with a theme + time window
-------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaigns (
  id           TEXT    PRIMARY KEY,
  title        TEXT    NOT NULL,
  description  TEXT    NOT NULL,
  start_at     INTEGER NOT NULL,
  end_at       INTEGER NOT NULL,
  theme_json   TEXT    NOT NULL DEFAULT '{}',
  banner_url   TEXT
);

CREATE INDEX IF NOT EXISTS idx_campaigns_window
  ON campaigns(start_at, end_at);

-------------------------------------------------------------------------------
-- missions — atomic gamification goals tied (optionally) to a campaign
-- criteria_json:  serialised MissionCriteria  (eventName, count, window?, filter?)
-- reward_json:    serialised Reward            (currency | badge | item discriminated union)
-------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS missions (
  id            TEXT    PRIMARY KEY,
  title         TEXT    NOT NULL,
  description   TEXT    NOT NULL,
  criteria_json TEXT    NOT NULL,
  reward_json   TEXT    NOT NULL,
  campaign_id   TEXT,
  expires_at    INTEGER,
  icon_url      TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_missions_campaign
  ON missions(campaign_id)
  WHERE campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_missions_expires
  ON missions(expires_at)
  WHERE expires_at IS NOT NULL;

-------------------------------------------------------------------------------
-- campaign_missions — explicit M:N junction. Missions can technically appear
-- in more than one campaign via this table; missions.campaign_id is the
-- "primary" campaign (the one that drove this mission's denormalised data).
-------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_missions (
  campaign_id TEXT NOT NULL,
  mission_id  TEXT NOT NULL,
  PRIMARY KEY (campaign_id, mission_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (mission_id)  REFERENCES missions(id)  ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_campaign_missions_mission
  ON campaign_missions(mission_id);

-------------------------------------------------------------------------------
-- mission_progress — per-user, per-mission progression state
-- status:          MissionProgress["status"]   (locked|active|completed|claimed)
-- progress:        REAL in [0,1]                (current_count / target_count clamped)
-- current_count:   INTEGER raw counter
-- target_count:    INTEGER mirrored from MissionCriteria.count at progress creation
-------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mission_progress (
  user_id        TEXT    NOT NULL,
  mission_id     TEXT    NOT NULL,
  status         TEXT    NOT NULL CHECK (status IN ('locked','active','completed','claimed')),
  progress       REAL    NOT NULL DEFAULT 0,
  current_count  INTEGER NOT NULL DEFAULT 0,
  target_count   INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (user_id, mission_id),
  FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_progress_user_status
  ON mission_progress(user_id, status);

CREATE INDEX IF NOT EXISTS idx_progress_mission
  ON mission_progress(mission_id);

-------------------------------------------------------------------------------
-- balances — virtual currency wallet per (user, currency)
-------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS balances (
  user_id     TEXT    NOT NULL,
  currency    TEXT    NOT NULL,
  amount      INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, currency),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Composite PK (user_id, currency) already provides this lookup path, but an
-- explicit named index makes intent obvious and lets EXPLAIN QUERY PLAN match it.
CREATE INDEX IF NOT EXISTS idx_balances_user_currency
  ON balances(user_id, currency);

-------------------------------------------------------------------------------
-- events — append-only journal of host-fired events
-- payload_json: serialised Event.payload (Record<string, unknown>)
-- idempotency_key: optional dedupe key (TASK-008 also caches the response in KV;
--   this column is a defence-in-depth uniqueness anchor scoped per-user).
-------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id              TEXT    PRIMARY KEY,
  user_id         TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  payload_json    TEXT    NOT NULL DEFAULT '{}',
  timestamp       INTEGER NOT NULL,
  idempotency_key TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- "Last N events for user" lookup powers the recommendations hook (Phase 3)
-- and the rule engine's lifetime/window aggregations (Phase 2 TASK-009).
CREATE INDEX IF NOT EXISTS idx_events_user_ts
  ON events(user_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_events_name_ts
  ON events(name, timestamp DESC);

-- Partial unique index — only enforces uniqueness when idempotency_key is set.
-- SQLite supports `WHERE` on indexes since 3.8.0; D1 inherits this. Scope is
-- per-user to allow two different users to legitimately submit the same key
-- from an SDK that picks UUIDv4 client-side.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_user_idem
  ON events(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-------------------------------------------------------------------------------
-- webhooks — inbound webhook audit log
-- status lifecycle: received -> accepted | rejected | dlq
-------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhooks (
  id            TEXT    PRIMARY KEY,
  source        TEXT    NOT NULL,
  payload_json  TEXT    NOT NULL,
  received_at   INTEGER NOT NULL,
  status        TEXT    NOT NULL CHECK (status IN ('received','accepted','rejected','dlq'))
);

CREATE INDEX IF NOT EXISTS idx_webhooks_status_received
  ON webhooks(status, received_at);

CREATE INDEX IF NOT EXISTS idx_webhooks_source_received
  ON webhooks(source, received_at);
