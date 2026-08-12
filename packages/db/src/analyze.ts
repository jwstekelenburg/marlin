import { and, asc, desc, eq, sql } from "drizzle-orm";
import { maxSubdomainsPerApex, normalizeLabel } from "@marlin/shared";
import { db } from "./client.js";
import { aliasLine, type LabelKind } from "./label-merge.js";
import { apexReviews, blockedApexes, categories, domains, tags } from "./schema.js";

const JUNK_CATS = [
  "hotel",
  "hotel-booking",
  "accommodation",
  "gambling",
  "gambling-site",
  "gambling-guide",
  "gambling-review",
  "ecommerce",
  "empty",
  "parked",
] as const;

function junkListSql() {
  return sql.join(
    JUNK_CATS.map((c) => sql`${c}`),
    sql`, `,
  );
}

function num(v: unknown): number {
  return Number(v) || 0;
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

export type AnalyzeOverview = {
  stats: {
    pending: number;
    fetching: number;
    ready: number;
    summarizing: number;
    done: number;
    failed: number;
    skipped: number;
  };
  nullRates: {
    done: number;
    languageNull: number;
    countryNull: number;
    placeNull: number;
  };
  sourceMix: { source: string; count: number }[];
  topCategories: {
    id: number;
    name: string;
    ignored: boolean;
    domainCount: number;
  }[];
  topTags: {
    id: number;
    name: string;
    ignored: boolean;
    domainCount: number;
  }[];
  topPlatforms: {
    apex: string;
    hosts: number;
    done: number;
    empty: number;
    parked: number;
    junkDone: number;
  }[];
  worstQuality: {
    apex: string;
    done: number;
    emptyParkedRate: number;
    junkRate: number;
  }[];
  steward: {
    blockedTotal: number;
    recentBlocks: {
      apex: string;
      reason: string;
      source: string;
      createdAt: string;
    }[];
  };
};

export async function analyzeOverview(): Promise<AnalyzeOverview> {
  const junk = junkListSql();
  const [
    statusResult,
    nullResult,
    sourceResult,
    topCats,
    topTagsRows,
    topPlatformsResult,
    worstResult,
    blockedCountResult,
    recentBlocks,
  ] = await Promise.all([
    db.execute(sql`
      SELECT status, count(*)::int AS n FROM domains GROUP BY status
    `),
    db.execute(sql`
      SELECT
        count(*)::int AS done,
        count(*) FILTER (WHERE language IS NULL)::int AS language_null,
        count(*) FILTER (WHERE country IS NULL)::int AS country_null,
        count(*) FILTER (WHERE place IS NULL)::int AS place_null
      FROM domains WHERE status = 'done'
    `),
    db.execute(sql`
      SELECT source, count(*)::int AS n
      FROM domains
      WHERE status = 'done'
      GROUP BY source
      ORDER BY n DESC
    `),
    db
      .select({
        id: categories.id,
        name: categories.name,
        ignored: categories.ignored,
        domainCount: categories.domainCount,
      })
      .from(categories)
      .orderBy(desc(categories.domainCount), asc(categories.name))
      .limit(15),
    db
      .select({
        id: tags.id,
        name: tags.name,
        ignored: tags.ignored,
        domainCount: tags.domainCount,
      })
      .from(tags)
      .orderBy(desc(tags.domainCount), asc(tags.name))
      .limit(15),
    db.execute(sql`
      SELECT
        d.apex,
        count(*)::int AS hosts,
        count(*) FILTER (WHERE d.status = 'done')::int AS done,
        count(*) FILTER (WHERE d.status = 'done' AND c.name = 'empty')::int AS empty,
        count(*) FILTER (WHERE d.status = 'done' AND c.name = 'parked')::int AS parked,
        count(*) FILTER (WHERE d.status = 'done' AND c.name IN (${junk}))::int AS junk_done
      FROM domains d
      LEFT JOIN categories c ON c.id = d.category_id
      GROUP BY d.apex
      ORDER BY done DESC NULLS LAST, hosts DESC
      LIMIT 12
    `),
    db.execute(sql`
      SELECT
        d.apex,
        count(*) FILTER (WHERE d.status = 'done')::int AS done,
        count(*) FILTER (WHERE d.status = 'done' AND c.name IN ('empty', 'parked'))::int AS empty_parked,
        count(*) FILTER (WHERE d.status = 'done' AND c.name IN (${junk}))::int AS junk_done
      FROM domains d
      LEFT JOIN categories c ON c.id = d.category_id
      GROUP BY d.apex
      HAVING count(*) FILTER (WHERE d.status = 'done') >= 20
      ORDER BY
        (count(*) FILTER (WHERE d.status = 'done' AND c.name IN ('empty', 'parked'))::float
          / NULLIF(count(*) FILTER (WHERE d.status = 'done'), 0)) DESC NULLS LAST
      LIMIT 10
    `),
    db.execute(sql`SELECT count(*)::int AS n FROM blocked_apexes`),
    db
      .select({
        apex: blockedApexes.apex,
        reason: blockedApexes.reason,
        source: blockedApexes.source,
        createdAt: blockedApexes.createdAt,
      })
      .from(blockedApexes)
      .orderBy(desc(blockedApexes.createdAt))
      .limit(8),
  ]);

  const stats = {
    pending: 0,
    fetching: 0,
    ready: 0,
    summarizing: 0,
    done: 0,
    failed: 0,
    skipped: 0,
  };
  for (const row of statusResult.rows as { status: string; n: number }[]) {
    const key = row.status as keyof typeof stats;
    if (key in stats) stats[key] = num(row.n);
  }

  const nullRow = (nullResult.rows[0] ?? {}) as Record<string, unknown>;
  const doneN = num(nullRow.done);

  return {
    stats,
    nullRates: {
      done: doneN,
      languageNull: num(nullRow.language_null),
      countryNull: num(nullRow.country_null),
      placeNull: num(nullRow.place_null),
    },
    sourceMix: (sourceResult.rows as { source: string; n: number }[]).map((r) => ({
      source: str(r.source),
      count: num(r.n),
    })),
    topCategories: topCats,
    topTags: topTagsRows,
    topPlatforms: (
      topPlatformsResult.rows as {
        apex: string;
        hosts: number;
        done: number;
        empty: number;
        parked: number;
        junk_done: number;
      }[]
    ).map((r) => ({
      apex: str(r.apex),
      hosts: num(r.hosts),
      done: num(r.done),
      empty: num(r.empty),
      parked: num(r.parked),
      junkDone: num(r.junk_done),
    })),
    worstQuality: (
      worstResult.rows as {
        apex: string;
        done: number;
        empty_parked: number;
        junk_done: number;
      }[]
    ).map((r) => {
      const done = num(r.done);
      return {
        apex: str(r.apex),
        done,
        emptyParkedRate: done > 0 ? num(r.empty_parked) / done : 0,
        junkRate: done > 0 ? num(r.junk_done) / done : 0,
      };
    }),
    steward: {
      blockedTotal: num((blockedCountResult.rows[0] as { n?: number } | undefined)?.n),
      recentBlocks: recentBlocks.map((r) => ({
        apex: r.apex,
        reason: r.reason,
        source: r.source,
        createdAt: r.createdAt.toISOString(),
      })),
    },
  };
}

export type PlatformRow = {
  apex: string;
  hosts: number;
  done: number;
  empty: number;
  parked: number;
  junkDone: number;
  emptyParkedRate: number;
  junkRate: number;
  subdomains: number;
  cap: number;
  sources: { source: string; count: number }[];
  blocked: { reason: string; source: string } | null;
  review: { verdict: string; reviewedAt: string } | null;
};

export type PlatformsList = {
  cap: number;
  note: string;
  minSubdomains: number;
  totalMatching: number;
  limit: number;
  rows: PlatformRow[];
  sourceMix: { source: string; count: number }[];
};

export async function analyzePlatforms(opts: {
  limit?: number;
  q?: string;
  /** Non-apex hosts (excl. skipped). Default 1 → only apexes with more than one subdomain. */
  minSubdomains?: number;
}): Promise<PlatformsList> {
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
  const minSubdomains = Math.max(opts.minSubdomains ?? 1, 0);
  const q = (opts.q ?? "").trim().toLowerCase();
  const junk = junkListSql();
  const cap = maxSubdomainsPerApex();

  const filter = q ? sql`AND d.apex ILIKE ${"%" + q + "%"}` : sql``;
  const havingSubs =
    minSubdomains > 0
      ? sql`HAVING count(*) FILTER (WHERE d.host <> d.apex AND d.status <> 'skipped') > ${minSubdomains}`
      : sql``;

  const [rowsResult, countResult, sourceResult] = await Promise.all([
    db.execute(sql`
      SELECT
        d.apex,
        count(*)::int AS hosts,
        count(*) FILTER (WHERE d.host <> d.apex AND d.status <> 'skipped')::int AS subdomains,
        count(*) FILTER (WHERE d.status = 'done')::int AS done,
        count(*) FILTER (WHERE d.status = 'done' AND c.name = 'empty')::int AS empty,
        count(*) FILTER (WHERE d.status = 'done' AND c.name = 'parked')::int AS parked,
        count(*) FILTER (WHERE d.status = 'done' AND c.name IN (${junk}))::int AS junk_done,
        max(b.reason) AS block_reason,
        max(b.source) AS block_source,
        max(r.verdict) AS review_verdict,
        max(r.reviewed_at) AS reviewed_at
      FROM domains d
      LEFT JOIN categories c ON c.id = d.category_id
      LEFT JOIN blocked_apexes b ON b.apex = d.apex
      LEFT JOIN apex_reviews r ON r.apex = d.apex
      WHERE true ${filter}
      GROUP BY d.apex
      ${havingSubs}
      ORDER BY subdomains DESC, done DESC NULLS LAST, hosts DESC
      LIMIT ${limit}
    `),
    db.execute(sql`
      SELECT count(*)::int AS n
      FROM (
        SELECT d.apex
        FROM domains d
        WHERE true ${filter}
        GROUP BY d.apex
        ${havingSubs}
      ) t
    `),
    db.execute(sql`
      SELECT source, count(*)::int AS n
      FROM domains
      WHERE status = 'done'
      GROUP BY source
      ORDER BY n DESC
    `),
  ]);

  const apexes = (rowsResult.rows as { apex: string }[]).map((r) => str(r.apex)).filter(Boolean);
  const sourceByApex = new Map<string, { source: string; count: number }[]>();
  if (apexes.length > 0) {
    const perSource = await db.execute(sql`
      SELECT apex, source, count(*)::int AS n
      FROM domains
      WHERE status = 'done'
        AND apex IN (${sql.join(
          apexes.map((a) => sql`${a}`),
          sql`, `,
        )})
      GROUP BY apex, source
    `);
    for (const row of perSource.rows as { apex: string; source: string; n: number }[]) {
      const list = sourceByApex.get(str(row.apex)) ?? [];
      list.push({ source: str(row.source), count: num(row.n) });
      sourceByApex.set(str(row.apex), list);
    }
  }

  const rows: PlatformRow[] = (
    rowsResult.rows as {
      apex: string;
      hosts: number;
      subdomains: number;
      done: number;
      empty: number;
      parked: number;
      junk_done: number;
      block_reason: string | null;
      block_source: string | null;
      review_verdict: string | null;
      reviewed_at: Date | string | null;
    }[]
  ).map((r) => {
    const done = num(r.done);
    const empty = num(r.empty);
    const parked = num(r.parked);
    const junkDone = num(r.junk_done);
    const blockReason = r.block_reason != null ? str(r.block_reason) : "";
    const blockSource = r.block_source != null ? str(r.block_source) : "";
    const verdict = r.review_verdict != null ? str(r.review_verdict) : "";
    const reviewedAt = r.reviewed_at
      ? r.reviewed_at instanceof Date
        ? r.reviewed_at.toISOString()
        : String(r.reviewed_at)
      : "";
    return {
      apex: str(r.apex),
      hosts: num(r.hosts),
      done,
      empty,
      parked,
      junkDone,
      emptyParkedRate: done > 0 ? (empty + parked) / done : 0,
      junkRate: done > 0 ? junkDone / done : 0,
      subdomains: num(r.subdomains),
      cap,
      sources: (sourceByApex.get(str(r.apex)) ?? []).sort((a, b) => b.count - a.count),
      blocked:
        blockReason || blockSource
          ? { reason: blockReason, source: blockSource || "steward" }
          : null,
      review: verdict
        ? { verdict, reviewedAt }
        : null,
    };
  });

  return {
    cap,
    note: "Apexes with more than one non-apex host. Link parentage is not stored — source mix is the discovery proxy.",
    minSubdomains,
    totalMatching: num((countResult.rows[0] as { n?: number } | undefined)?.n),
    limit,
    rows,
    sourceMix: (sourceResult.rows as { source: string; n: number }[]).map((r) => ({
      source: str(r.source),
      count: num(r.n),
    })),
  };
}

export type StewardEvidence = {
  hosts?: number;
  done?: number;
  junkDone?: number;
  spamLangDone?: number;
  hotelName?: boolean;
  sampleHosts?: string[];
};

export type PlatformDetail = {
  apex: string;
  hosts: number;
  done: number;
  empty: number;
  parked: number;
  junkDone: number;
  emptyParkedRate: number;
  junkRate: number;
  subdomains: number;
  cap: number;
  sources: { source: string; count: number }[];
  topCategories: { id: number; name: string; count: number }[];
  topLanguages: { language: string; count: number }[];
  samples: {
    id: number;
    host: string;
    name: string | null;
    summary: string | null;
    categoryName: string | null;
  }[];
  blocked: {
    reason: string;
    source: string;
    createdAt: string;
    evidence: StewardEvidence | null;
  } | null;
  /** Latest steward/manual review (apex_reviews is one row per apex — history is overwritten). */
  review: {
    verdict: string;
    reason: string;
    sampleSize: number;
    reviewedAt: string;
    evidence: StewardEvidence | null;
  } | null;
  /**
   * Steward only auto-nominates junk/spam/hotel heuristics once hosts ≥ ~10.
   * Busy apexes with no review row were never judged (or never matched nomination).
   */
  reviewGap: string | null;
};

function asEvidence(raw: unknown): StewardEvidence | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sampleHosts = Array.isArray(o.sampleHosts)
    ? o.sampleHosts.map((h) => String(h)).filter(Boolean)
    : undefined;
  return {
    hosts: o.hosts != null ? num(o.hosts) : undefined,
    done: o.done != null ? num(o.done) : undefined,
    junkDone: o.junkDone != null ? num(o.junkDone) : undefined,
    spamLangDone: o.spamLangDone != null ? num(o.spamLangDone) : undefined,
    hotelName: o.hotelName != null ? Boolean(o.hotelName) : undefined,
    sampleHosts,
  };
}

