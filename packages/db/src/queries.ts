import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  allowedTlds,
  crawlPriorityForCategory,
  defaultCrawlPriority,
  isIndexableHost,
  loadCategoryPriorityConfig,
  type CategoryPriorityConfig,
  type DomainSource,
} from "@marlin/shared";
import { db } from "./client.js";
import { categories, domainTags, domains, tags } from "./schema.js";

const CLAIM_RETURNING = `
    id, host, name, summary, category_id, status, error, http_status, source,
    page_title, page_text, page_url, fetched_at, priority, outbound_hosts,
    created_at, updated_at, processed_at
`;

export type ClaimedDomain = {
  id: number;
  host: string;
  name: string | null;
  summary: string | null;
  category_id: number | null;
  status: string;
  error: string | null;
  http_status: number | null;
  source: string;
  page_title: string | null;
  page_text: string | null;
  page_url: string | null;
  fetched_at: Date | null;
  priority: number;
  outbound_hosts: string[] | null;
  created_at: Date;
  updated_at: Date;
  processed_at: Date | null;
};

function mapOutboundHosts(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((h): h is string => typeof h === "string");
}

function mapClaimed(row: Record<string, unknown>): ClaimedDomain {
  return {
    id: Number(row.id),
    host: String(row.host),
    name: (row.name as string | null) ?? null,
    summary: (row.summary as string | null) ?? null,
    category_id: row.category_id == null ? null : Number(row.category_id),
    status: String(row.status),
    error: (row.error as string | null) ?? null,
    http_status: row.http_status == null ? null : Number(row.http_status),
    source: String(row.source),
    page_title: (row.page_title as string | null) ?? null,
    page_text: (row.page_text as string | null) ?? null,
    page_url: (row.page_url as string | null) ?? null,
    fetched_at: row.fetched_at ? new Date(row.fetched_at as string) : null,
    priority: Number(row.priority ?? 0),
    outbound_hosts: mapOutboundHosts(row.outbound_hosts),
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
    processed_at: row.processed_at ? new Date(row.processed_at as string) : null,
  };
}

async function claimFromTo(from: string, to: string): Promise<ClaimedDomain | null> {
  const result = await db.transaction(async (tx) => {
    return tx.execute(sql.raw(`
      UPDATE domains
      SET status = '${to}', updated_at = now()
      WHERE id = (
        SELECT id FROM domains
        WHERE status = '${from}'
        ORDER BY priority DESC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING ${CLAIM_RETURNING}
    `));
  });
  const row = (result.rows as Record<string, unknown>[])[0];
  return row ? mapClaimed(row) : null;
}

type InsertExec = { insert: typeof db.insert };

async function insertQueuedHosts(
  exec: InsertExec,
  hosts: string[],
  source: DomainSource,
  priority: number,
): Promise<number> {
  if (hosts.length === 0) return 0;
  const unique = [...new Set(hosts)].filter(isIndexableHost);
  if (unique.length === 0) return 0;
  const rows = await exec
    .insert(domains)
    .values(unique.map((host) => ({ host, status: "pending" as const, source, priority })))
    .onConflictDoUpdate({
      target: domains.host,
      set: {
        priority: sql`GREATEST(${domains.priority}, ${sql.raw("excluded.priority")})`,
        updatedAt: new Date(),
      },
      setWhere: sql`${domains.status} IN ('pending', 'ready') AND ${domains.priority} < ${sql.raw("excluded.priority")}`,
    })
    .returning({ id: domains.id });
  return rows.length;
}

export async function enqueueHosts(
  hosts: string[],
  source: DomainSource,
  priority: number = defaultCrawlPriority(),
): Promise<number> {
  return insertQueuedHosts(db, hosts, source, priority);
}

export async function claimNextFetch(): Promise<ClaimedDomain | null> {
  return claimFromTo("pending", "fetching");
}

export async function claimNextLm(): Promise<ClaimedDomain | null> {
  return claimFromTo("ready", "summarizing");
}

export async function readyBacklog(): Promise<number> {
  const result = await db.execute(sql`
    SELECT count(*)::int AS n
    FROM domains
    WHERE status IN ('ready', 'summarizing')
  `);
  return Number((result.rows[0] as { n?: number } | undefined)?.n ?? 0);
}

