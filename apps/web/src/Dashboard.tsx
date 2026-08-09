import { useEffect, useState } from "react";
import { fetchDashboard, type DashboardData } from "./api";

function fmt(n: number): string {
  return n.toLocaleString();
}

function ago(iso: string | null): string {
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

const PIPE: { key: keyof DashboardData["stats"]; label: string; cls: string }[] = [
  { key: "pending", label: "pending", cls: "st-pending" },
  { key: "fetching", label: "fetching", cls: "st-fetching" },
  { key: "ready", label: "ready", cls: "st-ready" },
  { key: "summarizing", label: "summarizing", cls: "st-sum" },
  { key: "done", label: "done", cls: "st-done" },
  { key: "failed", label: "failed", cls: "st-fail" },
  { key: "skipped", label: "skipped", cls: "st-skip" },
];

function BarList({
  rows,
  max,
}: {
  rows: { name: string; count: number; hint?: string; dim?: boolean }[];
  max: number;
}) {
  const width = Math.max(max, 1);
  return (
    <ul className="bar-list">
      {rows.map((row) => (
        <li key={row.name} className={row.dim ? "dim" : undefined}>
          <div className="bar-meta">
            <span>{row.name}</span>
            <em>
              {row.hint ? `${row.hint} · ` : ""}
              {fmt(row.count)}
            </em>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(row.count / width) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const next = await fetchDashboard();
        if (!alive) return;
        setData(next);
        setUpdated(new Date());
        setError(null);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5000);
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  if (!data && !error) {
    return <p className="muted">Loading dashboard…</p>;
  }

  if (!data) {
    return <p className="error">{error}</p>;
  }

  const { stats, throughput, fetchMaxReady } = data;
  const total = PIPE.reduce((s, p) => s + stats[p.key], 0);
  const lmBuf = stats.ready + stats.summarizing;
  const lmPct = Math.min(100, (lmBuf / fetchMaxReady) * 100);
  const catMax = Math.max(0, ...data.categories.map((c) => c.domainCount));
  const tagMax = Math.max(0, ...data.tags.map((t) => t.domainCount));
  const weights = Object.entries(data.crawlPriority.categories).sort((a, b) => b[1] - a[1]);

  return (
    <div className="dash">
      {error && <p className="error">{error}</p>}
      <p className="dash-live muted">
        live · 5s refresh
        {updated ? ` · ${updated.toLocaleTimeString()}` : ""}
      </p>

      <section className="kpis">
        <article className="kpi">
          <span>Indexed</span>
          <strong>{fmt(stats.done)}</strong>
          <em>
            {fmt(throughput.minute)}/min · {fmt(throughput.fifteen)} / 15m · {fmt(throughput.hour)} / h
          </em>
        </article>
        <article className="kpi">
          <span>Fetch queue</span>
          <strong>{fmt(stats.pending + stats.fetching)}</strong>
          <em>
            {fmt(stats.pending)} pending · {fmt(stats.fetching)} in flight
          </em>
        </article>
        <article className="kpi">
          <span>LM buffer</span>
          <strong>
            {fmt(lmBuf)}
            <small>/{fmt(fetchMaxReady)}</small>
          </strong>
          <div className="mini-track">
            <div className="mini-fill" style={{ width: `${lmPct}%` }} />
          </div>
        </article>
        <article className="kpi">
          <span>Failed / skipped</span>
          <strong>{fmt(stats.failed + stats.skipped)}</strong>
          <em>
            {fmt(stats.failed)} failed · {fmt(stats.skipped)} skipped
          </em>
        </article>
      </section>

      <section className="panel">
        <header>
          <h2>Pipeline</h2>
          <em>{fmt(total)} hosts</em>
        </header>
        <div className="stack" role="img" aria-label="status mix">
          {PIPE.map((p) => {
            const n = stats[p.key];
            if (!n || !total) return null;
            return (
              <div
                key={p.key}
                className={`stack-seg ${p.cls}`}
                style={{ flexGrow: n, flexBasis: 0 }}
                title={`${p.label}: ${fmt(n)}`}
              />
            );
          })}
        </div>
        <ul className="legend">
          {PIPE.map((p) => (
            <li key={p.key}>
              <i className={p.cls} />
              {p.label} <em>{fmt(stats[p.key])}</em>
            </li>
          ))}
        </ul>
      </section>

      <div className="dash-grid">
        <section className="panel">
          <header>
            <h2>Categories</h2>
            <em>{fmt(data.categories.length)}</em>
          </header>
          {data.categories.length === 0 ? (
            <p className="muted">None yet — worker will fill this in.</p>
          ) : (
            <BarList
              max={catMax}
              rows={data.categories.map((c) => ({
                name: c.name,
                count: c.domainCount,
                hint: `p${c.crawlPriority}${c.ignored ? " · ignored" : ""}`,
                dim: c.ignored,
              }))}
            />
          )}
        </section>

        <section className="panel">
          <header>
            <h2>Top tags</h2>
            <em>{fmt(data.tags.length)}</em>
          </header>
          {data.tags.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <BarList
              max={tagMax}
              rows={data.tags.map((t) => ({
                name: t.name,
                count: t.domainCount,
                hint: t.ignored ? "ignored" : undefined,
                dim: t.ignored,
              }))}
            />
          )}
        </section>
      </div>

      <div className="dash-grid">
        <section className="panel">
          <header>
            <h2>Pending by priority</h2>
          </header>
          {data.pendingByPriority.length === 0 ? (
            <p className="muted">Fetch queue empty.</p>
          ) : (
            <table className="grid-table">
              <thead>
                <tr>
                  <th>priority</th>
                  <th>hosts</th>
                </tr>
              </thead>
              <tbody>
                {data.pendingByPriority.map((row) => (
                  <tr key={row.priority}>
                    <td>{row.priority}</td>
                    <td>{fmt(row.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data.pendingBySource.length > 0 && (
            <p className="muted source-line">
              {data.pendingBySource.map((s) => `${s.source} ${fmt(s.count)}`).join(" · ")}
            </p>
          )}
        </section>

        <section className="panel">
          <header>
            <h2>Ready by priority</h2>
          </header>
          {data.readyByPriority.length === 0 ? (
            <p className="muted">LM queue empty.</p>
          ) : (
            <table className="grid-table">
              <thead>
                <tr>
                  <th>priority</th>
                  <th>hosts</th>
                </tr>
              </thead>
              <tbody>
                {data.readyByPriority.map((row) => (
                  <tr key={row.priority}>
                    <td>{row.priority}</td>
                    <td>{fmt(row.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="panel">
        <header>
          <h2>Crawl weights</h2>
          <em>
            seed {data.crawlPriority.seed} · default {data.crawlPriority.default}
          </em>
        </header>
        <div className="weight-pills">
          {weights.map(([name, weight]) => (
            <span key={name} className={`pill ${weight < 0 ? "faint" : ""}`}>
              {name} {weight > 0 ? `+${weight}` : weight}
            </span>
          ))}
        </div>
      </section>

      <div className="dash-grid">
        <section className="panel">
          <header>
            <h2>Just cataloged</h2>
          </header>
          {data.recentDone.length === 0 ? (
            <p className="muted">Nothing done yet.</p>
          ) : (
            <ol className="feed">
              {data.recentDone.map((row) => (
                <li key={row.id}>
                  <div className="feed-head">
                    <a href={`https://${row.host}`} target="_blank" rel="noreferrer">
                      {row.name || row.host}
                    </a>
                    <time>{ago(row.processedAt)}</time>
                  </div>
                  <p>{row.summary}</p>
                  {row.categoryName && <span className="pill faint">{row.categoryName}</span>}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="panel">
          <header>
            <h2>Recent failures</h2>
          </header>
          {data.recentFailed.length === 0 ? (
            <p className="muted">No failures. Nice.</p>
          ) : (
            <ol className="feed">
              {data.recentFailed.map((row) => (
                <li key={row.id}>
                  <div className="feed-head">
                    <span>{row.host}</span>
                    <time>{ago(row.processedAt)}</time>
                  </div>
                  <p className="fail-err">{row.error || "unknown error"}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
