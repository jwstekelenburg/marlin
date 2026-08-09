CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  ignored boolean NOT NULL DEFAULT false,
  domain_count integer NOT NULL DEFAULT 0
);

CREATE TABLE tags (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  ignored boolean NOT NULL DEFAULT false,
  domain_count integer NOT NULL DEFAULT 0
);

CREATE TABLE domains (
  id bigserial PRIMARY KEY,
  host text NOT NULL UNIQUE,
  name text,
  summary text,
  category_id integer REFERENCES categories (id),
  status text NOT NULL DEFAULT 'pending',
  error text,
  http_status integer,
  source text NOT NULL DEFAULT 'list',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE domain_tags (
  domain_id bigint NOT NULL REFERENCES domains (id) ON DELETE CASCADE,
  tag_id integer NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (domain_id, tag_id)
);

CREATE INDEX domains_status_idx ON domains (status);
CREATE INDEX domains_category_id_idx ON domains (category_id);
CREATE INDEX domains_summary_trgm_idx ON domains USING gin (summary gin_trgm_ops);
CREATE INDEX categories_name_trgm_idx ON categories USING gin (name gin_trgm_ops);
CREATE INDEX tags_name_trgm_idx ON tags USING gin (name gin_trgm_ops);
