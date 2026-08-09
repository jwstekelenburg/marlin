import { useEffect, useId, useRef, useState } from "react";
import { typeahead, type Label } from "./api";

type Props = {
  kind: "categories" | "tags";
  label: string;
  values: Label[];
  onChange: (values: Label[]) => void;
  max?: number;
};

export function Typeahead({ kind, label, values, onChange, max = Number.POSITIVE_INFINITY }: Props) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Label[]>([]);
  const wrap = useRef<HTMLDivElement>(null);
  const selectedIds = new Set(values.map((v) => v.id));
  const atCap = values.length >= max;

  useEffect(() => {
    if (atCap) return;
    const handle = setTimeout(() => {
      typeahead(kind, q)
        .then((rows) => setItems(rows.filter((row) => !selectedIds.has(row.id))))
        .catch(() => setItems([]));
    }, 150);
    return () => clearTimeout(handle);
  }, [kind, q, atCap, values]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function remove(idToRemove: number) {
    onChange(values.filter((v) => v.id !== idToRemove));
  }

  function add(item: Label) {
    if (selectedIds.has(item.id) || atCap) return;
    onChange([...values, item]);
    setQ("");
    setOpen(max > 1);
  }

  return (
    <div className="field" ref={wrap}>
      <label htmlFor={atCap ? undefined : id}>{label}</label>
      {values.length > 0 && (
        <div className="chips">
          {values.map((item) => (
            <button
              key={item.id}
              type="button"
              className="chip selected"
              onClick={() => remove(item.id)}
            >
              {item.name}
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
      {!atCap && (
        <>
          <input
            id={id}
            value={q}
            placeholder={values.length ? `Add ${label.toLowerCase()}…` : `Filter ${label.toLowerCase()}…`}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
          {open && items.length > 0 && (
            <ul className="menu" role="listbox">
              {items.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => add(item)}>
                    <span>{item.name}</span>
                    <em>{item.domainCount}</em>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
