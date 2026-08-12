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
