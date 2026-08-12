import { type ReactNode } from "react";

export function fmt(n: number): string {
  return n.toLocaleString();
}

export function pct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function ago(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Hover / focus tip — prefer short title text; keeps tables readable. */
export function InfoTip({ text }: { text: string }) {
  return (
    <abbr className="info-tip" title={text} aria-label={text}>
      ?
    </abbr>
  );
}

export function PanelTitle({
  children,
  tip,
}: {
  children: ReactNode;
  tip?: string;
}) {
  return (
    <h3 className="panel-title">
      {children}
      {tip ? <InfoTip text={tip} /> : null}
    </h3>
  );
}

export type BarRow = {
  key?: string;
  name: string;
  /** Drives bar width. */
  count: number;
  /** Right-side text above the bar (defaults to formatted count). */
  stats?: string;
  hint?: string;
  badge?: string;
  dim?: boolean;
  /** When set, the name renders as a link-styled control. */
  onClick?: () => void;
};

export function BarList({ rows, max }: { rows: BarRow[]; max: number }) {
  const width = Math.max(max, 1);
  return (
    <ul className="bar-list">
      {rows.map((row) => {
        const right =
          row.stats ??
          (row.hint ? `${row.hint} · ${fmt(row.count)}` : fmt(row.count));
        return (
          <li key={row.key ?? row.name} className={row.dim ? "dim" : undefined}>
            <div className="bar-meta">
              {row.onClick ? (
                <button type="button" className="linkish bar-label" onClick={row.onClick}>
                  {row.name}
                  {row.badge ? <span className="pill faint"> {row.badge}</span> : null}
                </button>
              ) : (
                <span className="bar-label">
                  {row.name}
                  {row.badge ? <span className="pill faint"> {row.badge}</span> : null}
                </span>
              )}
              <em>{right}</em>
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(row.count / width) * 100}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="spinner-row muted" role="status">
      <span className="spinner" aria-hidden />
      {label}
    </p>
  );
}

const TABS: { path: string; label: string; exact?: boolean }[] = [
  { path: "/analyze", label: "Overview", exact: true },
  { path: "/analyze/labels", label: "Labels" },
  { path: "/analyze/platforms", label: "Platforms" },
  { path: "/analyze/steward", label: "Steward" },
];

export function AnalyzeLayout({
  path,
  go,
  children,
}: {
  path: string;
  go: (to: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="dash analyze">
      <div className="analyze-head">
        <div>
          <p className="eyebrow">catalog</p>
          <h2 className="analyze-title">Analyze</h2>
          <p className="muted analyze-lede">
            Deep read of what the crawl found. Dashboard stays ops; Workers stays live runs.
          </p>
        </div>
        <nav className="analyze-nav">
          {TABS.map((tab) => {
            const on = tab.exact
              ? path === tab.path
              : path === tab.path || path.startsWith(`${tab.path}/`);
            return (
              <button
                key={tab.path}
                type="button"
                className={on ? "nav-on" : undefined}
                onClick={() => go(tab.path)}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
      {children}
    </div>
  );
}
