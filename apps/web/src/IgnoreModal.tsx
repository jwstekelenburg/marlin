import { useEffect, useState } from "react";
import { fetchIgnoreOptions, setIgnored, type Label } from "./api";

type Props = {
  open: boolean;
  onClose: () => void;
};

function ToggleList({
  title,
  rows,
  kind,
  onToggle,
}: {
  title: string;
  rows: Label[];
  kind: "categories" | "tags";
  onToggle: (kind: "categories" | "tags", id: number, ignored: boolean) => void;
}) {
  return (
    <section>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted">None yet — run the worker first.</p>
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
  const [categories, setCategories] = useState<Label[]>([]);
  const [tags, setTags] = useState<Label[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetchIgnoreOptions()
      .then((data) => {
        setCategories(data.categories);
        setTags(data.tags);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [open]);

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
          Checked labels are hidden from search. The worker still catalogs them so you can learn
          what exists, then hide ecommerce / social / news here.
        </p>
        {error && <p className="error">{error}</p>}
        <div className="modal-grid">
          <ToggleList title="Categories" rows={categories} kind="categories" onToggle={onToggle} />
          <ToggleList title="Tags" rows={tags} kind="tags" onToggle={onToggle} />
        </div>
      </div>
    </div>
  );
}
