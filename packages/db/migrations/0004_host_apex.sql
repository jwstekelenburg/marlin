-- Registrable ICANN apex for subdomain caps. Backfill + NOT NULL run in migrate.ts
-- after this file (tldts cannot run inside SQL).
ALTER TABLE domains ADD COLUMN IF NOT EXISTS apex text;

CREATE INDEX IF NOT EXISTS domains_apex_idx ON domains (apex);
