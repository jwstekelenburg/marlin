import { useEffect, useState } from "react";
import { fetchDashboard, type DashboardData } from "./api";
import { buildSearchUrl } from "./search-url";
import { Spinner } from "./Spinner";

function fmt(n: number): string {
  return n.toLocaleString();
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
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

function pct(n: number): string {
  return `${(n * 100).toFixed(n >= 0.999 ? 2 : 1)}%`;
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
  rows: { name: string; count: number; hint?: string; dim?: boolean; onClick?: () => void }[];
  max: number;
}) {
  const width = Math.max(max, 1);
  return (
    <ul className="bar-list">
      {rows.map((row) => {
        const body = (
          <>
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
          </>
        );
        return (
          <li key={row.name} className={row.dim ? "dim" : undefined}>
            {row.onClick ? (
              <button type="button" className="bar-btn" onClick={row.onClick}>
                {body}
              </button>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Dashboard({ go }: { go: (to: string) => void }) {
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
    return <Spinner label="Loading dashboard…" />;
  }

  if (!data) {
    return <p className="error">{error}</p>;
  }

  const { stats, throughput, fetchMaxReady, pg, staging, queueAge } = data;
  const total = PIPE.reduce((s, p) => s + stats[p.key], 0);
  const lmBuf = stats.ready + stats.summarizing;
  const lmPct = Math.min(100, (lmBuf / fetchMaxReady) * 100);
  const catMax = Math.max(0, ...data.categories.map((c) => c.domainCount));
  const tagMax = Math.max(0, ...data.tags.map((t) => t.domainCount));
  const weights = Object.entries(data.crawlPriority.categories).sort((a, b) => b[1] - a[1]);
  const stagingBytes = staging.reduce((s, row) => s + row.textBytes, 0);
  const heapAll = pg.tables.reduce((s, t) => s + t.heapBytes, 0);
  const indexAll = pg.tables.reduce((s, t) => s + t.indexBytes, 0);
  const toastAll = pg.tables.reduce((s, t) => s + t.toastBytes, 0);
  const sizeMix = heapAll + indexAll + toastAll;
  const connWarn = pg.connections.max > 0 && pg.connections.total / pg.connections.max > 0.7;

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
            {queueAge.oldestFetching ? ` · oldest ${ago(queueAge.oldestFetching)}` : ""}
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
          {(queueAge.oldestReady || queueAge.oldestSummarizing) && (
            <em>
              {[
                queueAge.oldestReady ? `ready ${ago(queueAge.oldestReady)}` : null,
                queueAge.oldestSummarizing ? `lm ${ago(queueAge.oldestSummarizing)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </em>
          )}
        </article>
        <article className="kpi">
          <span>Failed / skipped</span>
          <strong>{fmt(stats.failed + stats.skipped)}</strong>
          <em>
            {fmt(stats.failed)} failed · {fmt(stats.skipped)} skipped
          </em>
        </article>
        <article className="kpi">
          <span>Postgres</span>
          <strong>{fmtBytes(pg.databaseBytes)}</strong>
          <em>
            {pg.cacheHitRatio != null ? `${pct(pg.cacheHitRatio)} cache` : "cache n/a"}
            {" · "}
            <span className={connWarn ? "warn" : undefined}>
              {fmt(pg.connections.total)}/{fmt(pg.connections.max)} conns
            </span>
            {pg.tempBytes > 0 ? ` · temp ${fmtBytes(pg.tempBytes)}` : ""}
            {pg.deadlocks > 0 ? ` · ${fmt(pg.deadlocks)} deadlocks` : ""}
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
                onClick: () => go(buildSearchUrl({ categoryId: c.id })),
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
                onClick: () => go(buildSearchUrl({ tagIds: [t.id] })),
              }))}
            />
          )}
        </section>
      </div>

      <div className="dash-grid">
        <section className="panel">
          <header>
            <h2>Table sizes</h2>
            <em>
              heap {fmtBytes(heapAll)} · idx {fmtBytes(indexAll)} · toast {fmtBytes(toastAll)}
            </em>
          </header>
          {sizeMix > 0 && (
            <div className="stack size-stack" role="img" aria-label="storage mix">
              <div className="stack-seg st-heap" style={{ flexGrow: heapAll, flexBasis: 0 }} />
              <div className="stack-seg st-idx" style={{ flexGrow: indexAll, flexBasis: 0 }} />
              <div className="stack-seg st-toast" style={{ flexGrow: toastAll, flexBasis: 0 }} />
            </div>
          )}
          <ul className="legend">
            <li>
              <i className="st-heap" />
              heap
            </li>
            <li>
              <i className="st-idx" />
              indexes
            </li>
            <li>
              <i className="st-toast" />
              toast
            </li>
          </ul>
          {pg.tables.length === 0 ? (
            <p className="muted">No public tables.</p>
          ) : (
            <table className="grid-table">
              <thead>
                <tr>
                  <th>table</th>
                  <th className="num">total</th>
                  <th className="num">heap</th>
                  <th className="num">idx</th>
                  <th className="num">toast</th>
                  <th className="num">live</th>
                  <th className="num">dead</th>
                </tr>
              </thead>
              <tbody>
                {pg.tables.map((t) => (
                  <tr key={t.name}>
                    <td>
                      {t.name}
                      {t.lastVacuum && (
                        <span className="cell-hint">vac {ago(t.lastVacuum)}</span>
                      )}
                    </td>
                    <td className="num">{fmtBytes(t.totalBytes)}</td>
                    <td className="num">{fmtBytes(t.heapBytes)}</td>
                    <td className="num">{fmtBytes(t.indexBytes)}</td>
                    <td className="num">{fmtBytes(t.toastBytes)}</td>
                    <td className="num">{fmt(t.liveRows)}</td>
                    <td className={`num${t.deadRows > 0 && t.deadRows > t.liveRows * 0.1 ? " warn" : ""}`}>
                      {fmt(t.deadRows)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <header>
            <h2>Indexes</h2>
            <em>{fmt(pg.indexes.length)}</em>
          </header>
          {pg.indexes.length === 0 ? (
            <p className="muted">None.</p>
          ) : (
            <table className="grid-table">
              <thead>
                <tr>
                  <th>index</th>
                  <th className="num">size</th>
                  <th className="num">scans</th>
                </tr>
              </thead>
              <tbody>
                {pg.indexes.map((idx) => (
                  <tr key={idx.name}>
                    <td>
                      {idx.name}
                      <span className="cell-hint">{idx.table}</span>
                    </td>
                    <td className="num">{fmtBytes(idx.bytes)}</td>
                    <td className="num">{fmt(idx.scans)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <header className="subhead">
            <h2>Staging text</h2>
            <em>{fmtBytes(stagingBytes)}</em>
          </header>
          {staging.length === 0 ? (
            <p className="muted">No page_text sitting in fetch/LM/failed.</p>
          ) : (
            <table className="grid-table">
              <thead>
                <tr>
                  <th>status</th>
                  <th className="num">rows</th>
                  <th className="num">with text</th>
                  <th className="num">page_text</th>
                </tr>
              </thead>
              <tbody>
                {staging.map((row) => (
                  <tr key={row.status}>
                    <td>{row.status}</td>
                    <td className="num">{fmt(row.rows)}</td>
                    <td className="num">{fmt(row.withText)}</td>
                    <td className="num">{fmtBytes(row.textBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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

      <section className="panel">
        <header>
          <h2>Blocked apexes</h2>
          <em>
            {fmt(data.blockedApexes.total)} total · {fmt(data.blockedApexes.steward)} steward ·{" "}
            {fmt(data.blockedApexes.file)} file
          </em>
        </header>
        {data.blockedApexes.recent.length === 0 ? (
          <p className="muted">None yet — steward / migrate seed this table.</p>
        ) : (
          <table className="grid-table">
            <thead>
              <tr>
                <th>apex</th>
                <th>source</th>
                <th>reason</th>
                <th>when</th>
              </tr>
            </thead>
            <tbody>
              {data.blockedApexes.recent.map((row) => (
                <tr key={row.apex}>
                  <td>{row.apex}</td>
                  <td>{row.source}</td>
                  <td className="fail-err">{row.reason}</td>
                  <td className="num">{ago(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
          {data.failedByError.length > 0 && (
            <table className="grid-table fail-summary">
              <tbody>
                {data.failedByError.map((row) => (
                  <tr key={row.error}>
                    <td className="fail-err">{row.error}</td>
                    <td className="num">{fmt(row.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
