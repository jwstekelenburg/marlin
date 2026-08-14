import { and, eq, inArray, sql } from "drizzle-orm";
import {
  envInt,
  loadFeedPrompt,
  loadFeedStrategy,
  normalizeCountry,
  type FeedStrategy,
} from "@marlin/shared";
import { db } from "./client.js";
import { categories, domainTags, domains, feedEvents, tags } from "./schema.js";

export const FEED_EVENT_KINDS = ["impression", "click", "up", "down"] as const;
export type FeedEventKind = (typeof FEED_EVENT_KINDS)[number];

export type FeedHit = {
  id: string;
  host: string;
  name: string | null;
  summary: string | null;
  language: string | null;
  place: string | null;
  country: string | null;
  category: { id: number; name: string } | null;
  tags: { id: number; name: string }[];
  score: number | null;
};

export type FeedPage = {
  prompt: string;
  hits: FeedHit[];
  hasMore: boolean;
  missing: { categories: string[]; tags: string[] };
};

export type FeedEventInput = {
  domainId: number;
  kind: FeedEventKind;
};

function sqlIntArray(ids: number[]) {
  if (ids.length === 0) return sql`ARRAY[]::int[]`;
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::int[]`;
}

function sqlBigintArray(ids: number[]) {
  if (ids.length === 0) return sql`ARRAY[]::bigint[]`;
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::bigint[]`;
}

function isFeedEventKind(value: string): value is FeedEventKind {
  return (FEED_EVENT_KINDS as readonly string[]).includes(value);
}

async function idsForNames(
  kind: "category" | "tag",
  names: string[],
): Promise<{ ids: number[]; missing: string[] }> {
  if (names.length === 0) return { ids: [], missing: [] };
  const table = kind === "category" ? categories : tags;
  const rows = await db
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(inArray(table.name, names));
  const found = new Set(rows.map((r) => r.name));
  return {
    ids: rows.map((r) => r.id),
    missing: names.filter((n) => !found.has(n)),
  };
}

async function attachTags(ids: number[]): Promise<Map<string, { id: number; name: string }[]>> {
  const tagMap = new Map<string, { id: number; name: string }[]>();
  if (ids.length === 0) return tagMap;
  const tagRows = await db
    .select({
      domainId: domainTags.domainId,
      id: tags.id,
      name: tags.name,
    })
    .from(domainTags)
    .innerJoin(tags, eq(domainTags.tagId, tags.id))
    .where(inArray(domainTags.domainId, ids));
  for (const row of tagRows) {
    const key = String(row.domainId);
    const list = tagMap.get(key) ?? [];
    list.push({ id: row.id, name: row.name });
    tagMap.set(key, list);
  }
  return tagMap;
}

function impressionDays(): number {
  return Math.min(Math.max(envInt("FEED_IMPRESSION_DAYS", 7), 1), 90);
}

