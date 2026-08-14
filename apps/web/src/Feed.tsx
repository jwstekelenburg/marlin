import { useEffect, useRef, useState } from "react";
import {
  fetchFeed,
  postFeedEvents,
  type DomainHit,
  type FeedEventKind,
  type GeoOption,
} from "./api";
import { CountryTypeahead } from "./CountryTypeahead";
import { Spinner } from "./Spinner";
import { buildSearchUrl } from "./search-url";

const PAGE_SIZE = 25;

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

function parseFeedCountry(search: string): string | undefined {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = p.get("country")?.trim().toUpperCase();
  return raw || undefined;
}

function feedUrl(country?: string | null): string {
  if (!country?.trim()) return "/feed";
  return `/feed?country=${encodeURIComponent(country.trim().toUpperCase())}`;
}

export function Feed({
  search,
  go,
}: {
  search: string;
  go: (to: string) => void;
}) {
  const countryCode = parseFeedCountry(search);
  const [country, setCountry] = useState<GeoOption | null>(
    countryCode
      ? { code: countryCode, name: countryLabel(countryCode), count: 0 }
      : null,
  );
  const [prompt, setPrompt] = useState("");
  const [results, setResults] = useState<DomainHit[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<{ categories: string[]; tags: string[] }>({
    categories: [],
    tags: [],
  });
  const [votes, setVotes] = useState<Record<string, "up" | "down">>({});
  const seenIds = useRef(new Set<string>());
  const impressed = useRef(new Set<string>());
  const requestId = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const countryRef = useRef(countryCode);

  useEffect(() => {
    setCountry(
      countryCode
        ? { code: countryCode, name: countryLabel(countryCode), count: 0 }
        : null,
    );
  }, [countryCode]);

  async function load(append: boolean, countryFilter: string | undefined) {
    const id = ++requestId.current;
    if (append) {
      setLoadingMore(true);
      loadingMoreRef.current = true;
    } else setLoading(true);
    setError(null);
    try {
      const page = await fetchFeed({
        limit: PAGE_SIZE,
        excludeIds: append ? [...seenIds.current] : [],
        country: countryFilter,
      });
      if (id !== requestId.current) return;
      for (const hit of page.hits) seenIds.current.add(hit.id);
      setPrompt(page.prompt);
      setMissing(page.missing);
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
        loadingMoreRef.current = false;
      }
    }
  }

  useEffect(() => {
    const changed = countryRef.current !== countryCode;
    countryRef.current = countryCode;
    if (changed) {
      seenIds.current = new Set();
      setResults([]);
      setVotes({});
      setHasMore(true);
    }
    void load(false, countryCode);
  }, [countryCode]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loading) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      if (loadingMoreRef.current) return;
      void load(true, countryRef.current);
    });
    io.observe(node);
    return () => io.disconnect();
  }, [hasMore, loading, results.length]);

  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>("[data-feed-id]");
    if (nodes.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const batch: { domainId: string; kind: FeedEventKind }[] = [];
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const domainId = entry.target.getAttribute("data-feed-id");
          if (!domainId || impressed.current.has(domainId) || votes[domainId]) continue;
          impressed.current.add(domainId);
          batch.push({ domainId, kind: "impression" });
        }
        if (batch.length) void postFeedEvents(batch).catch(() => undefined);
      },
      { threshold: 0.55 },
    );
    for (const n of nodes) io.observe(n);
    return () => io.disconnect();
  }, [results, votes]);

  function emit(domainId: string, kind: FeedEventKind) {
    void postFeedEvents([{ domainId, kind }]).catch(() => undefined);
  }

  function vote(domainId: string, kind: "up" | "down") {
    if (votes[domainId] === kind) return;
    setVotes((prev) => ({ ...prev, [domainId]: kind }));
    emit(domainId, kind);
  }

  function onHostClick(domainId: string) {
    emit(domainId, "click");
  }

  function setCountryFilter(next: GeoOption | null) {
    setCountry(next);
    go(feedUrl(next?.code ?? null));
  }

  return (
    <>
      <div className="feed-intro">
        <p className="eyebrow">feed</p>
        {prompt ? <p className="feed-prompt">{prompt}</p> : null}
        <p className="muted">
          Scroll to see more. More / Less steers the river. Clicking a host counts as curiosity and
          won&apos;t show that site again. Country filter is exact ISO and skips sites with no
          country set.
        </p>
      </div>

      <div className="feed-filters">
        <CountryTypeahead value={country} onChange={setCountryFilter} />
      </div>

      {error && <p className="error">{error}</p>}

      {missing.categories.length + missing.tags.length > 0 && (
        <p className="muted">
          Strategy names not in the catalog:{" "}
          {[...missing.categories, ...missing.tags].join(", ")}
        </p>
      )}

      {loading && results.length === 0 && <Spinner label="Loading feed…" />}

      <ol className="results">
        {results.map((hit) => (
          <li key={hit.id} className="card" data-feed-id={hit.id}>
            <div className="card-head">
              <h2>{hit.name || hit.host}</h2>
              <a
                href={`https://${hit.host}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => onHostClick(hit.id)}
              >
                {hit.host}
              </a>
            </div>
            <p>{hit.summary}</p>
            {(hit.language || hit.place || hit.country) && (
              <div className="listing-geo">
                {hit.language && languageLabel(hit.language)}
                {hit.language && (hit.place || hit.country) ? " · " : null}
                {hit.place}
                {hit.place && hit.country ? " · " : null}
                {hit.country && (
                  <button
                    type="button"
                    className="geo-link"
                    onClick={() =>
                      setCountryFilter(
                        countryCode === hit.country
                          ? null
                          : {
                              code: hit.country!,
                              name: countryLabel(hit.country!),
                              count: 0,
                            },
                      )
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
                  className="pill"
                  onClick={() => go(buildSearchUrl({ categoryId: hit.category!.id }))}
                >
                  {hit.category.name}
                </button>
              )}
              {hit.tags.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="pill faint"
                  onClick={() => go(buildSearchUrl({ tagIds: [t.id] }))}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <div className="card-actions">
              <button
                type="button"
                className={votes[hit.id] === "up" ? "on" : undefined}
                aria-pressed={votes[hit.id] === "up"}
                onClick={() => vote(hit.id, "up")}
              >
                More like this
              </button>
              <button
                type="button"
                className={votes[hit.id] === "down" ? "on" : undefined}
                aria-pressed={votes[hit.id] === "down"}
                onClick={() => vote(hit.id, "down")}
              >
                Less like this
              </button>
            </div>
          </li>
        ))}
      </ol>

      <div ref={sentinelRef} className="feed-sentinel" />

      {loadingMore && <Spinner label="Loading more…" />}

      {!loading && !error && !hasMore && (
        <p className="muted empty">
          {results.length === 0
            ? countryCode
              ? `No feed hits for ${countryLabel(countryCode)}. Clear the country filter or try another.`
              : "The river is empty. Edit data/feed-prompt.txt and recompile data/feed-strategy.json."
            : "That's the river for now. Scrolled-past sites can return in about a week; voted or clicked ones will not."}
        </p>
      )}
    </>
  );
}