export async function storeFetchedPage(input: {
  id: number;
  title: string;
  text: string;
  url: string;
  httpStatus: number;
  outboundHosts: string[];
}): Promise<void> {
  await db
    .update(domains)
    .set({
      pageTitle: input.title || null,
      pageText: input.text,
      pageUrl: input.url,
      httpStatus: input.httpStatus,
      fetchedAt: new Date(),
      outboundHosts: input.outboundHosts.length > 0 ? input.outboundHosts : null,
      status: "ready",
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(domains.id, input.id));
}

export async function reclaimStuckFetch(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE domains
    SET status = 'pending', updated_at = now()
    WHERE status IN ('fetching', 'processing')
    RETURNING id
  `);
  return result.rows.length;
}

export async function reclaimStuckLm(): Promise<number> {
  const result = await db
    .update(domains)
    .set({ status: "ready", updatedAt: new Date() })
    .where(eq(domains.status, "summarizing"))
    .returning({ id: domains.id });
  return result.length;
}

export async function markSkipped(id: number, error: string): Promise<void> {
  await db
    .update(domains)
    .set({
      status: "skipped",
      error: error.slice(0, 2000),
      updatedAt: new Date(),
      processedAt: new Date(),
    })
    .where(eq(domains.id, id));
}

export async function skipDisallowedTldQueue(): Promise<number> {
  const tlds = [...allowedTlds()];
  if (tlds.length === 0) return 0;
  const result = await db.execute(sql`
    UPDATE domains
    SET status = 'skipped',
        error = 'tld not in english whitelist',
        updated_at = now(),
        processed_at = now()
    WHERE status IN ('pending', 'fetching', 'ready', 'summarizing', 'processing')
      AND lower(split_part(host, '.', -1)) NOT IN (${sql.join(
        tlds.map((tld) => sql`${tld}`),
        sql`, `,
      )})
    RETURNING id
  `);
  return result.rows.length;
}

export async function markFailed(
  id: number,
  error: string,
  httpStatus?: number,
): Promise<void> {
  await db
    .update(domains)
    .set({
      status: "failed",
      error: error.slice(0, 2000),
      httpStatus: httpStatus ?? null,
      updatedAt: new Date(),
      processedAt: new Date(),
    })
    .where(eq(domains.id, id));
}

export async function completeDomain(input: {
  id: number;
  name: string;
  summary: string;
  category: string;
  tags: string[];
  httpStatus: number | null;
  outboundHosts?: string[];
}): Promise<{ enqueued: number; priority: number }> {
  const linkPriority = crawlPriorityForCategory(input.category);
  let enqueued = 0;

  await db.transaction(async (tx) => {
    const [category] = await tx
      .insert(categories)
      .values({ name: input.category })
      .onConflictDoUpdate({
        target: categories.name,
        set: { name: input.category },
      })
      .returning();
    if (!category) throw new Error("failed to upsert category");

    await tx
      .update(categories)
      .set({ domainCount: sql`${categories.domainCount} + 1` })
      .where(eq(categories.id, category.id));

    const tagRows: { id: number; name: string }[] = [];
    for (const tagName of input.tags) {
      const [tag] = await tx
        .insert(tags)
        .values({ name: tagName })
        .onConflictDoUpdate({ target: tags.name, set: { name: tagName } })
        .returning();
      if (!tag) continue;
      await tx
        .update(tags)
        .set({ domainCount: sql`${tags.domainCount} + 1` })
        .where(eq(tags.id, tag.id));
      tagRows.push(tag);
    }

    enqueued = await insertQueuedHosts(tx, input.outboundHosts ?? [], "link", linkPriority);

    await tx
      .update(domains)
      .set({
        name: input.name,
        summary: input.summary,
        categoryId: category.id,
        status: "done",
        error: null,
        httpStatus: input.httpStatus,
        pageTitle: null,
        pageText: null,
        pageUrl: null,
        outboundHosts: null,
        updatedAt: new Date(),
        processedAt: new Date(),
      })
      .where(eq(domains.id, input.id));

    if (tagRows.length > 0) {
      await tx
        .insert(domainTags)
        .values(tagRows.map((tag) => ({ domainId: input.id, tagId: tag.id })))
        .onConflictDoNothing();
    }
  });

  return { enqueued, priority: linkPriority };
}

export async function setLabelIgnored(
  kind: "category" | "tag",
  id: number,
  ignored: boolean,
): Promise<{ id: number; name: string; ignored: boolean; domainCount: number } | null> {
  const table = kind === "category" ? categories : tags;
  const [row] = await db
    .update(table)
    .set({ ignored })
    .where(eq(table.id, id))
    .returning();
  return row ?? null;
}

export async function listLabels(kind: "category" | "tag") {
  const table = kind === "category" ? categories : tags;
  return db.select().from(table).orderBy(asc(table.name));
}

export async function typeaheadLabels(kind: "category" | "tag", q: string, limit = 20) {
  const table = kind === "category" ? categories : tags;
  const query = q.trim();
  if (!query) {
    return db.select().from(table).orderBy(asc(table.name)).limit(limit);
  }

  return db
    .select({
      id: table.id,
      name: table.name,
      ignored: table.ignored,
      domainCount: table.domainCount,
      score: sql<number>`similarity(${table.name}, ${query})`,
    })
    .from(table)
    .where(sql`${table.name} ILIKE ${"%" + query + "%"} OR ${table.name} % ${query}`)
    .orderBy(sql`similarity(${table.name}, ${query}) DESC`, asc(table.name))
    .limit(limit);
}

export async function domainStats() {
  const rows = await db
    .select({
      status: domains.status,
      count: sql<number>`count(*)::int`,
    })
    .from(domains)
    .groupBy(domains.status);

  const counts = {
    pending: 0,
    fetching: 0,
    ready: 0,
    summarizing: 0,
    done: 0,
    failed: 0,
    skipped: 0,
  };
  for (const row of rows) {
    if (row.status in counts) {
      counts[row.status as keyof typeof counts] = Number(row.count);
    }
  }
  return counts;
}

export type DashboardSnapshot = {
  stats: Awaited<ReturnType<typeof domainStats>>;
  throughput: { minute: number; fifteen: number; hour: number };
  pendingByPriority: { priority: number; count: number }[];
  readyByPriority: { priority: number; count: number }[];
  pendingBySource: { source: string; count: number }[];
  categories: {
    id: number;
    name: string;
    ignored: boolean;
    domainCount: number;
    crawlPriority: number;
  }[];
  tags: { id: number; name: string; ignored: boolean; domainCount: number }[];
  recentDone: {
    id: number;
    host: string;
    name: string | null;
    summary: string | null;
    categoryName: string | null;
    processedAt: Date | null;
  }[];
  recentFailed: {
    id: number;
    host: string;
    error: string | null;
    processedAt: Date | null;
  }[];
  crawlPriority: CategoryPriorityConfig;
};

export async function dashboardSnapshot(): Promise<DashboardSnapshot> {
  const [
    stats,
    throughputResult,
    pendingPri,
    readyPri,
    pendingSrc,
    categoryRows,
    tagRows,
    recentDone,
    recentFailed,
  ] = await Promise.all([
    domainStats(),
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE processed_at > now() - interval '1 minute')::int AS minute,
        count(*) FILTER (WHERE processed_at > now() - interval '15 minutes')::int AS fifteen,
        count(*) FILTER (WHERE processed_at > now() - interval '1 hour')::int AS hour
      FROM domains
      WHERE status = 'done' AND processed_at > now() - interval '1 hour'
    `),
    db
      .select({
        priority: domains.priority,
        count: sql<number>`count(*)::int`,
      })
      .from(domains)
      .where(eq(domains.status, "pending"))
      .groupBy(domains.priority)
      .orderBy(desc(domains.priority)),
    db
      .select({
        priority: domains.priority,
        count: sql<number>`count(*)::int`,
      })
      .from(domains)
      .where(eq(domains.status, "ready"))
      .groupBy(domains.priority)
      .orderBy(desc(domains.priority)),
    db
      .select({
        source: domains.source,
        count: sql<number>`count(*)::int`,
      })
      .from(domains)
      .where(eq(domains.status, "pending"))
      .groupBy(domains.source)
      .orderBy(sql`count(*) DESC`),
    db.select().from(categories).orderBy(desc(categories.domainCount), asc(categories.name)),
    db.select().from(tags).orderBy(desc(tags.domainCount), asc(tags.name)).limit(30),
    db
      .select({
        id: domains.id,
        host: domains.host,
        name: domains.name,
        summary: domains.summary,
        categoryName: categories.name,
        processedAt: domains.processedAt,
      })
      .from(domains)
      .leftJoin(categories, eq(domains.categoryId, categories.id))
      .where(eq(domains.status, "done"))
      .orderBy(sql`${domains.processedAt} DESC NULLS LAST`)
      .limit(20),
    db
      .select({
        id: domains.id,
        host: domains.host,
        error: domains.error,
        processedAt: domains.processedAt,
      })
      .from(domains)
      .where(eq(domains.status, "failed"))
      .orderBy(sql`${domains.processedAt} DESC NULLS LAST`)
      .limit(15),
  ]);

  const t = (throughputResult.rows[0] ?? {}) as {
    minute?: number;
    fifteen?: number;
    hour?: number;
  };

  return {
    stats,
    throughput: {
      minute: Number(t.minute ?? 0),
      fifteen: Number(t.fifteen ?? 0),
      hour: Number(t.hour ?? 0),
    },
    pendingByPriority: pendingPri.map((row) => ({
      priority: Number(row.priority),
      count: Number(row.count),
    })),
    readyByPriority: readyPri.map((row) => ({
      priority: Number(row.priority),
      count: Number(row.count),
    })),
    pendingBySource: pendingSrc.map((row) => ({
      source: row.source,
      count: Number(row.count),
    })),
    categories: categoryRows.map((row) => ({
      id: row.id,
      name: row.name,
      ignored: row.ignored,
      domainCount: row.domainCount,
      crawlPriority: crawlPriorityForCategory(row.name),
    })),
    tags: tagRows.map((row) => ({
      id: row.id,
      name: row.name,
      ignored: row.ignored,
      domainCount: row.domainCount,
    })),
    recentDone,
    recentFailed,
    crawlPriority: loadCategoryPriorityConfig(true),
  };
}

