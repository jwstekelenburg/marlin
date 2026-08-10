ALTER TABLE domains
  ADD COLUMN language text,
  ADD COLUMN place text,
  ADD COLUMN country text;

CREATE INDEX domains_country_idx ON domains (country) WHERE country IS NOT NULL;
