-- Steward auto-block: crawler-trap apexes in Postgres + review bookkeeping.
-- data/blocked-apex.txt remains the seed; migrate/steward bootstrap into blocked_apexes.

CREATE TABLE IF NOT EXISTS blocked_apexes (
  apex text PRIMARY KEY,
  reason text NOT NULL,
  source text NOT NULL DEFAULT 'steward',
  evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS apex_reviews (
  apex text PRIMARY KEY,
  verdict text NOT NULL,
  reason text NOT NULL DEFAULT '',
  sample_size integer NOT NULL DEFAULT 0,
  evidence jsonb,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apex_reviews_reviewed_at_idx ON apex_reviews (reviewed_at);
