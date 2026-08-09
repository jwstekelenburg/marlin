import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { fetchStats, searchDomains, type DomainHit, type Label, type Stats } from "./api";
import { Dashboard } from "./Dashboard";
import { IgnoreModal } from "./IgnoreModal";
import { Typeahead } from "./Typeahead";

function usePath(): [string, (to: string) => void] {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function go(to: string) {
    if (window.location.pathname === to) return;
    window.history.pushState(null, "", to);
    setPath(to);
  }

  return [path, go];
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
  return (
    <div className={dash ? "page wide" : "page"}>
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
            <button type="button" className={dash ? undefined : "nav-on"} onClick={() => go("/")}>
              Search
            </button>
            <button
              type="button"
              className={dash ? "nav-on" : undefined}
              onClick={() => go("/dashboard")}
            >
              Dashboard
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

function Search({ reloadRef }: { reloadRef: { current: (() => void) | null } }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<Label | null>(null);
  const [tag, setTag] = useState<Label | null>(null);
  const [results, setResults] = useState<DomainHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch(nextQ = q) {
    setLoading(true);
    setError(null);
    try {
      const hits = await searchDomains({
        q: nextQ,
        categoryId: category?.id,
        tagIds: tag ? [tag.id] : [],
      });
      setResults(hits);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  reloadRef.current = () => {
    void runSearch();
  };

  useEffect(() => {
    void runSearch("");
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void runSearch();
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
        <Typeahead kind="categories" label="Category" value={category} onChange={setCategory} />
        <Typeahead kind="tags" label="Tag" value={tag} onChange={setTag} />
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
            <div className="meta">
              {hit.category && <span className="pill">{hit.category.name}</span>}
              {hit.tags.map((t) => (
                <span key={t.id} className="pill faint">
                  {t.name}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ol>

      {!loading && results.length === 0 && (
        <p className="muted empty">No indexed domains match. Ingest a list and run the worker.</p>
      )}
    </>
  );
}

export function App() {
  const [path, go] = usePath();
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
      {path === "/dashboard" ? <Dashboard /> : <Search reloadRef={reloadSearch} />}
      <IgnoreModal
        open={modal}
        onClose={() => {
          setModal(false);
          reloadSearch.current?.();
          void fetchStats().then(setStats).catch(() => undefined);
        }}
      />
    </Shell>
  );
}
