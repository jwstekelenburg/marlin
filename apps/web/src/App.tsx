import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  fetchStats,
  labelsByIds,
  searchDomains,
  type DomainHit,
  type GeoOption,
  type Label,
  type Stats,
} from "./api";
import { CountryTypeahead, LanguageTypeahead } from "./CountryTypeahead";
import { Dashboard } from "./Dashboard";
import { IgnoreModal } from "./IgnoreModal";
import { Typeahead } from "./Typeahead";
import { Workers } from "./Workers";
import { buildSearchUrl, parseSearchUrl } from "./search-url";

const PAGE_SIZE = 25;

function useLocation(): [string, string, (to: string) => void] {
  const [path, setPath] = useState(() => window.location.pathname);
  const [search, setSearch] = useState(() => window.location.search);

  useEffect(() => {
    const onPop = () => {
      setPath(window.location.pathname);
      setSearch(window.location.search);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function go(to: string) {
    const url = new URL(to, window.location.origin);
    const next = url.pathname + url.search;
    const cur = window.location.pathname + window.location.search;
    if (next === cur) return;
    window.history.pushState(null, "", next);
    setPath(url.pathname);
    setSearch(url.search);
  }

  return [path, search, go];
}

function Shell({
  path,
  go,
  stats,
  onIgnore,
  children,
}: {
  path: string;
  go: (to: string) => void;
  stats: Stats | null;
  onIgnore: () => void;
  children: ReactNode;
}) {
  const dash = path === "/dashboard";
  const workers = path === "/workers";
  const wide = dash || workers;
  return (
    <div className={wide ? "page wide" : "page"}>
      <header className="top">
        <div>
          <p className="eyebrow">personal index</p>
          <h1>Marlin</h1>
        </div>
        <div className="top-actions">
          {stats && (
            <p className="stats">
              <span>{stats.done} done</span>
              <span>{stats.pending + stats.fetching} fetch</span>
              <span>{stats.ready + stats.summarizing} lm</span>
              <span>{stats.failed} failed</span>
              <span>{stats.skipped} skipped</span>
            </p>
          )}
          <div className="nav">
            <button
              type="button"
              className={!dash && !workers ? "nav-on" : undefined}
              onClick={() => go("/")}
            >
              Search
            </button>
            <button
              type="button"
              className={dash ? "nav-on" : undefined}
              onClick={() => go("/dashboard")}
            >
              Dashboard
            </button>
            <button
              type="button"
              className={workers ? "nav-on" : undefined}
              onClick={() => go("/workers")}
            >
              Workers
            </button>
            <button type="button" onClick={onIgnore}>
              Ignore lists
            </button>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}

function languageLabel(code: string): string {
  if (code === "mul") return "Multiple languages";
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function countryLabel(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function geoOption(code: string, kind: "country" | "language"): GeoOption {
  return {
    code,
    name: kind === "country" ? countryLabel(code) : languageLabel(code),
    count: 0,
  };
}

function Search({
  search,
  go,
  reloadRef,
}: {
  search: string;
  go: (to: string) => void;
  reloadRef: { current: (() => void) | null };
}) {
  const url = parseSearchUrl(search);
  const [q, setQ] = useState(url.q);
  const [category, setCategory] = useState<Label[]>([]);
  const [tags, setTags] = useState<Label[]>([]);
  const [country, setCountry] = useState<GeoOption | null>(
    url.country ? geoOption(url.country, "country") : null,
  );
  const [language, setLanguage] = useState<GeoOption | null>(
    url.language ? geoOption(url.language, "language") : null,
  );
  const [results, setResults] = useState<DomainHit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const next = parseSearchUrl(search);
    setQ(next.q);
    setCountry(next.country ? geoOption(next.country, "country") : null);
    setLanguage(next.language ? geoOption(next.language, "language") : null);

    let cancelled = false;
    if (next.categoryId) {
      void labelsByIds("categories", [next.categoryId]).then((rows) => {
        if (!cancelled) {
          setCategory(
            rows.length
              ? rows
              : [{ id: next.categoryId!, name: `#${next.categoryId}`, ignored: false, domainCount: 0 }],
          );
        }
      });
    } else {
      setCategory([]);
    }
    if (next.tagIds.length) {
      void labelsByIds("tags", next.tagIds).then((rows) => {
        if (!cancelled) {
          const byId = new Map(rows.map((r) => [r.id, r]));
          setTags(
            next.tagIds.map(
              (id) => byId.get(id) ?? { id, name: `#${id}`, ignored: false, domainCount: 0 },
            ),
          );
        }
      });
    } else {
      setTags([]);
    }
    return () => {
      cancelled = true;
    };
  }, [search]);

  async function runSearch(offset: number, append: boolean) {
    const id = ++requestId.current;
    const u = parseSearchUrl(search);
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const page = await searchDomains({
        q: u.q,
        categoryId: u.categoryId,
        tagIds: u.tagIds,
        country: u.country,
        language: u.language,
        limit: PAGE_SIZE,
        offset,
      });
      if (id !== requestId.current) return;
      setResults((prev) => (append ? [...prev, ...page.hits] : page.hits));
      setHasMore(page.hasMore);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : String(err));
      if (!append) setResults([]);
      setHasMore(false);
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }

  reloadRef.current = () => {
    void runSearch(0, false);
  };

  useEffect(() => {
    void runSearch(0, false);
  }, [search]);

  function apply(patch: {
    q?: string;
    categoryId?: number | null;
    tagIds?: number[];
    country?: string | null;
    language?: string | null;
  }) {
    const current = parseSearchUrl(search);
    const nextQ = patch.q !== undefined ? patch.q : q;
    const nextCategory =
      patch.categoryId === undefined ? current.categoryId : (patch.categoryId ?? undefined);
    const nextTags = patch.tagIds ?? current.tagIds;
    const nextCountry =
      patch.country === undefined ? current.country : (patch.country ?? undefined);
    const nextLanguage =
      patch.language === undefined ? current.language : (patch.language ?? undefined);
    go(
      buildSearchUrl({
        q: nextQ,
        categoryId: nextCategory,
        tagIds: nextTags,
        country: nextCountry,
        language: nextLanguage,
      }),
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const current = parseSearchUrl(search);
    const nextUrl = buildSearchUrl({
      q,
      categoryId: current.categoryId,
      tagIds: current.tagIds,
      country: current.country,
      language: current.language,
    });
    const cur = window.location.pathname + window.location.search;
    if (nextUrl === cur) {
      void runSearch(0, false);
      return;
    }
    apply({ q });
  }

  function toggleCategory(label: { id: number; name: string }) {
    const current = parseSearchUrl(search);
    apply({
      q,
      categoryId: current.categoryId === label.id ? null : label.id,
    });
    setCategory(
      current.categoryId === label.id
        ? []
        : [{ id: label.id, name: label.name, ignored: false, domainCount: 0 }],
    );
  }

  function toggleTag(label: { id: number; name: string }) {
    const current = parseSearchUrl(search);
    const has = current.tagIds.includes(label.id);
    const nextIds = has
      ? current.tagIds.filter((id) => id !== label.id)
      : [...current.tagIds, label.id];
    apply({ q, tagIds: nextIds });
    setTags((prev) => {
      if (has) return prev.filter((t) => t.id !== label.id);
      if (prev.some((t) => t.id === label.id)) return prev;
      return [...prev, { id: label.id, name: label.name, ignored: false, domainCount: 0 }];
    });
  }

  return (
    <>
      <form className="search" onSubmit={onSubmit}>
        <label className="query">
          <span>Summary</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Fuzzy search summaries…"
            autoFocus
          />
        </label>
        <Typeahead
          kind="categories"
          label="Category"
          values={category}
          onChange={(vals) => {
            setCategory(vals);
            apply({ q, categoryId: vals[0]?.id ?? null });
          }}
          max={1}
        />
        <Typeahead
          kind="tags"
          label="Tags"
          values={tags}
          onChange={(vals) => {
            setTags(vals);
            apply({ q, tagIds: vals.map((t) => t.id) });
          }}
        />
        <LanguageTypeahead
          value={language}
          onChange={(val) => {
            setLanguage(val);
            apply({ q, language: val?.code ?? null });
          }}
        />
        <CountryTypeahead
          value={country}
          onChange={(val) => {
            setCountry(val);
            apply({ q, country: val?.code ?? null });
          }}
        />
        <button type="submit" className="primary" disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      <ol className="results">
        {results.map((hit) => (
          <li key={hit.id} className="card">
            <div className="card-head">
              <h2>{hit.name || hit.host}</h2>
              <a href={`https://${hit.host}`} target="_blank" rel="noreferrer">
                {hit.host}
              </a>
            </div>
            <p>{hit.summary}</p>
            {(hit.language || hit.place || hit.country) && (
              <div className="listing-geo">
                {hit.language && (
                  <button
                    type="button"
                    className="geo-link"
                    onClick={() =>
                      apply({
                        q,
                        language:
                          parseSearchUrl(search).language === hit.language ? null : hit.language,
                      })
                    }
                  >
                    {languageLabel(hit.language)}
                  </button>
                )}
                {hit.language && (hit.place || hit.country) ? " · " : null}
                {hit.place && (
                  <button type="button" className="geo-link" onClick={() => apply({ q: hit.place! })}>
                    {hit.place}
                  </button>
                )}
                {hit.place && hit.country ? " · " : null}
                {hit.country && (
                  <button
                    type="button"
                    className="geo-link"
                    onClick={() =>
                      apply({
                        q,
                        country: parseSearchUrl(search).country === hit.country ? null : hit.country,
                      })
                    }
                  >
                    {countryLabel(hit.country)}
                  </button>
                )}
              </div>
            )}
            <div className="meta">
              {hit.category && (
                <button
                  type="button"
                  className={
                    parseSearchUrl(search).categoryId === hit.category.id ? "pill on" : "pill"
                  }
                  onClick={() => toggleCategory(hit.category!)}
                >
                  {hit.category.name}
                </button>
              )}
              {hit.tags.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={
                    parseSearchUrl(search).tagIds.includes(t.id) ? "pill faint on" : "pill faint"
                  }
                  onClick={() => toggleTag(t)}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>

      {hasMore && (
        <div className="load-more">
          <button
            type="button"
            disabled={loading || loadingMore}
            onClick={() => void runSearch(results.length, true)}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}

      {!loading && results.length === 0 && (
        <p className="muted empty">No indexed domains match. Ingest a list and run the worker.</p>
      )}
    </>
  );
}

export function App() {
  const [path, search, go] = useLocation();
  const [stats, setStats] = useState<Stats | null>(null);
  const [modal, setModal] = useState(false);
  const reloadSearch = useRef<(() => void) | null>(null);

  useEffect(() => {
    void fetchStats()
      .then(setStats)
      .catch(() => setStats(null));
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetchStats()
        .then(setStats)
        .catch(() => undefined);
    }, 8000);
    return () => clearInterval(id);
  }, []);

  return (
    <Shell path={path} go={go} stats={stats} onIgnore={() => setModal(true)}>
      {path === "/dashboard" ? (
        <Dashboard go={go} />
      ) : path === "/workers" ? (
        <Workers />
      ) : (
        <Search search={search} go={go} reloadRef={reloadSearch} />
      )}
      <IgnoreModal
        open={modal}
        onClose={() => {
          setModal(false);
          reloadSearch.current?.();
          void fetchStats()
            .then(setStats)
            .catch(() => undefined);
        }}
      />
    </Shell>
  );
}
