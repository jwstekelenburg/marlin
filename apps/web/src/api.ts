export type Label = {
  id: number;
  name: string;
  ignored: boolean;
  domainCount: number;
};

export type DomainHit = {
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

export type GeoOption = {
  code: string;
  name: string;
  count: number;
};

export type CountryOption = GeoOption;
export type LanguageOption = GeoOption;

export type SearchPage = {
  hits: DomainHit[];
  hasMore: boolean;
};

export type Stats = {
  pending: number;
  fetching: number;
  ready: number;
  summarizing: number;
  done: number;
  failed: number;
  skipped: number;
};

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export function searchDomains(params: {
  q: string;
  categoryId?: number;
  tagIds?: number[];
  country?: string;
  language?: string;
  limit?: number;
  offset?: number;
}): Promise<SearchPage> {
  const q = new URLSearchParams();
  if (params.q.trim()) q.set("q", params.q.trim());
  if (params.categoryId) q.set("categoryId", String(params.categoryId));
  if (params.tagIds?.length) q.set("tagIds", params.tagIds.join(","));
  if (params.country?.trim()) q.set("country", params.country.trim());
  if (params.language?.trim()) q.set("language", params.language.trim());
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.offset != null) q.set("offset", String(params.offset));
  return fetch(`/api/search?${q}`).then((r) => json<SearchPage>(r));
}

export function typeaheadCountries(q: string): Promise<GeoOption[]> {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  return fetch(`/api/countries?${params}`).then((r) => json<GeoOption[]>(r));
}

export function typeaheadLanguages(q: string): Promise<GeoOption[]> {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  return fetch(`/api/languages?${params}`).then((r) => json<GeoOption[]>(r));
}

export function labelsByIds(kind: "categories" | "tags", ids: number[]): Promise<Label[]> {
  if (ids.length === 0) return Promise.resolve([]);
  const params = new URLSearchParams();
  params.set("ids", ids.join(","));
  return fetch(`/api/${kind}?${params}`).then((r) => json<Label[]>(r));
}

export function typeahead(kind: "categories" | "tags", q: string): Promise<Label[]> {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  return fetch(`/api/${kind}?${params}`).then((r) => json<Label[]>(r));
}

export function fetchIgnoreOptions(): Promise<{ categories: Label[]; tags: Label[] }> {
  return fetch("/api/ignore-options").then((r) => json(r));
}