export async function analyzePlatformDetail(apexRaw: string): Promise<PlatformDetail | null> {
  const apex = apexRaw.trim().toLowerCase();
  if (!apex) return null;
  const junk = junkListSql();
  const cap = maxSubdomainsPerApex();

  const [statsResult, sourcesResult, catsResult, langsResult, samples, blocked, reviews] =
    await Promise.all([
      db.execute(sql`
      SELECT
        count(*)::int AS hosts,
        count(*) FILTER (WHERE d.host <> d.apex AND d.status <> 'skipped')::int AS subdomains,
        count(*) FILTER (WHERE d.status = 'done')::int AS done,
        count(*) FILTER (WHERE d.status = 'done' AND c.name = 'empty')::int AS empty,
        count(*) FILTER (WHERE d.status = 'done' AND c.name = 'parked')::int AS parked,
        count(*) FILTER (WHERE d.status = 'done' AND c.name IN (${junk}))::int AS junk_done
      FROM domains d
      LEFT JOIN categories c ON c.id = d.category_id
      WHERE d.apex = ${apex}
    `),
      db.execute(sql`
      SELECT source, count(*)::int AS n
      FROM domains
      WHERE apex = ${apex} AND status = 'done'
      GROUP BY source
      ORDER BY n DESC
    `),
      db.execute(sql`
      SELECT c.id, c.name, count(*)::int AS n
      FROM domains d
      INNER JOIN categories c ON c.id = d.category_id
      WHERE d.apex = ${apex} AND d.status = 'done'
      GROUP BY c.id, c.name
      ORDER BY n DESC
      LIMIT 15
    `),
      db.execute(sql`
      SELECT coalesce(language, '') AS language, count(*)::int AS n
      FROM domains
      WHERE apex = ${apex} AND status = 'done'
      GROUP BY language
      ORDER BY n DESC
      LIMIT 12
    `),
      db
        .select({
          id: domains.id,
          host: domains.host,
          name: domains.name,
          summary: domains.summary,
          categoryName: categories.name,
        })
        .from(domains)
        .leftJoin(categories, eq(domains.categoryId, categories.id))
        .where(and(eq(domains.apex, apex), eq(domains.status, "done")))
        .orderBy(desc(domains.processedAt))
        .limit(20),
      db
        .select({
          reason: blockedApexes.reason,
          source: blockedApexes.source,
          createdAt: blockedApexes.createdAt,
          evidence: blockedApexes.evidence,
        })
        .from(blockedApexes)
        .where(eq(blockedApexes.apex, apex))
        .limit(1),
      db
        .select({
          verdict: apexReviews.verdict,
          reason: apexReviews.reason,
          sampleSize: apexReviews.sampleSize,
          reviewedAt: apexReviews.reviewedAt,
          evidence: apexReviews.evidence,
        })
        .from(apexReviews)
        .where(eq(apexReviews.apex, apex))
        .limit(1),
    ]);

  const s = (statsResult.rows[0] ?? {}) as Record<string, unknown>;
  const hosts = num(s.hosts);
  if (hosts === 0 && blocked.length === 0 && reviews.length === 0) return null;

  const done = num(s.done);
  const empty = num(s.empty);
  const parked = num(s.parked);
  const junkDone = num(s.junk_done);
  const reviewRow = reviews[0];
  const blockedRow = blocked[0];

  let reviewGap: string | null = null;
  if (hosts >= 10 && !reviewRow && !blockedRow) {
    reviewGap =
      "Hosts ≥ 10 with no steward review on file. Steward only nominates junk/spam-lang/hotel heuristics — busy-but-clean apexes are never judged.";
  } else if (hosts >= 10 && !reviewRow && blockedRow?.source === "file") {
    reviewGap = "Seed/file block — no LM steward review row.";
  }

  return {
    apex,
    hosts,
    done,
    empty,
    parked,
    junkDone,
    emptyParkedRate: done > 0 ? (empty + parked) / done : 0,
    junkRate: done > 0 ? junkDone / done : 0,
    subdomains: num(s.subdomains),
    cap,
    sources: (sourcesResult.rows as { source: string; n: number }[]).map((r) => ({
      source: str(r.source),
      count: num(r.n),
    })),
    topCategories: (catsResult.rows as { id: number; name: string; n: number }[]).map((r) => ({
      id: num(r.id),
      name: str(r.name),
      count: num(r.n),
    })),
    topLanguages: (langsResult.rows as { language: string; n: number }[]).map((r) => ({
      language: str(r.language) || "(null)",
      count: num(r.n),
    })),
    samples: samples.map((r) => ({
      id: r.id,
      host: r.host,
      name: r.name,
      summary: r.summary,
      categoryName: r.categoryName,
    })),
    blocked: blockedRow
      ? {
          reason: blockedRow.reason,
          source: blockedRow.source,
          createdAt: blockedRow.createdAt.toISOString(),
          evidence: asEvidence(blockedRow.evidence),
        }
      : null,
    review: reviewRow
      ? {
          verdict: reviewRow.verdict,
          reason: reviewRow.reason,
          sampleSize: reviewRow.sampleSize,
          reviewedAt: reviewRow.reviewedAt.toISOString(),
          evidence: asEvidence(reviewRow.evidence),
        }
      : null,
    reviewGap,
  };
}

