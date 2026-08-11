# Database migrations

Source of truth for what runs against Postgres:

1. Typed schema: [`packages/db/src/schema.ts`](../packages/db/src/schema.ts)
2. SQL files: [`packages/db/migrations/*.sql`](../packages/db/migrations/) (sorted by filename)
3. Runner: [`packages/db/src/migrate.ts`](../packages/db/src/migrate.ts)

The runner creates `schema_migrations(id, applied_at)` if needed, applies each `*.sql` file whose name is not already in that table, inside a transaction, then records the filename.

`0001_init.sql` is hand-written (includes `pg_trgm` and GIN indexes Drizzle does not emit cleanly). Do not edit it after it has been applied anywhere you care about.

## Commands

```bash
npm run db:migrate     # apply pending files (also the Compose `migrate` service)
npm run db:generate    # drizzle-kit: draft SQL from schema.ts into packages/db/migrations/
npm run db:studio      # browse data
```

Compose `api` / `fetcher` / `worker` / `spider` all `depends_on: migrate` completed successfully. Fresh volume → migrate runs automatically. Existing data → run migrate before new app versions.

`0002_page_pipeline.sql` adds `page_title` / `page_text` / `page_url` / `fetched_at` and remaps legacy `processing` → `pending`.

`0003_crawl_priority.sql` adds `priority` (queue weight) and `outbound_hosts` (staging until LM complete), plus partial indexes for `pending`/`ready` claim order.

`0004_host_apex.sql` adds `domains.apex` (ICANN eTLD+1) for the subdomain cap. The migrate runner backfills with `tldts`, sets `NOT NULL`, then deletes overflow `pending` subdomains on apexes already over `MAX_SUBDOMAINS_PER_APEX` (default 100). Do not edit the SQL file to “include” that backfill — it cannot run inside Postgres.

`0005_language_place_country.sql` adds nullable `language` / `place` / `country` on `domains` plus a partial btree on `country`. Existing rows stay null; no backfill.

`0006_blocked_apexes.sql` adds `blocked_apexes` + `apex_reviews`. Migrate/steward bootstrap seeds from `data/blocked-apex.txt`. Steward auto-blocks write here; `done` rows are kept, unfinished queue under a blocked apex is deleted.

## How to change schema

1. Edit `packages/db/src/schema.ts` and any queries in `packages/db/src/queries.ts`.
2. `npm run db:generate` and **review** the new SQL. drizzle-kit may also write `migrations/meta/` — keep SQL filenames incrementing after `0001_`.
3. If generate output is noisy, write the next file by hand (`0002_whatever.sql`) instead.
4. Never edit an already-applied migration. Add a new file.
5. `npm run db:migrate`.

Trigram indexes live in SQL, not in the Drizzle table builders. If you add a new text column that needs fuzzy search, add `CREATE INDEX ... USING gin (... gin_trgm_ops)` in a new migration. Do not spray extra trgm indexes on `domains` — at tens of millions of rows they are huge.

## Reset local DB

```bash
docker compose down -v
docker compose -f docker-compose.yml -f docker-compose.dev.yml up postgres migrate
```

That wipes the `pgdata` volume.
