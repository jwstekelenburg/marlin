import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { sql } from "drizzle-orm";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(repoRoot, ".env") });

const hasDb = Boolean(process.env.DATABASE_URL?.trim());
const suffix = `claimtest-${randomBytes(4).toString("hex")}`;
const apex = `${suffix}.com`;
const hosts = {
  hi: `hi.${apex}`,
  mid: `mid.${apex}`,
  lo: `lo.${apex}`,
  readyA: `ready-a.${apex}`,
  readyB: `ready-b.${apex}`,
};

/** Jump above any live seed/link priority so we own the front of the queue. */
const HI = 2_000_000_000;
const MID = 1_999_999_999;
const LO = 1_999_999_998;

describe("claimNextFetch / claimNextLm", { skip: !hasDb }, () => {
  let claimNextFetch: typeof import("../src/queries.js").claimNextFetch;
  let claimNextLm: typeof import("../src/queries.js").claimNextLm;
  let pool: typeof import("../src/client.js").pool;
  let db: typeof import("../src/client.js").db;

  before(async () => {
    ({ claimNextFetch, claimNextLm } = await import("../src/queries.js"));
    ({ pool, db } = await import("../src/client.js"));

    await db.execute(sql`
      INSERT INTO domains (host, apex, status, source, priority)
      VALUES
        (${hosts.lo}, ${apex}, 'pending', 'list', ${LO}),
        (${hosts.mid}, ${apex}, 'pending', 'list', ${MID}),
        (${hosts.hi}, ${apex}, 'pending', 'list', ${HI}),
        (${hosts.readyA}, ${apex}, 'ready', 'list', ${HI}),
        (${hosts.readyB}, ${apex}, 'ready', 'list', ${HI})
    `);
  });

  after(async () => {
    await db.execute(sql`DELETE FROM domains WHERE apex = ${apex}`);
    await pool.end();
  });

  it("claims pending rows highest priority first", async () => {
    const first = await claimNextFetch();
    assert.ok(first, "expected a pending claim");
    assert.equal(first.host, hosts.hi);
    assert.equal(first.status, "fetching");
    assert.equal(first.priority, HI);

    const second = await claimNextFetch();
    assert.ok(second);
    assert.equal(second.host, hosts.mid);
  });

  it("never returns the same row to concurrent fetch claims", async () => {
    // One pending test host left (lo). Insert extras so two claims can both succeed.
    const extraA = `c1.${apex}`;
    const extraB = `c2.${apex}`;
    await db.execute(sql`
      INSERT INTO domains (host, apex, status, source, priority)
      VALUES
        (${extraA}, ${apex}, 'pending', 'list', ${HI}),
        (${extraB}, ${apex}, 'pending', 'list', ${HI})
    `);

    const [a, b] = await Promise.all([claimNextFetch(), claimNextFetch()]);
    assert.ok(a && b, "both concurrent claims should get a row");
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.host, b.host);

    const ours = new Set([hosts.lo, extraA, extraB]);
    // Live fetcher may steal a slot; at least one claim should be ours, and no duplicate ids.
    const claimedOurs = [a, b].filter((row) => ours.has(row.host));
    assert.ok(
      claimedOurs.length >= 1,
      `expected test hosts in concurrent claims, got ${a.host}, ${b.host}`,
    );
  });

  it("claims ready rows for LM without overlap", async () => {
    const [a, b] = await Promise.all([claimNextLm(), claimNextLm()]);
    assert.ok(a && b);
    assert.notEqual(a.id, b.id);
    assert.equal(a.status, "summarizing");
    assert.equal(b.status, "summarizing");

    const ours = new Set([hosts.readyA, hosts.readyB]);
    assert.ok(ours.has(a.host), `unexpected LM claim host ${a.host}`);
    assert.ok(ours.has(b.host), `unexpected LM claim host ${b.host}`);
  });
});
