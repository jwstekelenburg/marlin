ALTER TABLE domains
  ADD COLUMN priority integer NOT NULL DEFAULT 0,
  ADD COLUMN outbound_hosts text[];

CREATE INDEX domains_pending_priority_idx
  ON domains (priority DESC, id ASC)
  WHERE status = 'pending';

CREATE INDEX domains_ready_priority_idx
  ON domains (priority DESC, id ASC)
  WHERE status = 'ready';
