import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  allowedTlds,
  countryDisplayName,
  crawlPriorityForCategory,
  crawlPriorityForOutbound,
  defaultCrawlPriority,
  hostApex,
  isIndexableHost,
  loadBlockedApexes,
  loadCategoryPriorityConfig,
  maxSubdomainsPerApex,
  normalizeCountry,
  normalizeLabel,
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

type QueueExec = Pick<typeof db, "insert" | "execute">;

const WORKING_SUBDOMAIN = sql`status <> 'skipped' AND host <> apex`;

async function pickHostsForQueue(exec: QueueExec, hosts: string[]): Promise<string[]> {
  const unique = [...new Set(hosts)].filter(isIndexableHost);
  if (unique.length === 0) return [];

  const cap = maxSubdomainsPerApex();
  const existingRows = await exec.execute(sql`
    SELECT host FROM domains WHERE host IN (${sql.join(
      unique.map((h) => sql`${h}`),
      sql`, `,
    )})
  `);
  const existing = new Set(
    (existingRows.rows as { host?: string }[]).map((row) => String(row.host)),
  );

  const apexes = [...new Set(unique.map((h) => hostApex(h)))];
  const countRows = await exec.execute(sql`
    SELECT apex, count(*)::int AS n
    FROM domains
    WHERE apex IN (${sql.join(
      apexes.map((a) => sql`${a}`),
      sql`, `,
    )})
      AND ${WORKING_SUBDOMAIN}
    GROUP BY apex
  `);
  const used = new Map<string, number>();
  for (const row of countRows.rows as { apex?: string; n?: number }[]) {
    used.set(String(row.apex), Number(row.n ?? 0));
  }

  const chosen: string[] = [];
  const taken = new Map<string, number>();
  for (const host of unique) {
    if (existing.has(host)) {
      chosen.push(host);
      continue;
    }
    const apex = hostApex(host);
    if (host === apex) {
      chosen.push(host);
      continue;
    }
    const n = (used.get(apex) ?? 0) + (taken.get(apex) ?? 0);
    if (n >= cap) continue;
    taken.set(apex, (taken.get(apex) ?? 0) + 1);
    chosen.push(host);
  }
  return chosen;
}

