-- Browse latest-done and language filter. Btree only — do not add host/name trigram GINs.

CREATE INDEX IF NOT EXISTS domains_done_processed_at_idx
  ON domains (processed_at DESC NULLS LAST)
  WHERE status = 'done';

CREATE INDEX IF NOT EXISTS domains_done_language_idx
  ON domains (language)
  WHERE status = 'done' AND language IS NOT NULL;