export type LabelsOverview = {
  categories: {
    id: number;
    name: string;
    ignored: boolean;
    domainCount: number;
  }[];
  tags: {
    id: number;
    name: string;
    ignored: boolean;
    domainCount: number;
  }[];
  languages: { language: string; count: number }[];
  countries: { country: string; count: number }[];
  places: { place: string; count: number }[];
  categoryLanguage: { categoryId: number; category: string; language: string; count: number }[];
};

export async function analyzeLabelsOverview(): Promise<LabelsOverview> {
  const [cats, tagRows, langs, countries, places, catLang] = await Promise.all([
    db
      .select({
        id: categories.id,
        name: categories.name,
        ignored: categories.ignored,
        domainCount: categories.domainCount,
      })
      .from(categories)
      .orderBy(desc(categories.domainCount), asc(categories.name)),
    db
      .select({
        id: tags.id,
        name: tags.name,
        ignored: tags.ignored,
        domainCount: tags.domainCount,
      })
      .from(tags)
      .orderBy(desc(tags.domainCount), asc(tags.name))
      .limit(500),
    db.execute(sql`
      SELECT coalesce(language, '') AS language, count(*)::int AS n
      FROM domains WHERE status = 'done'
      GROUP BY language
      ORDER BY n DESC
      LIMIT 40
    `),
    db.execute(sql`
      SELECT coalesce(country, '') AS country, count(*)::int AS n
      FROM domains WHERE status = 'done'
      GROUP BY country
      ORDER BY n DESC
      LIMIT 40
    `),
    db.execute(sql`
      SELECT place, count(*)::int AS n
      FROM domains
      WHERE status = 'done' AND place IS NOT NULL AND place <> ''
      GROUP BY place
      ORDER BY n DESC
      LIMIT 30
    `),
    db.execute(sql`
      SELECT c.id AS category_id, c.name AS category, coalesce(d.language, '') AS language, count(*)::int AS n
      FROM domains d
      INNER JOIN categories c ON c.id = d.category_id
      WHERE d.status = 'done'
      GROUP BY c.id, c.name, d.language
      ORDER BY n DESC
      LIMIT 80
    `),
  ]);

  return {
    categories: cats,
    tags: tagRows,
    languages: (langs.rows as { language: string; n: number }[]).map((r) => ({
      language: str(r.language) || "(null)",
      count: num(r.n),
    })),
    countries: (countries.rows as { country: string; n: number }[]).map((r) => ({
      country: str(r.country) || "(null)",
      count: num(r.n),
    })),
    places: (places.rows as { place: string; n: number }[]).map((r) => ({
      place: str(r.place),
      count: num(r.n),
    })),
    categoryLanguage: (
      catLang.rows as { category_id: number; category: string; language: string; n: number }[]
    ).map((r) => ({
      categoryId: num(r.category_id),
      category: str(r.category),
      language: str(r.language) || "(null)",
      count: num(r.n),
    })),
  };
}

