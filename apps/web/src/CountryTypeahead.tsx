import { useEffect, useId, useRef, useState } from "react";
import {
  typeaheadCountries,
  typeaheadLanguages,
  type GeoOption,
} from "./api";

type Kind = "countries" | "languages";

const FETCHERS: Record<Kind, (q: string) => Promise<GeoOption[]>> = {
  countries: typeaheadCountries,
  languages: typeaheadLanguages,
};

type GeoProps = {
  kind: Kind;
  label: string;
  placeholder: string;
  value: GeoOption | null;
  onChange: (value: GeoOption | null) => void;
};

export function GeoTypeahead({ kind, label, placeholder, value, onChange }: GeoProps) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<GeoOption[]>([]);
  const wrap = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const fetchItems = FETCHERS[kind];

  useEffect(() => {
    if (value) return;
    const handle = setTimeout(() => {
      const requestId = ++seq.current;
      fetchItems(q)
        .then((rows) => {
          if (requestId !== seq.current) return;
          setItems(rows);
        })
        .catch(() => {
          if (requestId !== seq.current) return;
          setItems([]);
        });
    }, 150);
    return () => clearTimeout(handle);
  }, [q, value, fetchItems]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="field" ref={wrap}>
      <label htmlFor={value ? undefined : id}>{label}</label>
      {value ? (
        <div className="chips">
          <button
            type="button"
            className="chip selected"
            aria-label={`Remove ${value.name}`}
            onClick={() => onChange(null)}
          >
            {value.name}
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ) : (
        <>
          <input
            id={id}
            value={q}
            placeholder={placeholder}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
          {open && items.length > 0 && (
            <ul className="menu" role="listbox">
              {items.map((item) => (
                <li key={item.code} role="option">
                  <button
                    type="button"
                    onClick={() => {
                      onChange(item);
                      setQ("");
                      setOpen(false);
                    }}
                  >
                    <span>{item.name}</span>
                    <em>{item.count}</em>
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

export function CountryTypeahead(props: {
  value: GeoOption | null;
  onChange: (value: GeoOption | null) => void;
}) {
  return (
    <GeoTypeahead kind="countries" label="Country" placeholder="Filter country…" {...props} />
  );
}

export function LanguageTypeahead(props: {
  value: GeoOption | null;
  onChange: (value: GeoOption | null) => void;
}) {
  return (
    <GeoTypeahead kind="languages" label="Language" placeholder="Filter language…" {...props} />
  );
}
