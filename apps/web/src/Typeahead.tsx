import { useEffect, useId, useRef, useState } from "react";
import { typeahead, type Label } from "./api";

type Props = {
  kind: "categories" | "tags";
  label: string;
  value: Label | null;
  onChange: (value: Label | null) => void;
};

export function Typeahead({ kind, label, value, onChange }: Props) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Label[]>([]);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) return;
    const handle = setTimeout(() => {
      typeahead(kind, q)
        .then(setItems)
        .catch(() => setItems([]));
    }, 150);
    return () => clearTimeout(handle);
  }, [kind, q, value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (value) {
    return (
      <label className="field">
        <span>{label}</span>
        <button type="button" className="chip selected" onClick={() => onChange(null)}>
          {value.name}
          <span aria-hidden="true">×</span>
        </button>
      </label>
    );
  }

  return (
    <div className="field" ref={wrap}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={q}
        placeholder={`Filter ${label.toLowerCase()}…`}
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
              <button
                type="button"
                onClick={() => {
                  onChange(item);
                  setQ("");
                  setOpen(false);
                }}
              >
                <span>{item.name}</span>
                <em>{item.domainCount}</em>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