async function insertQueuedHosts(
  exec: QueueExec,
  hosts: string[],
  source: DomainSource,
  priority: number,
): Promise<number> {
  if (hosts.length === 0) return 0;
  const unique = [...new Set(hosts)].filter(isIndexableHost);
  if (unique.length === 0) return 0;

  const apexes = [...new Set(unique.map((h) => hostApex(h)))].sort();
  for (const apex of apexes) {
    await exec.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${apex}))`);
  }

  const chosen = await pickHostsForQueue(exec, unique);
  if (chosen.length === 0) return 0;

  const rows = await exec
    .insert(domains)
    .values(
      chosen.map((host) => ({
        host,
        apex: hostApex(host),
        status: "pending" as const,
        source,
        priority,
      })),
    )
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
  return db.transaction(async (tx) => insertQueuedHosts(tx, hosts, source, priority));
}

/** Drop link targets that would exceed MAX_SUBDOMAINS_PER_APEX (already-queued hosts kept). */
export async function filterOutboundHosts(hosts: string[]): Promise<string[]> {
  return pickHostsForQueue(db, hosts);
}

/** Delete overflow `pending` subdomains only on apexes already over the cap (e.g. tumblr). */
export async function trimApexQueueOverflow(): Promise<number> {
  const cap = maxSubdomainsPerApex();
  const result = await db.execute(sql`
    WITH working AS (
      SELECT apex, count(*)::int AS n
      FROM domains
      WHERE apex IS NOT NULL
        AND host <> apex
        AND status <> 'skipped'
      GROUP BY apex
      HAVING count(*) > ${cap}
    ),
    non_pending AS (
      SELECT d.apex, count(*)::int AS n
      FROM domains d
      INNER JOIN working w ON w.apex = d.apex
      WHERE d.host <> d.apex
        AND d.status NOT IN ('skipped', 'pending')
      GROUP BY d.apex
    ),
    keep_n AS (
      SELECT w.apex, GREATEST(0, ${cap} - coalesce(np.n, 0))::int AS keep
      FROM working w
      LEFT JOIN non_pending np ON np.apex = w.apex
    ),
    ranked AS (
      SELECT d.id,
        row_number() OVER (PARTITION BY d.apex ORDER BY d.priority DESC, d.id ASC) AS rn,
        k.keep
      FROM domains d
      INNER JOIN keep_n k ON k.apex = d.apex
      WHERE d.status = 'pending'
        AND d.host <> d.apex
    )
    DELETE FROM domains
    WHERE id IN (SELECT id FROM ranked WHERE rn > keep)
    RETURNING id
  `);
  return result.rows.length;
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
  const outbound = await pickHostsForQueue(db, input.outboundHosts);
  await db
    .update(domains)
    .set({
      pageTitle: input.title || null,
      pageText: input.text,
      pageUrl: input.url,
      httpStatus: input.httpStatus,
      fetchedAt: new Date(),
      outboundHosts: outbound.length > 0 ? outbound : null,
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

/** Drop unfinished rows under crawler-trap apexes (data/blocked-apex.txt). Keeps done. */
export async function dropBlockedApexQueue(): Promise<number> {
  const apexes = [...loadBlockedApexes(true)];
  if (apexes.length === 0) return 0;
  const result = await db.execute(sql`
    DELETE FROM domains
    WHERE status IN ('pending', 'fetching', 'ready', 'summarizing', 'failed', 'skipped')
      AND apex IN (${sql.join(
        apexes.map((a) => sql`${a}`),
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
  language?: string | null;
  place?: string | null;
  country?: string | null;
  httpStatus: number | null;
  outboundHosts?: string[];
}): Promise<{ enqueued: number; priority: number }> {
  const linkPriority = crawlPriorityForOutbound(input.category, input.language);
  // Unique + sort so concurrent completes lock tags in the same order (avoids deadlocks)
  // and so duplicate LLM tags cannot double-increment domain_count.
  const uniqueTags = [
    ...new Set(input.tags.map(normalizeLabel).filter(Boolean)),
  ].sort();
  let enqueued = 0;

  await db.transaction(async (tx) => {
    const [category] = await tx
      .insert(categories)
      .values({
        name: input.category,
        ignored: input.category === "empty" || input.category === "parked",
      })
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
    for (const tagName of uniqueTags) {
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
        language: input.language ?? null,
        place: input.place ?? null,
        country: input.country ?? null,
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

const SAMPLE_SKIP_CATEGORIES = ["empty", "parked"] as const;

/** Pick the largest non-empty/parked category by domain_count (a "wide" bucket). */
export async function widestDoneCategory(): Promise<{ name: string; domainCount: number } | null> {
  const [row] = await db
    .select({
      name: categories.name,
      domainCount: categories.domainCount,
    })
    .from(categories)
    .where(
      and(
        eq(categories.ignored, false),
        sql`${categories.name} NOT IN (${sql.join(
          SAMPLE_SKIP_CATEGORIES.map((n) => sql`${n}`),
          sql`, `,
        )})`,
      ),
    )
    .orderBy(desc(categories.domainCount), asc(categories.name))
    .limit(1);
  return row ?? null;
}

/** Random sample of done hosts in a category (for LM quality compares). */
export async function sampleDoneHosts(input: {
  category?: string;
  limit: number;
}): Promise<{
  category: string;
  hosts: { host: string; name: string | null; summary: string | null }[];
}> {
  const limit = Math.max(1, Math.min(input.limit, 100));
  let categoryName = input.category?.trim().toLowerCase() || "";

  if (!categoryName) {
    const wide = await widestDoneCategory();
    if (!wide) throw new Error("no done categories to sample from — ingest + run LM first, or pass --domains");
    categoryName = wide.name;
  }

  const rows = await db
    .select({
      host: domains.host,
      name: domains.name,
      summary: domains.summary,
    })
    .from(domains)
    .innerJoin(categories, eq(domains.categoryId, categories.id))
    .where(and(eq(domains.status, "done"), eq(categories.name, categoryName)))
    .orderBy(sql`random()`)
    .limit(limit);

  if (rows.length === 0) {
    throw new Error(
      `no done domains in category "${categoryName}" — pick another with --category or pass --domains`,
    );
  }

  return { category: categoryName, hosts: rows };
}

export async function typeaheadLabels(kind: "category" | "tag", q: string, limit = 20) {
  const table = kind === "category" ? categories : tags;
  const query = q.trim();
  if (!query) {
    return db
      .select()
      .from(table)
      .orderBy(desc(table.domainCount), asc(table.name))
      .limit(limit);
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
    .orderBy(
      sql`similarity(${table.name}, ${query}) DESC`,
      desc(table.domainCount),
      asc(table.name),
    )
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

export type PgTableSize = {
  name: string;
  totalBytes: number;
  heapBytes: number;
  indexBytes: number;
  toastBytes: number;
  liveRows: number;
  deadRows: number;
  lastVacuum: Date | null;
  lastAnalyze: Date | null;
};

export type PgIndexSize = {
  name: string;
  table: string;
  bytes: number;
  scans: number;
};

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
  failedByError: { error: string; count: number }[];
  queueAge: {
    oldestFetching: Date | null;
    oldestReady: Date | null;
    oldestSummarizing: Date | null;
  };
  staging: { status: string; rows: number; withText: number; textBytes: number }[];
  pg: {
    databaseBytes: number;
    cacheHitRatio: number | null;
    tempBytes: number;
    deadlocks: number;
    connections: { total: number; active: number; idle: number; max: number };
    tables: PgTableSize[];
    indexes: PgIndexSize[];
  };
  crawlPriority: CategoryPriorityConfig;
};

function asNum(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function asDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(d.getTime()) ? d : null;
}

function laterDate(a: unknown, b: unknown): Date | null {
  const da = asDate(a);
  const db = asDate(b);
  if (!da) return db;
  if (!db) return da;
  return da >= db ? da : db;
}

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
    failedErr,
    queueAgeResult,
    stagingResult,
    dbSizeResult,
    connResult,
    tableResult,
    indexResult,
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
    db.execute(sql`
      SELECT coalesce(left(error, 96), '(none)') AS error, count(*)::int AS count
      FROM domains
      WHERE status = 'failed'
      GROUP BY 1
      ORDER BY count(*) DESC
      LIMIT 12
    `),
    db.execute(sql`
      SELECT
        min(updated_at) FILTER (WHERE status = 'fetching') AS oldest_fetching,
        min(fetched_at) FILTER (WHERE status = 'ready') AS oldest_ready,
        min(updated_at) FILTER (WHERE status = 'summarizing') AS oldest_summarizing
      FROM domains
      WHERE status IN ('fetching', 'ready', 'summarizing')
    `),
    db.execute(sql`
      SELECT
        status,
        count(*)::int AS rows,
        count(*) FILTER (WHERE page_text IS NOT NULL)::int AS with_text,
        coalesce(sum(octet_length(page_text)), 0)::bigint AS text_bytes
      FROM domains
      WHERE status IN ('fetching', 'ready', 'summarizing', 'failed')
      GROUP BY status
      ORDER BY text_bytes DESC
    `),
    db.execute(sql`
      SELECT
        pg_database_size(current_database())::bigint AS database_bytes,
        d.blks_hit::bigint AS blks_hit,
        d.blks_read::bigint AS blks_read,
        d.temp_bytes::bigint AS temp_bytes,
        d.deadlocks::int AS deadlocks
      FROM pg_stat_database d
      WHERE d.datname = current_database()
    `),
    db.execute(sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE state = 'active')::int AS active,
        count(*) FILTER (WHERE state = 'idle')::int AS idle,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max
      FROM pg_stat_activity
      WHERE datname = current_database()
    `),
    db.execute(sql`
      SELECT
        c.relname AS name,
        pg_total_relation_size(c.oid)::bigint AS total_bytes,
        pg_relation_size(c.oid)::bigint AS heap_bytes,
        pg_indexes_size(c.oid)::bigint AS index_bytes,
        coalesce(pg_total_relation_size(c.reltoastrelid), 0)::bigint AS toast_bytes,
        coalesce(s.n_live_tup, 0)::bigint AS live_rows,
        coalesce(s.n_dead_tup, 0)::bigint AS dead_rows,
        s.last_vacuum,
        s.last_autovacuum,
        s.last_analyze,
        s.last_autoanalyze
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC
    `),
    db.execute(sql`
      SELECT
        i.relname AS name,
        t.relname AS table_name,
        pg_relation_size(i.oid)::bigint AS bytes,
        coalesce(s.idx_scan, 0)::bigint AS scans
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class t ON t.oid = x.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = i.oid
      WHERE n.nspname = 'public'
      ORDER BY pg_relation_size(i.oid) DESC
    `),
  ]);

  const t = (throughputResult.rows[0] ?? {}) as {
    minute?: number;
    fifteen?: number;
    hour?: number;
  };
  const dbSize = (dbSizeResult.rows[0] ?? {}) as Record<string, unknown>;
  const conn = (connResult.rows[0] ?? {}) as Record<string, unknown>;
  const age = (queueAgeResult.rows[0] ?? {}) as Record<string, unknown>;
  const blksHit = asNum(dbSize.blks_hit);
  const blksRead = asNum(dbSize.blks_read);

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
    failedByError: failedErr.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return { error: String(r.error ?? "(none)"), count: asNum(r.count) };
    }),
    queueAge: {
      oldestFetching: asDate(age.oldest_fetching),
      oldestReady: asDate(age.oldest_ready),
      oldestSummarizing: asDate(age.oldest_summarizing),
    },
    staging: stagingResult.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        status: String(r.status),
        rows: asNum(r.rows),
        withText: asNum(r.with_text),
        textBytes: asNum(r.text_bytes),
      };
    }),
    pg: {
      databaseBytes: asNum(dbSize.database_bytes),
      cacheHitRatio: blksHit + blksRead > 0 ? blksHit / (blksHit + blksRead) : null,
      tempBytes: asNum(dbSize.temp_bytes),
      deadlocks: asNum(dbSize.deadlocks),
      connections: {
        total: asNum(conn.total),
        active: asNum(conn.active),
        idle: asNum(conn.idle),
        max: asNum(conn.max),
      },
      tables: tableResult.rows.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          name: String(r.name),
          totalBytes: asNum(r.total_bytes),
          heapBytes: asNum(r.heap_bytes),
          indexBytes: asNum(r.index_bytes),
          toastBytes: asNum(r.toast_bytes),
          liveRows: asNum(r.live_rows),
          deadRows: asNum(r.dead_rows),
          lastVacuum: laterDate(r.last_vacuum, r.last_autovacuum),
          lastAnalyze: laterDate(r.last_analyze, r.last_autoanalyze),
        };
      }),
      indexes: indexResult.rows.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          name: String(r.name),
          table: String(r.table_name),
          bytes: asNum(r.bytes),
          scans: asNum(r.scans),
        };
      }),
    },
    crawlPriority: loadCategoryPriorityConfig(true),
  };
}

export type PipelineSnapshot = {
  stats: Awaited<ReturnType<typeof domainStats>>;
  throughput: { minute: number; fifteen: number; hour: number };
  failedThroughput: { minute: number; fifteen: number };
  doneByCategory: { name: string; minute: number; fifteen: number }[];
  pendingByPriority: { priority: number; count: number }[];
  readyByPriority: { priority: number; count: number }[];
  pendingBySource: { source: string; count: number }[];
  recentDone: {
    id: number;
    host: string;
    name: string | null;
    categoryName: string | null;
    processedAt: Date | null;
  }[];
  queueAge: {
    oldestFetching: Date | null;
    oldestReady: Date | null;
    oldestSummarizing: Date | null;
  };
};

/** Lightweight queue/LM snapshot for the workers page (no PG admin / feeds). */
export async function pipelineSnapshot(): Promise<PipelineSnapshot> {
  const [
    stats,
    throughputResult,
    failedThroughputResult,
    doneByCategoryResult,
    pendingPri,
    readyPri,
    pendingSrc,
    recentDone,
    queueAgeResult,
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
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE processed_at > now() - interval '1 minute')::int AS minute,
        count(*) FILTER (WHERE processed_at > now() - interval '15 minutes')::int AS fifteen
      FROM domains
      WHERE status = 'failed' AND processed_at > now() - interval '15 minutes'
    `),
    db.execute(sql`
      SELECT
        coalesce(c.name, '(none)') AS name,
        count(*) FILTER (WHERE d.processed_at > now() - interval '1 minute')::int AS minute,
        count(*) FILTER (WHERE d.processed_at > now() - interval '15 minutes')::int AS fifteen
      FROM domains d
      LEFT JOIN categories c ON c.id = d.category_id
      WHERE d.status = 'done' AND d.processed_at > now() - interval '15 minutes'
      GROUP BY c.name
      HAVING count(*) FILTER (WHERE d.processed_at > now() - interval '15 minutes') > 0
      ORDER BY minute DESC, fifteen DESC
      LIMIT 24
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
    db
      .select({
        id: domains.id,
        host: domains.host,
        name: domains.name,
        categoryName: categories.name,
        processedAt: domains.processedAt,
      })
      .from(domains)
      .leftJoin(categories, eq(domains.categoryId, categories.id))
      .where(eq(domains.status, "done"))
      .orderBy(sql`${domains.processedAt} DESC NULLS LAST`)
      .limit(12),
    db.execute(sql`
      SELECT
        min(updated_at) FILTER (WHERE status = 'fetching') AS oldest_fetching,
        min(fetched_at) FILTER (WHERE status = 'ready') AS oldest_ready,
        min(updated_at) FILTER (WHERE status = 'summarizing') AS oldest_summarizing
      FROM domains
      WHERE status IN ('fetching', 'ready', 'summarizing')
    `),
  ]);

  const t = (throughputResult.rows[0] ?? {}) as {
    minute?: number;
    fifteen?: number;
    hour?: number;
  };
  const f = (failedThroughputResult.rows[0] ?? {}) as {
    minute?: number;
    fifteen?: number;
  };
  const age = (queueAgeResult.rows[0] ?? {}) as Record<string, unknown>;

  return {
    stats,
    throughput: {
      minute: Number(t.minute ?? 0),
      fifteen: Number(t.fifteen ?? 0),
      hour: Number(t.hour ?? 0),
    },
    failedThroughput: {
      minute: Number(f.minute ?? 0),
      fifteen: Number(f.fifteen ?? 0),
    },
    doneByCategory: doneByCategoryResult.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        name: String(r.name ?? "(none)"),
        minute: asNum(r.minute),
        fifteen: asNum(r.fifteen),
      };
    }),
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
    recentDone,
    queueAge: {
      oldestFetching: asDate(age.oldest_fetching),
      oldestReady: asDate(age.oldest_ready),
      oldestSummarizing: asDate(age.oldest_summarizing),
    },
  };
}

export type SearchQuery = {
  q?: string;
  categoryId?: number;
  tagIds?: number[];
  country?: string;
  limit?: number;
  offset?: number;
};

export async function searchDomains(input: SearchQuery) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const q = input.q?.trim() ?? "";
  const tagIds = input.tagIds?.filter((id) => Number.isFinite(id)) ?? [];
  const explicitCategory = Boolean(input.categoryId);
  const explicitTags = tagIds.length > 0;
  // Explicit category/tag filters override ignore — otherwise empty/parked
  // (auto-ignored) are unreachable from search.
  const honorCategoryIgnore = !explicitCategory && !explicitTags;

  const ignoredTag = explicitTags
    ? sql`EXISTS (
        SELECT 1
        FROM domain_tags dt
        JOIN tags t ON t.id = dt.tag_id
        WHERE dt.domain_id = ${domains.id}
          AND t.ignored = true
          AND t.id NOT IN (${sql.join(
            tagIds.map((id) => sql`${id}`),
            sql`, `,
          )})
      )`
    : sql`EXISTS (
        SELECT 1
        FROM domain_tags dt
        JOIN tags t ON t.id = dt.tag_id
        WHERE dt.domain_id = ${domains.id}
          AND t.ignored = true
      )`;

  const conditions = [
    eq(domains.status, "done"),
    sql`NOT ${ignoredTag}`,
  ];

  if (honorCategoryIgnore) {
    conditions.push(sql`(${categories.id} IS NULL OR ${categories.ignored} = false)`);
  }

  if (input.categoryId) {
    conditions.push(eq(domains.categoryId, input.categoryId));
  }

  const country = normalizeCountry(input.country);
  if (country) {
    conditions.push(eq(domains.country, country));
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
      language: domains.language,
      place: domains.place,
      country: domains.country,
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
    language: row.language,
    place: row.place,
    country: row.country,
    category: row.categoryId && row.categoryName ? { id: row.categoryId, name: row.categoryName } : null,
    tags: tagMap.get(String(row.id)) ?? [],
    score: row.score == null ? null : Number(row.score),
  }));
}

export async function typeaheadCountries(q: string, limit = 20) {
  const cap = Math.min(Math.max(limit, 1), 50);
  const rows = await db
    .select({
      code: domains.country,
      count: sql<number>`count(*)::int`,
    })
    .from(domains)
    .where(and(eq(domains.status, "done"), sql`${domains.country} IS NOT NULL`))
    .groupBy(domains.country)
    .orderBy(sql`count(*) DESC`);

  const query = q.trim().toLowerCase();
  let items = rows
    .filter((r): r is { code: string; count: number } => Boolean(r.code))
    .map((r) => ({
      code: r.code,
      name: countryDisplayName(r.code),
      count: Number(r.count),
    }));

  if (query) {
    items = items.filter(
      (i) => i.code.toLowerCase().includes(query) || i.name.toLowerCase().includes(query),
    );
  }

  return items.slice(0, cap);
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
