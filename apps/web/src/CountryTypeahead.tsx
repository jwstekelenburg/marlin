import { useEffect, useId, useRef, useState } from "react";
import { typeaheadCountries, type CountryOption } from "./api";

type Props = {
  value: CountryOption | null;
  onChange: (value: CountryOption | null) => void;
};

export function CountryTypeahead({ value, onChange }: Props) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CountryOption[]>([]);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) return;
    const handle = setTimeout(() => {
      typeaheadCountries(q)
        .then(setItems)
        .catch(() => setItems([]));
    }, 150);
    return () => clearTimeout(handle);
  }, [q, value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="field" ref={wrap}>
      <label htmlFor={value ? undefined : id}>Country</label>
      {value ? (
        <div className="chips">
          <button type="button" className="chip selected" onClick={() => onChange(null)}>
            {value.name}
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ) : (
        <>
          <input
            id={id}
            value={q}
            placeholder="Filter country…"
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
          {open && items.length > 0 && (
            <ul className="menu" role="listbox">
              {items.map((item) => (
                <li key={item.code}>
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
