import { useCallback, useEffect, useId, useRef, useState, type UIEvent } from "react";
import { fetchIgnoreOptions, setIgnored, type Label } from "./api";
import { Spinner } from "./Spinner";

type Props = {
  open: boolean;
  onClose: () => void;
};

const PAGE_SIZE = 100;
const FILTER_DEBOUNCE_MS = 250;

type Kind = "categories" | "tags";

type ListState = {
  rows: Label[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
};

const emptyList = (): ListState => ({
  rows: [],
  total: 0,
  hasMore: false,
  loading: false,
  loadingMore: false,
});

function ToggleList({
  title,
  state,
  filtering,
  kind,
  onToggle,
  onLoadMore,
}: {
  title: string;
  state: ListState;
  filtering: boolean;
  kind: Kind;
  onToggle: (kind: Kind, id: number, ignored: boolean) => void;
  onLoadMore: () => void;
}) {
  const { rows, total, hasMore, loading, loadingMore } = state;
  const listRef = useRef<HTMLUListElement>(null);
  const count =
    filtering || rows.length < total ? `${rows.length}/${total}` : String(total);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !hasMore || loading || loadingMore) return;
    if (el.scrollHeight <= el.clientHeight + 8) onLoadMore();
  }, [rows.length, hasMore, loading, loadingMore, onLoadMore]);

  function onScroll(e: UIEvent<HTMLUListElement>) {
    if (!hasMore || loading || loadingMore) return;
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 64) {
      onLoadMore();
    }
  }

  return (
    <section>
      <h3>
        {title} <em>{loading && rows.length === 0 ? "…" : count}</em>
      </h3>
      {loading && rows.length === 0 ? (
        <Spinner label="Loading…" />
      ) : total === 0 ? (
        <p className="muted">
          {filtering ? "No matches." : "None yet — run the worker first."}
        </p>
      ) : (
        <ul ref={listRef} className="ignore-list" onScroll={onScroll}>
          {rows.map((row) => (
            <li key={row.id}>
              <label>
                <input
                  type="checkbox"
                  checked={row.ignored}
                  onChange={(e) => onToggle(kind, row.id, e.target.checked)}
                />
                <span>{row.name}</span>
                <em>{row.domainCount}</em>
              </label>
            </li>
          ))}
          {loadingMore && (
            <li className="ignore-list-status">
              <Spinner label="Loading more…" />
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function useIgnoreList(
  kind: Kind,
  q: string,
  open: boolean,
  onError: (message: string | null) => void,
) {
  const [state, setState] = useState<ListState>(emptyList);
  const reqId = useRef(0);
  const loadingMoreLock = useRef(false);
  const qRef = useRef(q);
  qRef.current = q;

  const load = useCallback(
    async (offset: number, append: boolean) => {
      const id = ++reqId.current;
      if (append) loadingMoreLock.current = true;
      setState((prev) => ({
        ...prev,
        loading: !append,
        loadingMore: append,
        ...(append ? {} : { rows: [], total: 0, hasMore: false }),
      }));
      try {
        const page = await fetchIgnoreOptions({
          kind,
          q: qRef.current || undefined,
          limit: PAGE_SIZE,
          offset,
        });
        if (id !== reqId.current) return;
        setState((prev) => ({
          rows: append ? [...prev.rows, ...page.rows] : page.rows,
          total: page.total,
          hasMore: page.hasMore,
          loading: false,
          loadingMore: false,
        }));
        onError(null);
      } catch (err) {
        if (id !== reqId.current) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          loadingMore: false,
          ...(append ? {} : { rows: [], total: 0, hasMore: false }),
        }));
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        if (append) loadingMoreLock.current = false;
      }
    },
    [kind, onError],
  );

  useEffect(() => {
    if (!open) {
      reqId.current += 1;
      loadingMoreLock.current = false;
      setState(emptyList());
      return;
    }
    void load(0, false);
  }, [open, q, load]);

  const loadMore = useCallback(() => {
    if (loadingMoreLock.current) return;
    setState((prev) => {
      if (!prev.hasMore || prev.loading || prev.loadingMore) return prev;
      loadingMoreLock.current = true;
      void load(prev.rows.length, true);
      return { ...prev, loadingMore: true };
    });
  }, [load]);

  const patchRow = useCallback((id: number, updated: Label) => {
    setState((prev) => ({
      ...prev,
      rows: prev.rows.map((r) => (r.id === id ? updated : r)),
    }));
  }, []);

  return { state, loadMore, patchRow };
}

export function IgnoreModal({ open, onClose }: Props) {
  const filterId = useId();
  const [filter, setFilter] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const onError = useCallback((message: string | null) => setError(message), []);

  useEffect(() => {
    if (!open) {
      setFilter("");
      setDebouncedQ("");
      setError(null);
      return;
    }
    const id = window.setTimeout(() => setDebouncedQ(filter.trim()), FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [filter, open]);

  const categories = useIgnoreList("categories", debouncedQ, open, onError);
  const tags = useIgnoreList("tags", debouncedQ, open, onError);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtering = debouncedQ.length > 0;

  async function onToggle(kind: Kind, id: number, ignored: boolean) {
    try {
      const updated = await setIgnored(kind, id, ignored);
      if (kind === "categories") categories.patchRow(id, updated);
      else tags.patchRow(id, updated);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!open) return null;

  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ignore-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2 id="ignore-title">Ignore lists</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <p className="muted">
          Checked labels are hidden from browse and text search. Picking a category or tag in the
          search filters still shows it. The worker still catalogs ignored labels so you can hide
          ecommerce / social / news after seeing what exists.
        </p>
        <div className="modal-filter">
          <label htmlFor={filterId}>Filter</label>
          <input
            id={filterId}
            value={filter}
            autoFocus
            placeholder="Filter categories and tags…"
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {error && <p className="error">{error}</p>}
        <div className="modal-grid">
          <ToggleList
            title="Categories"
            state={categories.state}
            filtering={filtering}
            kind="categories"
            onToggle={onToggle}
            onLoadMore={categories.loadMore}
          />
          <ToggleList
            title="Tags"
            state={tags.state}
            filtering={filtering}
            kind="tags"
            onToggle={onToggle}
            onLoadMore={tags.loadMore}
          />
        </div>
      </div>
    </div>
  );
}
