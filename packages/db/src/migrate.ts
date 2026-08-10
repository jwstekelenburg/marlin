import "./env.js";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { hostApex, maxSubdomainsPerApex } from "@marlin/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

async function backfillApex(client: pg.Client): Promise<number> {
  const missing = await client.query<{ id: string; host: string }>(
    `SELECT id::text AS id, host FROM domains WHERE apex IS NULL`,
  );
  if (missing.rows.length === 0) return 0;

  const BATCH = 500;
  let updated = 0;
  for (let i = 0; i < missing.rows.length; i += BATCH) {
    const chunk = missing.rows.slice(i, i + BATCH);
    await client.query(
      `UPDATE domains AS d
       SET apex = u.apex
       FROM unnest($1::bigint[], $2::text[]) AS u(id, apex)
       WHERE d.id = u.id`,
      [chunk.map((r) => r.id), chunk.map((r) => hostApex(r.host))],
    );
    updated += chunk.length;
  }
  return updated;
}

async function ensureApexNotNull(client: pg.Client): Promise<void> {
  const col = await client.query<{ is_nullable: string }>(
    `SELECT is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'domains' AND column_name = 'apex'`,
  );
  if (col.rows[0]?.is_nullable !== "YES") return;
  await client.query(`ALTER TABLE domains ALTER COLUMN apex SET NOT NULL`);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const applied = new Set(
      (await client.query<{ id: string }>("SELECT id FROM schema_migrations")).rows.map(
        (r) => r.id,
      ),
    );

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip  ${file}`);
        continue;
      }

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      console.log(`apply ${file}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    const filled = await backfillApex(client);
    if (filled > 0) console.log(`backfill apex ${filled} row(s)`);
    await ensureApexNotNull(client);

    console.log("migrations up to date");
  } finally {
    await client.end();
  }

  const { pool } = await import("./client.js");
  const { trimApexQueueOverflow } = await import("./queries.js");
  try {
    const trimmed = await trimApexQueueOverflow();
    if (trimmed > 0) {
      console.log(
        `trimmed ${trimmed} pending subdomain(s) over MAX_SUBDOMAINS_PER_APEX=${maxSubdomainsPerApex()}`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