export type TagPairMetric = "count" | "jaccard" | "lift" | "pmi";

export type TagPairRow = {
  tagAId: number;
  tagA: string;
  countA: number;
  tagBId: number;
  tagB: string;
  countB: number;
  both: number;
  jaccard: number;
  lift: number;
  pmi: number;
  pAGivenB: number;
  pBGivenA: number;
};

export type TagPairsResult = {
  minCount: number;
  metric: TagPairMetric;
  doneTotal: number;
  pairs: TagPairRow[];
  twins: TagPairRow[];
  implications: TagPairRow[];
};

export async function analyzeTagPairs(opts: {
  minCount?: number;
  metric?: TagPairMetric;
  limit?: number;
}): Promise<TagPairsResult> {
  const minCount = Math.min(Math.max(opts.minCount ?? 50, 5), 5000);
  const limit = Math.min(Math.max(opts.limit ?? 80, 10), 200);
  const metric = opts.metric ?? "jaccard";

  const doneTotalResult = await db.execute(sql`
    SELECT count(*)::int AS n FROM domains WHERE status = 'done'
  `);
  const doneTotal = num((doneTotalResult.rows[0] as { n?: number } | undefined)?.n);

  const result = await db.execute(sql`
    WITH eligible AS (
      SELECT id, name, domain_count
      FROM tags
      WHERE domain_count >= ${minCount}
    ),
    pairs AS (
      SELECT
        least(a.tag_id, b.tag_id) AS tag_a,
        greatest(a.tag_id, b.tag_id) AS tag_b,
        count(*)::int AS both
      FROM domain_tags a
      INNER JOIN domain_tags b
        ON a.domain_id = b.domain_id AND a.tag_id < b.tag_id
      INNER JOIN domains d ON d.id = a.domain_id AND d.status = 'done'
      WHERE a.tag_id IN (SELECT id FROM eligible)
        AND b.tag_id IN (SELECT id FROM eligible)
      GROUP BY 1, 2
      HAVING count(*) >= ${Math.max(5, Math.floor(minCount / 5))}
    )
    SELECT
      ea.id AS tag_a_id,
      ea.name AS tag_a,
      ea.domain_count AS count_a,
      eb.id AS tag_b_id,
      eb.name AS tag_b,
      eb.domain_count AS count_b,
      p.both
    FROM pairs p
    INNER JOIN eligible ea ON ea.id = p.tag_a
    INNER JOIN eligible eb ON eb.id = p.tag_b
  `);

  const pairs: TagPairRow[] = (
    result.rows as {
      tag_a_id: number;
      tag_a: string;
      count_a: number;
      tag_b_id: number;
      tag_b: string;
      count_b: number;
      both: number;
    }[]
  ).map((r) => {
    const countA = num(r.count_a);
    const countB = num(r.count_b);
    const both = num(r.both);
    const union = countA + countB - both;
    const jaccard = union > 0 ? both / union : 0;
    const expected = doneTotal > 0 ? (countA * countB) / doneTotal : 0;
    const lift = expected > 0 ? both / expected : 0;
    const pBoth = doneTotal > 0 ? both / doneTotal : 0;
    const pA = doneTotal > 0 ? countA / doneTotal : 0;
    const pB = doneTotal > 0 ? countB / doneTotal : 0;
    const pmi =
      pBoth > 0 && pA > 0 && pB > 0 ? Math.log2(pBoth / (pA * pB)) : 0;
    return {
      tagAId: num(r.tag_a_id),
      tagA: str(r.tag_a),
      countA,
      tagBId: num(r.tag_b_id),
      tagB: str(r.tag_b),
      countB,
      both,
      jaccard,
      lift,
      pmi,
      pAGivenB: countB > 0 ? both / countB : 0,
      pBGivenA: countA > 0 ? both / countA : 0,
    };
  });

  const sortKey = (p: TagPairRow): number => {
    if (metric === "count") return p.both;
    if (metric === "lift") return p.lift;
    if (metric === "pmi") return p.pmi;
    return p.jaccard;
  };
  pairs.sort((a, b) => sortKey(b) - sortKey(a) || b.both - a.both);

  const twins = [...pairs]
    .filter((p) => p.jaccard >= 0.85)
    .sort((a, b) => b.jaccard - a.jaccard)
    .slice(0, 40);

  const implications = [...pairs]
    .filter((p) => {
      const hi = Math.max(p.pAGivenB, p.pBGivenA);
      const lo = Math.min(p.pAGivenB, p.pBGivenA);
      return hi >= 0.9 && lo < 0.7 && p.both >= 10;
    })
    .sort(
      (a, b) =>
        Math.max(b.pAGivenB, b.pBGivenA) - Math.max(a.pAGivenB, a.pBGivenA) || b.both - a.both,
    )
    .slice(0, 40);

  return {
    minCount,
    metric,
    doneTotal,
    pairs: pairs.slice(0, limit),
    twins,
    implications,
  };
}