export function setIgnored(
  kind: "categories" | "tags",
  id: number,
  ignored: boolean,
): Promise<Label> {
  return fetch(`/api/${kind}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ignored }),
  }).then((r) => json<Label>(r));
}

export function fetchStats(): Promise<Stats> {
  return fetch("/api/stats").then((r) => json<Stats>(r));
}

export type DashboardData = {
  stats: Stats;
  throughput: { minute: number; fifteen: number; hour: number };
  pendingByPriority: { priority: number; count: number }[];
  readyByPriority: { priority: number; count: number }[];
  pendingBySource: { source: string; count: number }[];
  categories: (Label & { crawlPriority: number })[];
  tags: Label[];
  recentDone: {
    id: number;
    host: string;
    name: string | null;
    summary: string | null;
    categoryName: string | null;
    processedAt: string | null;
  }[];
  recentFailed: {
    id: number;
    host: string;
    error: string | null;
    processedAt: string | null;
  }[];
  failedByError: { error: string; count: number }[];
  queueAge: {
    oldestFetching: string | null;
    oldestReady: string | null;
    oldestSummarizing: string | null;
  };
  staging: { status: string; rows: number; withText: number; textBytes: number }[];
  pg: {
    databaseBytes: number;
    cacheHitRatio: number | null;
    tempBytes: number;
    deadlocks: number;
    connections: { total: number; active: number; idle: number; max: number };
    tables: {
      name: string;
      totalBytes: number;
      heapBytes: number;
      indexBytes: number;
      toastBytes: number;
      liveRows: number;
      deadRows: number;
      lastVacuum: string | null;
      lastAnalyze: string | null;
    }[];
    indexes: { name: string; table: string; bytes: number; scans: number }[];
  };
  crawlPriority: {
    seed: number;
    default: number;
    categories: Record<string, number>;
  };
  fetchMaxReady: number;
  blockedApexes: {
    total: number;
    steward: number;
    file: number;
    recent: {
      apex: string;
      reason: string;
      source: string;
      createdAt: string;
    }[];
  };
};

export function fetchDashboard(): Promise<DashboardData> {
  return fetch("/api/dashboard").then((r) => json<DashboardData>(r));
}

export type WorkersData = {
  stats: Stats;
  throughput: { minute: number; fifteen: number; hour: number };
  failedThroughput: { minute: number; fifteen: number };
  doneByCategory: { name: string; minute: number; fifteen: number }[];
  doneByLanguage: { language: string; minute: number; fifteen: number }[];
  noLmSkips: {
    empty: { minute: number; fifteen: number };
    parked: { minute: number; fifteen: number };
  };
  failedByError: { error: string; count: number }[];
  pendingByPriority: { priority: number; count: number }[];
  readyByPriority: { priority: number; count: number }[];
  pendingBySource: { source: string; count: number }[];
  recentDone: {
    id: number;
    host: string;
    name: string | null;
    categoryName: string | null;
    processedAt: string | null;
  }[];
  queueAge: {
    oldestFetching: string | null;
    oldestReady: string | null;
    oldestSummarizing: string | null;
  };
  fetchMaxReady: number;
  steward: {
    blocks: { fifteen: number; hour: number };
    keeps: { fifteen: number; hour: number };
    recentBlocks: {
      apex: string;
      reason: string;
      source: string;
      createdAt: string;
    }[];
    recentReviews: {
      apex: string;
      verdict: string;
      reason: string;
      sampleSize: number;
      reviewedAt: string;
    }[];
    candidates: {
      apex: string;
      hosts: number;
      done: number;
      junkDone: number;
      spamLangDone: number;
      labeledLang: number;
      hotelName: boolean;
    }[];
  };
};

export function fetchWorkers(): Promise<WorkersData> {
  return fetch("/api/workers").then((r) => json<WorkersData>(r));
}

export type AnalyzeOverviewData = {
  stats: Stats;
  nullRates: {
    done: number;
    languageNull: number;
    countryNull: number;
    placeNull: number;
  };
  sourceMix: { source: string; count: number }[];
  topCategories: Label[];
  topTags: Label[];
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

export function fetchAnalyzeOverview(): Promise<AnalyzeOverviewData> {
  return fetch("/api/analyze").then((r) => json(r));
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

export type PlatformsData = {
  cap: number;
  note: string;
  minSubdomains: number;
  totalMatching: number;
  limit: number;
  rows: PlatformRow[];
  sourceMix: { source: string; count: number }[];
};

export function fetchAnalyzePlatforms(params?: {
  q?: string;
  limit?: number;
  minSubdomains?: number;
}): Promise<PlatformsData> {
  const q = new URLSearchParams();
  if (params?.q?.trim()) q.set("q", params.q.trim());
  if (params?.limit != null) q.set("limit", String(params.limit));
  if (params?.minSubdomains != null) q.set("minSubdomains", String(params.minSubdomains));
  const qs = q.toString();
  return fetch(`/api/analyze/platforms${qs ? `?${qs}` : ""}`).then((r) => json(r));
}

export type StewardEvidence = {
  hosts?: number;
  done?: number;
  junkDone?: number;
  spamLangDone?: number;
  hotelName?: boolean;
  sampleHosts?: string[];
};

export type PlatformDetailData = {
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
  review: {
    verdict: string;
    reason: string;
    sampleSize: number;
    reviewedAt: string;
    evidence: StewardEvidence | null;
  } | null;
  reviewGap: string | null;
};

export function fetchAnalyzePlatformDetail(apex: string): Promise<PlatformDetailData> {
  return fetch(`/api/analyze/platforms/${encodeURIComponent(apex)}`).then((r) =>
    json(r),
  );
}

export type LabelsOverviewData = {
  categories: Label[];
  tags: Label[];
  languages: { language: string; count: number }[];
  countries: { country: string; count: number }[];
};

export function fetchAnalyzeLabels(): Promise<LabelsOverviewData> {
  return fetch("/api/analyze/labels").then((r) => json(r));
}

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

export type TagPairsData = {
  minCount: number;
  metric: string;
  doneTotal: number;
  pairs: TagPairRow[];
  twins: TagPairRow[];
  implications: TagPairRow[];
};

export function fetchAnalyzeTagPairs(params?: {
  minCount?: number;
  metric?: string;
  limit?: number;
}): Promise<TagPairsData> {
  const q = new URLSearchParams();
  if (params?.minCount != null) q.set("minCount", String(params.minCount));
  if (params?.metric) q.set("metric", params.metric);
  if (params?.limit != null) q.set("limit", String(params.limit));
  const qs = q.toString();
  return fetch(`/api/analyze/labels/tag-pairs${qs ? `?${qs}` : ""}`).then((r) => json(r));
}

export type CategoryProfileData = {
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

export function fetchAnalyzeCategoryProfile(id: number): Promise<CategoryProfileData> {
  return fetch(`/api/analyze/labels/categories/${id}`).then((r) => json(r));
}

export type TagProfileData = {
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

export function fetchAnalyzeTagProfile(id: number): Promise<TagProfileData> {
  return fetch(`/api/analyze/labels/tags/${id}`).then((r) => json(r));
}

export type CategorySimilarityRow = {
  categoryAId: number;
  categoryA: string;
  categoryBId: number;
  categoryB: string;
  cosine: number;
  sharedTags: number;
};

export function fetchAnalyzeCategorySimilarity(): Promise<CategorySimilarityRow[]> {
  return fetch("/api/analyze/labels/category-similarity").then((r) => json(r));
}

export type LexicalCandidate = {
  kind: "tag" | "category";
  fromId: number;
  from: string;
  fromCount: number;
  toId: number;
  to: string;
  toCount: number;
  reason: string;
  aliasLine: string;
};

export function fetchAnalyzeLexical(): Promise<LexicalCandidate[]> {
  return fetch("/api/analyze/labels/lexical").then((r) => json(r));
}

export type MergePlan = {
  kind: "tag" | "category";
  from: string;
  to: string;
  action: string;
  fromCount: number;
  toCount: number;
  ignoreNote: string;
};

export function mergeLabels(body: {
  kind: "tag" | "category";
  from: string;
  to: string;
  apply?: boolean;
}): Promise<{ applied: boolean; count?: number; plan: MergePlan }> {
  return fetch("/api/analyze/labels/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json(r));
}

export type StewardAnalyzeData = {
  blocked: {
    apex: string;
    reason: string;
    source: string;
    createdAt: string;
    evidence: StewardEvidence | null;
  }[];
  reviews: {
    apex: string;
    verdict: string;
    reason: string;
    sampleSize: number;
    reviewedAt: string;
    evidence: StewardEvidence | null;
  }[];
  candidates: {
    apex: string;
    hosts: number;
    done: number;
    junkDone: number;
    spamLangDone: number;
    labeledLang: number;
    hotelName: boolean;
  }[];
  counts: { blocked: number; steward: number; file: number; reviews: number };
};

export function fetchAnalyzeSteward(params?: {
  source?: string;
  q?: string;
}): Promise<StewardAnalyzeData> {
  const q = new URLSearchParams();
  if (params?.source) q.set("source", params.source);
  if (params?.q?.trim()) q.set("q", params.q.trim());
  const qs = q.toString();
  return fetch(`/api/analyze/steward${qs ? `?${qs}` : ""}`).then((r) => json(r));
}

export function unblockApex(apex: string): Promise<{ ok: boolean; apex: string }> {
  return fetch(`/api/analyze/steward/blocks/${encodeURIComponent(apex)}`, {
    method: "DELETE",
  }).then((r) => json(r));
}

export function blockApexManual(body: {
  apex: string;
  reason?: string;
}): Promise<{ ok: boolean; apex: string; dropped: number }> {
  return fetch("/api/analyze/steward/blocks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json(r));
}
