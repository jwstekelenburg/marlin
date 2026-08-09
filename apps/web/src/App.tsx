import { useEffect, useState, type FormEvent } from "react";
import { fetchStats, searchDomains, type DomainHit, type Label, type Stats } from "./api";
import { IgnoreModal } from "./IgnoreModal";
import { Typeahead } from "./Typeahead";

export function App() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<Label | null>(null);
  const [tag, setTag] = useState<Label | null>(null);
  const [results, setResults] = useState<DomainHit[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);

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
      setStats(await fetchStats());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void runSearch("");
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void runSearch();
  }

  return (
    <div className="page">
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
          <button type="button" onClick={() => setModal(true)}>
            Ignore lists
          </button>
        </div>
      </header>

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

      <IgnoreModal
        open={modal}
        onClose={() => {
          setModal(false);
          void runSearch();
        }}
      />
    </div>
  );
}