export type CategoryProfile = {
  id: number;
  name: string;
  ignored: boolean;
  domainCount: number;
  tags: {
    id: number;
    name: string;
    count: number;
    share: number;
    lift: number;
    exclusive: boolean;
  }[];
};

export async function analyzeCategoryProfile(categoryId: number): Promise<CategoryProfile | null> {
  const [cat] = await db.select().from(categories).where(eq(categories.id, categoryId)).limit(1);
  if (!cat) return null;

  const result = await db.execute(sql`
    WITH cat_tags AS (
      SELECT t.id, t.name, t.domain_count AS global_count, count(*)::int AS n
      FROM domains d
      INNER JOIN domain_tags dt ON dt.domain_id = d.id
      INNER JOIN tags t ON t.id = dt.tag_id
      WHERE d.status = 'done' AND d.category_id = ${categoryId}
      GROUP BY t.id, t.name, t.domain_count
    ),
    done_n AS (
      SELECT count(*)::int AS n FROM domains WHERE status = 'done'
    )
    SELECT
      ct.id,
      ct.name,
      ct.n,
      ct.global_count,
      (SELECT n FROM done_n) AS done_total,
      (
        SELECT count(DISTINCT d.category_id)::int
        FROM domain_tags dt
        INNER JOIN domains d ON d.id = dt.domain_id AND d.status = 'done'
        WHERE dt.tag_id = ct.id AND d.category_id IS NOT NULL
      ) AS category_span
    FROM cat_tags ct
    ORDER BY ct.n DESC
    LIMIT 40
  `);

  const doneInCat = cat.domainCount || 1;
  return {
    id: cat.id,
    name: cat.name,
    ignored: cat.ignored,
    domainCount: cat.domainCount,
    tags: (
      result.rows as {
        id: number;
        name: string;
        n: number;
        global_count: number;
        done_total: number;
        category_span: number;
      }[]
    ).map((r) => {
      const count = num(r.n);
      const global = num(r.global_count);
      const doneTotal = num(r.done_total) || 1;
      const expected = (doneInCat * global) / doneTotal;
      return {
        id: num(r.id),
        name: str(r.name),
        count,
        share: count / doneInCat,
        lift: expected > 0 ? count / expected : 0,
        exclusive: num(r.category_span) <= 1,
      };
    }),
  };
}

