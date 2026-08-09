ALTER TABLE domains
  ADD COLUMN page_title text,
  ADD COLUMN page_text text,
  ADD COLUMN page_url text,
  ADD COLUMN fetched_at timestamptz;

UPDATE domains SET status = 'pending' WHERE status = 'processing';