function utcDaySalt(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function nextFeedPage(input: {
  limit?: number;
  excludeIds?: number[];
  country?: string;
  strategy?: FeedStrategy;
  prompt?: string;
  salt?: string;
} = {}): Promise<FeedPage> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const excludeIds = (input.excludeIds ?? [])
    .filter((id) => Number.isFinite(id) && id > 0)
    .slice(0, 2_000);
  const country = normalizeCountry(input.country);
  const strategy = input.strategy ?? loadFeedStrategy();
  const prompt = input.prompt ?? loadFeedPrompt();

  const [incCat, reqCat, excCat, incTag, excTag, liftCat, liftTag] = await Promise.all([
    idsForNames("category", strategy.includeCategories),
    idsForNames("category", strategy.requireTagIfCategory),
    idsForNames("category", strategy.excludeCategories),
    idsForNames("tag", strategy.includeTagsAny),
    idsForNames("tag", strategy.excludeTags),
    idsForNames("category", strategy.liftIgnored),
    idsForNames("tag", strategy.liftIgnored),
  ]);

  const missing = {
    categories: [...new Set([...incCat.missing, ...reqCat.missing, ...excCat.missing, ...liftCat.missing])],
    tags: [...new Set([...incTag.missing, ...excTag.missing, ...liftTag.missing])],
  };

  if (incCat.ids.length === 0 && incTag.ids.length === 0) {
    return { prompt, hits: [], hasMore: false, missing };
  }

  const salt = input.salt ?? utcDaySalt();
  const days = impressionDays();
  const incCatArr = sqlIntArray(incCat.ids);
  const reqCatArr = sqlIntArray(reqCat.ids);
  const excCatArr = sqlIntArray(excCat.ids);
  const incTagArr = sqlIntArray(incTag.ids);
  const excTagArr = sqlIntArray(excTag.ids);
  const liftCatArr = sqlIntArray(liftCat.ids);
  const liftTagArr = sqlIntArray(liftTag.ids);
  const excludeArr = sqlBigintArray(excludeIds);
  const countryClause = country ? sql`d.country = ${country}` : sql`TRUE`;

  const rows = await db.execute(sql`
    WITH hidden AS (
      SELECT domain_id
      FROM feed_events
      WHERE kind IN ('click', 'up', 'down')
      UNION
      SELECT domain_id
      FROM feed_events
      WHERE kind = 'impression'
        AND created_at > now() - (${days}::int * interval '1 day')
    ),
    taste_cat AS (
      SELECT d.category_id AS id,
        sum(
          CASE e.kind
            WHEN 'up' THEN 3
            WHEN 'click' THEN 1
            WHEN 'down' THEN -3
            ELSE 0
          END
        )::int AS w
      FROM feed_events e
      JOIN domains d ON d.id = e.domain_id
      WHERE e.kind IN ('up', 'click', 'down')
        AND d.category_id IS NOT NULL
      GROUP BY d.category_id
    ),
    candidates AS (
      SELECT d.id
      FROM domains d
      WHERE d.status = 'done'
        AND d.category_id = ANY (${incCatArr})
        AND d.category_id <> ALL (${reqCatArr})
        AND ${countryClause}
      UNION
      SELECT dt.domain_id
      FROM domain_tags dt
      JOIN domains d ON d.id = dt.domain_id
      WHERE d.status = 'done'
        AND dt.tag_id = ANY (${incTagArr})
        AND ${countryClause}
    ),
    scored AS (
      SELECT
        d.id,
        d.host,
        d.name,
        d.summary,
        d.language,
        d.place,
        d.country,
        c.id AS category_id,
        c.name AS category_name,
        (
          CASE
            WHEN d.category_id = ANY (${incCatArr})
              AND d.category_id <> ALL (${reqCatArr})
            THEN 3
            ELSE 0
          END
          + CASE
            WHEN EXISTS (
              SELECT 1 FROM domain_tags dt
              WHERE dt.domain_id = d.id AND dt.tag_id = ANY (${incTagArr})
            ) THEN 2
            ELSE 0
          END
          + coalesce(tc.w, 0)
        )::int AS score
      FROM candidates cand
      JOIN domains d ON d.id = cand.id
      LEFT JOIN categories c ON c.id = d.category_id
      LEFT JOIN taste_cat tc ON tc.id = d.category_id
      WHERE d.id <> ALL (${excludeArr})
        AND d.id NOT IN (SELECT domain_id FROM hidden)
        AND (d.category_id IS NULL OR d.category_id <> ALL (${excCatArr}))
        AND (c.id IS NULL OR c.ignored = false OR c.id = ANY (${liftCatArr}))
        AND NOT EXISTS (
          SELECT 1
          FROM domain_tags dt
          JOIN tags t ON t.id = dt.tag_id
          WHERE dt.domain_id = d.id
            AND t.ignored = true
            AND t.id <> ALL (${liftTagArr})
        )
        AND NOT EXISTS (
          SELECT 1 FROM domain_tags dt
          WHERE dt.domain_id = d.id AND dt.tag_id = ANY (${excTagArr})
        )
    ),
    ranked AS (
      SELECT
        s.*,
        row_number() OVER (
          PARTITION BY coalesce(s.category_id, 0)
          ORDER BY s.score DESC, md5(s.id::text || ${salt})
        ) AS cat_rn
      FROM scored s
    )
    SELECT
      id,
      host,
      name,
      summary,
      language,
      place,
      country,
      category_id,
      category_name,
      score
    FROM ranked
    ORDER BY cat_rn ASC,
      md5(coalesce(category_id, 0)::text || ${salt}),
      md5(id::text || ${salt})
    LIMIT ${limit + 1}
  `);

  const raw = rows.rows as {
    id: string | number;
    host: string;
    name: string | null;
    summary: string | null;
    language: string | null;
    place: string | null;
    country: string | null;
    category_id: number | null;
    category_name: string | null;
    score: number | string | null;
  }[];

  const hasMore = raw.length > limit;
  const page = hasMore ? raw.slice(0, limit) : raw;
  const ids = page.map((r) => Number(r.id));
  const tagMap = await attachTags(ids);

  return {
    prompt,
    hasMore,
    missing,
    hits: page.map((row) => ({
      id: String(row.id),
      host: row.host,
      name: row.name,
      summary: row.summary,
      language: row.language,
      place: row.place,
      country: row.country,
      category:
        row.category_id && row.category_name
          ? { id: row.category_id, name: row.category_name }
          : null,
      tags: tagMap.get(String(row.id)) ?? [],
      score: row.score == null ? null : Number(row.score),
    })),
  };
}

export async function recordFeedEvents(
  events: FeedEventInput[],
): Promise<{ recorded: number }> {
  const rows = events
    .filter((e) => Number.isFinite(e.domainId) && e.domainId > 0 && isFeedEventKind(e.kind))
    .slice(0, 100)
    .map((e) => ({ domainId: e.domainId, kind: e.kind }));
  if (rows.length === 0) return { recorded: 0 };

  const ids = [...new Set(rows.map((r) => r.domainId))];
  const existing = await db
    .select({ id: domains.id })
    .from(domains)
    .where(and(eq(domains.status, "done"), inArray(domains.id, ids)));
  const ok = new Set(existing.map((r) => r.id));
  const valid = rows.filter((r) => ok.has(r.domainId));
  if (valid.length === 0) return { recorded: 0 };

  await db.insert(feedEvents).values(valid);
  return { recorded: valid.length };
}
