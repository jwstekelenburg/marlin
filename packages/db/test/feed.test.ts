import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { sql } from "drizzle-orm";
import type { FeedStrategy } from "@marlin/shared";
import { emptyFeedStrategy } from "@marlin/shared";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(repoRoot, ".env") });

const hasDb = Boolean(process.env.DATABASE_URL?.trim());
const suffix = `feedtest-${randomBytes(4).toString("hex")}`;
const apex = `${suffix}.com`;
const catFree = `port-${suffix}`;
const catBlog = `blog-${suffix}`;
const catCorp = `corp-${suffix}`;
const tagZine = `zine-${suffix}`;
const tagAdult = `adult-${suffix}`;

function strategy(patch: Partial<FeedStrategy> = {}): FeedStrategy {
  return {
    ...emptyFeedStrategy(),
    includeCategories: [catFree],
    includeTagsAny: [tagZine],
    excludeCategories: [catCorp],
    excludeTags: [tagAdult],
    requireTagIfCategory: [catBlog],
    ...patch,
  };
}

describe("nextFeedPage / recordFeedEvents", { skip: !hasDb, concurrency: 1 }, () => {
  let nextFeedPage: typeof import("../src/feed.js").nextFeedPage;
  let recordFeedEvents: typeof import("../src/feed.js").recordFeedEvents;
  let pool: typeof import("../src/client.js").pool;
  let db: typeof import("../src/client.js").db;
  const ids: Record<string, number> = {};

  before(async () => {
    ({ nextFeedPage, recordFeedEvents } = await import("../src/feed.js"));
    ({ pool, db } = await import("../src/client.js"));

    const cats = await db.execute(sql`
      INSERT INTO categories (name)
      VALUES (${catFree}), (${catBlog}), (${catCorp})
      RETURNING id, name
    `);
    for (const row of cats.rows as { id: number; name: string }[]) {
      ids[row.name] = Number(row.id);
    }
    const tagRows = await db.execute(sql`
      INSERT INTO tags (name)
      VALUES (${tagZine}), (${tagAdult})
      RETURNING id, name
    `);
    for (const row of tagRows.rows as { id: number; name: string }[]) {
      ids[row.name] = Number(row.id);
    }

    const hosts = {
      free: `free.${apex}`,
      gbKeep: `gb-keep.${apex}`,
      usFree: `us-free.${apex}`,
      blogHit: `blog-hit.${apex}`,
      blogMiss: `blog-miss.${apex}`,
      corp: `corp.${apex}`,
      adult: `adult.${apex}`,
    };
    const inserted = await db.execute(sql`
      INSERT INTO domains (host, apex, status, source, category_id, name, summary, country)
      VALUES
        (${hosts.free}, ${apex}, 'done', 'list', ${ids[catFree]}, 'Free Port', 'A maker portfolio.', 'GB'),
        (${hosts.gbKeep}, ${apex}, 'done', 'list', ${ids[catFree]}, 'GB Keep', 'A GB maker portfolio.', 'GB'),
        (${hosts.usFree}, ${apex}, 'done', 'list', ${ids[catFree]}, 'US Port', 'A US maker portfolio.', 'US'),
        (${hosts.blogHit}, ${apex}, 'done', 'list', ${ids[catBlog]}, 'Zine Blog', 'A personal zine.', 'US'),
        (${hosts.blogMiss}, ${apex}, 'done', 'list', ${ids[catBlog]}, 'Travel Blog', 'A travel diary.', NULL),
        (${hosts.corp}, ${apex}, 'done', 'list', ${ids[catCorp]}, 'Acme', 'A corporation.', 'GB'),
        (${hosts.adult}, ${apex}, 'done', 'list', ${ids[catFree]}, 'Nsfw', 'An adult gallery.', 'GB')
      RETURNING id, host
    `);
    for (const row of inserted.rows as { id: string | number; host: string }[]) {
      ids[row.host] = Number(row.id);
    }
    await db.execute(sql`
      INSERT INTO domain_tags (domain_id, tag_id)
      VALUES
        (${ids[hosts.blogHit]}, ${ids[tagZine]}),
        (${ids[hosts.corp]}, ${ids[tagZine]}),
        (${ids[hosts.adult]}, ${ids[tagAdult]})
    `);
    Object.assign(ids, {
      free: ids[hosts.free],
      gbKeep: ids[hosts.gbKeep],
      usFree: ids[hosts.usFree],
      blogHit: ids[hosts.blogHit],
      blogMiss: ids[hosts.blogMiss],
      corp: ids[hosts.corp],
      adult: ids[hosts.adult],
    });
  });

  after(async () => {
    await db.execute(sql`DELETE FROM domains WHERE apex = ${apex}`);
    await db.execute(sql`DELETE FROM categories WHERE name IN (${catFree}, ${catBlog}, ${catCorp})`);
    await db.execute(sql`DELETE FROM tags WHERE name IN (${tagZine}, ${tagAdult})`);
    await pool.end();
  });

  it("includes free-pass cats and gated cats with tags; drops the rest", async () => {
    const page = await nextFeedPage({
      limit: 20,
      strategy: strategy(),
      prompt: "makers",
      salt: "test",
    });
    const hosts = page.hits.map((h) => h.host);
    assert.ok(hosts.includes(`free.${apex}`));
    assert.ok(hosts.includes(`blog-hit.${apex}`));
    assert.equal(hosts.includes(`blog-miss.${apex}`), false);
    assert.equal(hosts.includes(`corp.${apex}`), false);
    assert.equal(hosts.includes(`adult.${apex}`), false);
    assert.equal(page.prompt, "makers");
  });

  it("interleaves categories instead of dumping one bucket first", async () => {
    const page = await nextFeedPage({
      limit: 2,
      strategy: strategy(),
      salt: "interleave",
    });
    assert.equal(page.hits.length, 2);
    const cats = page.hits.map((h) => h.category?.name);
    assert.ok(cats[0]);
    assert.ok(cats[1]);
    assert.notEqual(cats[0], cats[1]);
  });

  it("hides a domain after click and after a fresh impression", async () => {
    await recordFeedEvents([{ domainId: ids.free, kind: "click" }]);
    let page = await nextFeedPage({
      limit: 20,
      strategy: strategy(),
      salt: "test",
    });
    assert.equal(
      page.hits.some((h) => h.host === `free.${apex}`),
      false,
    );

    await recordFeedEvents([{ domainId: ids.blogHit, kind: "impression" }]);
    page = await nextFeedPage({
      limit: 20,
      strategy: strategy(),
      salt: "test",
    });
    assert.equal(
      page.hits.some((h) => h.host === `blog-hit.${apex}`),
      false,
    );
  });

  it("honors session exclude ids", async () => {
    const page = await nextFeedPage({
      limit: 20,
      excludeIds: [ids.blogHit],
      strategy: strategy(),
      salt: "test",
    });
    assert.equal(
      page.hits.some((h) => h.host === `blog-hit.${apex}`),
      false,
    );
  });

  it("filters by exact country and skips null countries", async () => {
    const gb = await nextFeedPage({
      limit: 20,
      country: "GB",
      strategy: strategy(),
      salt: "test-country",
    });
    const gbHosts = gb.hits.map((h) => h.host);
    assert.ok(gbHosts.includes(`gb-keep.${apex}`));
    assert.equal(gbHosts.includes(`us-free.${apex}`), false);

    const us = await nextFeedPage({
      limit: 20,
      country: "US",
      strategy: strategy(),
      salt: "test-country",
    });
    const usHosts = us.hits.map((h) => h.host);
    assert.ok(usHosts.includes(`us-free.${apex}`));
    assert.equal(usHosts.includes(`free.${apex}`), false);
  });
});