export type TagProfile = {
  id: number;
  name: string;
  ignored: boolean;
  domainCount: number;
  doneTotal: number;
  corpusShare: number;
  categorySpan: number;
  categories: {
    id: number;
    name: string;
    count: number;
    share: number;
    lift: number;
    dominant: boolean;
  }[];
  coTags: {
    id: number;
    name: string;
    count: number;
    jaccard: number;
    lift: number;
    pOtherGivenThis: number;
  }[];
  languages: { language: string; count: number }[];
  countries: { country: string; count: number }[];
  samples: {
    id: number;
    host: string;
    name: string | null;
    summary: string | null;
    categoryName: string | null;
  }[];
};

export async function analyzeTagProfile(tagId: number): Promise<TagProfile | null> {
  const [tag] = await db.select().from(tags).where(eq(tags.id, tagId)).limit(1);
  if (!tag) return null;

  const tagSize = tag.domainCount || 1;

  const [catsResult, coTagsResult, langsResult, countriesResult, spanResult, doneResult, samples] =
    await Promise.all([
      db.execute(sql`
        SELECT
          c.id,
          c.name,
          c.domain_count AS cat_global,
          count(*)::int AS n
        FROM domain_tags dt
        INNER JOIN domains d ON d.id = dt.domain_id AND d.status = 'done'
        INNER JOIN categories c ON c.id = d.category_id
        WHERE dt.tag_id = ${tagId}
        GROUP BY c.id, c.name, c.domain_count
        ORDER BY n DESC
        LIMIT 40
      `),
      db.execute(sql`
        SELECT
          t.id,
          t.name,
          t.domain_count AS other_count,
          count(*)::int AS both_n
        FROM domain_tags a
        INNER JOIN domain_tags b
          ON b.domain_id = a.domain_id AND b.tag_id <> a.tag_id
        INNER JOIN domains d ON d.id = a.domain_id AND d.status = 'done'
        INNER JOIN tags t ON t.id = b.tag_id
        WHERE a.tag_id = ${tagId}
        GROUP BY t.id, t.name, t.domain_count
        ORDER BY both_n DESC
        LIMIT 40
      `),
      db.execute(sql`
        SELECT coalesce(d.language, '') AS language, count(*)::int AS n
        FROM domain_tags dt
        INNER JOIN domains d ON d.id = dt.domain_id AND d.status = 'done'
        WHERE dt.tag_id = ${tagId}
        GROUP BY d.language
        ORDER BY n DESC
        LIMIT 12
      `),
      db.execute(sql`
        SELECT coalesce(d.country, '') AS country, count(*)::int AS n
        FROM domain_tags dt
        INNER JOIN domains d ON d.id = dt.domain_id AND d.status = 'done'
        WHERE dt.tag_id = ${tagId}
        GROUP BY d.country
        ORDER BY n DESC
        LIMIT 12
      `),
      db.execute(sql`
        SELECT count(DISTINCT d.category_id)::int AS n
        FROM domain_tags dt
        INNER JOIN domains d ON d.id = dt.domain_id AND d.status = 'done'
        WHERE dt.tag_id = ${tagId} AND d.category_id IS NOT NULL
      `),
      db.execute(sql`
        SELECT count(*)::int AS n FROM domains WHERE status = 'done'
      `),
      db.execute(sql`
        SELECT
          d.id,
          d.host,
          d.name,
          d.summary,
          c.name AS category_name
        FROM domain_tags dt
        INNER JOIN domains d ON d.id = dt.domain_id AND d.status = 'done'
        LEFT JOIN categories c ON c.id = d.category_id
        WHERE dt.tag_id = ${tagId}
        ORDER BY d.processed_at DESC NULLS LAST
        LIMIT 10
      `),
    ]);

  const doneTotal = num((doneResult.rows[0] as { n?: number } | undefined)?.n) || 1;
  const categorySpan = num((spanResult.rows[0] as { n?: number } | undefined)?.n);

  const categoriesOut = (
    catsResult.rows as {
      id: number;
      name: string;
      cat_global: number;
      n: number;
    }[]
  ).map((r) => {
    const count = num(r.n);
    const catGlobal = num(r.cat_global);
    const expected = (tagSize * catGlobal) / doneTotal;
    const share = count / tagSize;
    return {
      id: num(r.id),
      name: str(r.name),
      count,
      share,
      lift: expected > 0 ? count / expected : 0,
      dominant: share >= 0.5,
    };
  });

  const coTags = (
    coTagsResult.rows as {
      id: number;
      name: string;
      other_count: number;
      both_n: number;
    }[]
  ).map((r) => {
    const both = num(r.both_n);
    const otherCount = num(r.other_count) || 1;
    const union = tagSize + otherCount - both;
    const expected = (tagSize * otherCount) / doneTotal;
    return {
      id: num(r.id),
      name: str(r.name),
      count: both,
      jaccard: union > 0 ? both / union : 0,
      lift: expected > 0 ? both / expected : 0,
      pOtherGivenThis: both / tagSize,
    };
  });

  return {
    id: tag.id,
    name: tag.name,
    ignored: tag.ignored,
    domainCount: tag.domainCount,
    doneTotal,
    corpusShare: tag.domainCount / doneTotal,
    categorySpan,
    categories: categoriesOut,
    coTags,
    languages: (langsResult.rows as { language: string; n: number }[]).map((r) => ({
      language: str(r.language) || "(null)",
      count: num(r.n),
    })),
    countries: (countriesResult.rows as { country: string; n: number }[]).map((r) => ({
      country: str(r.country) || "(null)",
      count: num(r.n),
    })),
    samples: (
      samples.rows as {
        id: number;
        host: string;
        name: string | null;
        summary: string | null;
        category_name: string | null;
      }[]
    ).map((r) => ({
      id: num(r.id),
      host: str(r.host),
      name: r.name == null ? null : str(r.name),
      summary: r.summary == null ? null : str(r.summary),
      categoryName: r.category_name == null ? null : str(r.category_name),
    })),
  };
}

