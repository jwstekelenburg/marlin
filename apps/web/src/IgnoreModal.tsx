import { useEffect, useId, useMemo, useState } from "react";
import { fetchIgnoreOptions, setIgnored, type Label } from "./api";

type Props = {
  open: boolean;
  onClose: () => void;
};

function matchesFilter(name: string, q: string): boolean {
  if (!q) return true;
  return name.toLowerCase().includes(q);
}

function ToggleList({
  title,
  rows,
  total,
  kind,
  filtering,
  onToggle,
}: {
  title: string;
  rows: Label[];
  total: number;
  kind: "categories" | "tags";
  filtering: boolean;
  onToggle: (kind: "categories" | "tags", id: number, ignored: boolean) => void;
}) {
  const count = filtering ? `${rows.length}/${total}` : String(total);
  return (
    <section>
      <h3>
        {title} <em>{count}</em>
      </h3>
      {total === 0 ? (
        <p className="muted">None yet — run the worker first.</p>
      ) : rows.length === 0 ? (
        <p className="muted">No matches.</p>
      ) : (
        <ul className="ignore-list">
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
        </ul>
      )}
    </section>
  );
}

export function IgnoreModal({ open, onClose }: Props) {
  const filterId = useId();
  const [categories, setCategories] = useState<Label[]>([]);
  const [tags, setTags] = useState<Label[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFilter("");
    fetchIgnoreOptions()
      .then((data) => {
        setCategories(data.categories);
        setTags(data.tags);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [open]);

  const q = filter.trim().toLowerCase();
  const filtering = q.length > 0;
  const visibleCategories = useMemo(
    () => categories.filter((row) => matchesFilter(row.name, q)),
    [categories, q],
  );
  const visibleTags = useMemo(
    () => tags.filter((row) => matchesFilter(row.name, q)),
    [tags, q],
  );

  async function onToggle(kind: "categories" | "tags", id: number, ignored: boolean) {
    const updated = await setIgnored(kind, id, ignored);
    const apply = (rows: Label[]) => rows.map((r) => (r.id === id ? updated : r));
    if (kind === "categories") setCategories(apply);
    else setTags(apply);
  }

  if (!open) return null;

  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
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
            rows={visibleCategories}
            total={categories.length}
            kind="categories"
            filtering={filtering}
            onToggle={onToggle}
          />
          <ToggleList
            title="Tags"
            rows={visibleTags}
            total={tags.length}
            kind="tags"
            filtering={filtering}
            onToggle={onToggle}
          />
        </div>
      </div>
    </div>
  );
}
