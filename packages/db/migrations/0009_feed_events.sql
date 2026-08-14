-- Seen / feedback memory for the homepage feed. Single-user; no user_id.
-- impression: 7-day cooldown (query-time). click/up/down: never resurface that domain.
CREATE TABLE feed_events (
  id bigserial PRIMARY KEY,
  domain_id bigint NOT NULL REFERENCES domains (id) ON DELETE CASCADE,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX feed_events_domain_id_idx ON feed_events (domain_id);
CREATE INDEX feed_events_kind_created_idx ON feed_events (kind, created_at DESC);