export type SearchQuery = {
  q?: string;
  categoryId?: number;
  tagIds?: number[];
  limit?: number;
  offset?: number;
};

export async function searchDomains(input: SearchQuery) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const q = input.q?.trim() ?? "";
  const tagIds = input.tagIds?.filter((id) => Number.isFinite(id)) ?? [];

  const ignoredTag = sql`EXISTS (
    SELECT 1
    FROM domain_tags dt
    JOIN tags t ON t.id = dt.tag_id
    WHERE dt.domain_id = ${domains.id}
      AND t.ignored = true
  )`;

  const conditions = [
    eq(domains.status, "done"),
    sql`(${categories.id} IS NULL OR ${categories.ignored} = false)`,
    sql`NOT ${ignoredTag}`,
  ];

  if (input.categoryId) {
    conditions.push(eq(domains.categoryId, input.categoryId));
  }

  if (tagIds.length > 0) {
    conditions.push(sql`(
      SELECT count(*)::int
      FROM domain_tags dt
      WHERE dt.domain_id = ${domains.id}
        AND dt.tag_id IN (${sql.join(
          tagIds.map((id) => sql`${id}`),
          sql`, `,
        )})
    ) = ${tagIds.length}`);
  }

  if (q) {
    conditions.push(sql`(
      ${domains.summary} ILIKE ${"%" + q + "%"}
      OR ${domains.summary} % ${q}
      OR ${domains.host} ILIKE ${"%" + q + "%"}
      OR ${domains.name} ILIKE ${"%" + q + "%"}
    )`);
  }

  const scoreExpr = q
    ? sql<number>`GREATEST(
        similarity(coalesce(${domains.summary}, ''), ${q}),
        similarity(${domains.host}, ${q}),
        similarity(coalesce(${domains.name}, ''), ${q})
      )`
    : sql<number>`NULL`;

  const rows = await db
    .select({
      id: domains.id,
      host: domains.host,
      name: domains.name,
      summary: domains.summary,
      categoryId: categories.id,
      categoryName: categories.name,
      score: scoreExpr,
    })
    .from(domains)
    .leftJoin(categories, eq(domains.categoryId, categories.id))
    .where(and(...conditions))
    .orderBy(q ? sql`${scoreExpr} DESC` : sql`${domains.processedAt} DESC NULLS LAST`)
    .limit(limit)
    .offset(offset);

  const ids = rows.map((r) => r.id);
  const tagMap = new Map<string, { id: number; name: string }[]>();

  if (ids.length > 0) {
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
  }

  return rows.map((row) => ({
    id: String(row.id),
    host: row.host,
    name: row.name,
    summary: row.summary,
    category: row.categoryId && row.categoryName ? { id: row.categoryId, name: row.categoryName } : null,
    tags: tagMap.get(String(row.id)) ?? [],
    score: row.score == null ? null : Number(row.score),
  }));
}

export async function requeueFailed(): Promise<{ ready: number; pending: number }> {
  const toReady = await db.execute(sql`
    UPDATE domains
    SET status = 'ready', error = null, updated_at = now(), processed_at = null
    WHERE status = 'failed' AND page_text IS NOT NULL
    RETURNING id
  `);
  const toPending = await db.execute(sql`
    UPDATE domains
    SET status = 'pending', error = null, updated_at = now(), processed_at = null
    WHERE status = 'failed' AND page_text IS NULL
    RETURNING id
  `);
  return { ready: toReady.rows.length, pending: toPending.rows.length };
}

export async function flushUnfinishedQueue(): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM domains
    WHERE status IN ('pending', 'fetching', 'ready', 'summarizing', 'failed', 'skipped')
    RETURNING id
  `);
  return result.rows.length;
}