export type CategorySimilarityRow = {
  categoryAId: number;
  categoryA: string;
  categoryBId: number;
  categoryB: string;
  cosine: number;
  sharedTags: number;
};

export async function analyzeCategorySimilarity(limit = 40): Promise<CategorySimilarityRow[]> {
  const cap = Math.min(Math.max(limit, 5), 100);
  const result = await db.execute(sql`
    WITH cat_tag AS (
      SELECT d.category_id, dt.tag_id, count(*)::float AS w
      FROM domains d
      INNER JOIN domain_tags dt ON dt.domain_id = d.id
      WHERE d.status = 'done' AND d.category_id IS NOT NULL
      GROUP BY d.category_id, dt.tag_id
    ),
    norms AS (
      SELECT category_id, sqrt(sum(w * w)) AS norm
      FROM cat_tag
      GROUP BY category_id
    ),
    pairs AS (
      SELECT
        a.category_id AS a_id,
        b.category_id AS b_id,
        sum(a.w * b.w) AS dot,
        count(*)::int AS shared
      FROM cat_tag a
      INNER JOIN cat_tag b
        ON a.tag_id = b.tag_id AND a.category_id < b.category_id
      GROUP BY a.category_id, b.category_id
    )
    SELECT
      ca.id AS a_id,
      ca.name AS a_name,
      cb.id AS b_id,
      cb.name AS b_name,
      (p.dot / NULLIF(na.norm * nb.norm, 0)) AS cosine,
      p.shared
    FROM pairs p
    INNER JOIN norms na ON na.category_id = p.a_id
    INNER JOIN norms nb ON nb.category_id = p.b_id
    INNER JOIN categories ca ON ca.id = p.a_id
    INNER JOIN categories cb ON cb.id = p.b_id
    WHERE ca.domain_count >= 30 AND cb.domain_count >= 30
    ORDER BY cosine DESC NULLS LAST
    LIMIT ${cap}
  `);

  return (
    result.rows as {
      a_id: number;
      a_name: string;
      b_id: number;
      b_name: string;
      cosine: number;
      shared: number;
    }[]
  ).map((r) => ({
    categoryAId: num(r.a_id),
    categoryA: str(r.a_name),
    categoryBId: num(r.b_id),
    categoryB: str(r.b_name),
    cosine: num(r.cosine),
    sharedTags: num(r.shared),
  }));
}

function tokenSet(name: string): Set<string> {
  return new Set(
    normalizeLabel(name)
      .replace(/-/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

function jaccardTokens(a: string, b: string): number {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

function smashed(name: string): string {
  return normalizeLabel(name).replace(/[-\s]/g, "");
}

export type LexicalCandidate = {
  kind: LabelKind;
  fromId: number;
  from: string;
  fromCount: number;
  toId: number;
  to: string;
  toCount: number;
  reason: string;
  aliasLine: string;
};

export async function analyzeLexicalCandidates(limit = 60): Promise<LexicalCandidate[]> {
  const cap = Math.min(Math.max(limit, 10), 200);
  const [catRows, tagRows] = await Promise.all([
    db
      .select({
        id: categories.id,
        name: categories.name,
        domainCount: categories.domainCount,
      })
      .from(categories)
      .orderBy(desc(categories.domainCount)),
    db
      .select({
        id: tags.id,
        name: tags.name,
        domainCount: tags.domainCount,
      })
      .from(tags)
      .where(sql`${tags.domainCount} >= 5`)
      .orderBy(desc(tags.domainCount))
      .limit(800),
  ]);

  const out: LexicalCandidate[] = [];

  function consider(
    kind: LabelKind,
    a: { id: number; name: string; domainCount: number },
    b: { id: number; name: string; domainCount: number },
    reason: string,
  ) {
    if (a.id === b.id) return;
    const [from, to] =
      a.domainCount <= b.domainCount ? [a, b] : [b, a];
    out.push({
      kind,
      fromId: from.id,
      from: from.name,
      fromCount: from.domainCount,
      toId: to.id,
      to: to.name,
      toCount: to.domainCount,
      reason,
      aliasLine: aliasLine(kind, from.name, to.name),
    });
  }

  for (const kind of ["category", "tag"] as const) {
    const rows = kind === "category" ? catRows : tagRows;
    const bySmash = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = smashed(row.name);
      if (key.length < 4) continue;
      const list = bySmash.get(key) ?? [];
      list.push(row);
      bySmash.set(key, list);
    }
    for (const group of bySmash.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => b.domainCount - a.domainCount);
      for (let i = 1; i < group.length; i++) {
        consider(kind, group[i]!, group[0]!, "same letters ignoring hyphen/space");
      }
    }

    for (let i = 0; i < rows.length; i++) {
      const a = rows[i]!;
      for (let j = i + 1; j < Math.min(rows.length, i + 80); j++) {
        const b = rows[j]!;
        if (smashed(a.name) === smashed(b.name)) continue;
        const jac = jaccardTokens(a.name, b.name);
        if (jac >= 0.75 && a.name !== b.name) {
          consider(kind, a, b, `token overlap ${jac.toFixed(2)}`);
        }
      }
    }
  }

  const seen = new Set<string>();
  const deduped: LexicalCandidate[] = [];
  for (const c of out.sort((a, b) => a.fromCount + a.toCount - (b.fromCount + b.toCount))) {
    const key = `${c.kind}:${c.fromId}:${c.toId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
    if (deduped.length >= cap) break;
  }
  return deduped;
}

export type StewardAnalyze = {
  blocked: {
    apex: string;
    reason: string;
    source: string;
    createdAt: string;
    evidence: unknown;
  }[];
  reviews: {
    apex: string;
    verdict: string;
    reason: string;
    sampleSize: number;
    reviewedAt: string;
    evidence: unknown;
  }[];
  counts: { blocked: number; steward: number; file: number; reviews: number };
};

export async function analyzeSteward(opts?: {
  blockLimit?: number;
  reviewLimit?: number;
  source?: string;
  q?: string;
}): Promise<StewardAnalyze> {
  const blockLimit = Math.min(Math.max(opts?.blockLimit ?? 100, 1), 500);
  const reviewLimit = Math.min(Math.max(opts?.reviewLimit ?? 80, 1), 300);
  const q = (opts?.q ?? "").trim().toLowerCase();
  const source = opts?.source?.trim();

  const conditions = [];
  if (source === "steward" || source === "file") {
    conditions.push(eq(blockedApexes.source, source));
  }
  if (q) {
    conditions.push(sql`${blockedApexes.apex} ILIKE ${"%" + q + "%"}`);
  }

  const blockedQuery = db
    .select({
      apex: blockedApexes.apex,
      reason: blockedApexes.reason,
      source: blockedApexes.source,
      createdAt: blockedApexes.createdAt,
      evidence: blockedApexes.evidence,
    })
    .from(blockedApexes)
    .orderBy(desc(blockedApexes.createdAt))
    .limit(blockLimit);

  const blocked =
    conditions.length > 0
      ? await blockedQuery.where(and(...conditions))
      : await blockedQuery;

  const [reviews, countsResult, reviewCount] = await Promise.all([
    db
      .select({
        apex: apexReviews.apex,
        verdict: apexReviews.verdict,
        reason: apexReviews.reason,
        sampleSize: apexReviews.sampleSize,
        reviewedAt: apexReviews.reviewedAt,
        evidence: apexReviews.evidence,
      })
      .from(apexReviews)
      .orderBy(desc(apexReviews.reviewedAt))
      .limit(reviewLimit),
    db.execute(sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE source = 'steward')::int AS steward,
        count(*) FILTER (WHERE source = 'file')::int AS file
      FROM blocked_apexes
    `),
    db.execute(sql`SELECT count(*)::int AS n FROM apex_reviews`),
  ]);

  const c = (countsResult.rows[0] ?? {}) as Record<string, unknown>;

  return {
    blocked: blocked.map((r) => ({
      apex: r.apex,
      reason: r.reason,
      source: r.source,
      createdAt: r.createdAt.toISOString(),
      evidence: r.evidence,
    })),
    reviews: reviews.map((r) => ({
      apex: r.apex,
      verdict: r.verdict,
      reason: r.reason,
      sampleSize: r.sampleSize,
      reviewedAt: r.reviewedAt.toISOString(),
      evidence: r.evidence,
    })),
    counts: {
      blocked: num(c.total),
      steward: num(c.steward),
      file: num(c.file),
      reviews: num((reviewCount.rows[0] as { n?: number } | undefined)?.n),
    },
  };
}
