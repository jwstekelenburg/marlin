import { useEffect, useState } from "react";
import {
  fetchAnalyzePlatformDetail,
  fetchAnalyzePlatforms,
  type PlatformDetailData,
  type PlatformsData,
} from "./api";
import { AnalyzeLayout, BarList, fmt, pct } from "./AnalyzeLayout";
import { buildSearchUrl } from "./search-url";

function parseApex(search: string): string {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return p.get("apex")?.trim().toLowerCase() ?? "";
}

export function AnalyzePlatforms({
  path,
  search,
  go,
}: {
  path: string;
  search: string;
  go: (to: string) => void;
}) {
  const selected = parseApex(search);
  const [q, setQ] = useState("");
  const [data, setData] = useState<PlatformsData | null>(null);
  const [detail, setDetail] = useState<PlatformDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchAnalyzePlatforms({ q, limit: 100 })
      .then((next) => {
        if (!alive) return;
        setData(next);
        setError(null);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [q]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let alive = true;
    void fetchAnalyzePlatformDetail(selected)
      .then((next) => {
        if (!alive) return;
        setDetail(next);
        setDetailError(null);
      })
      .catch((err) => {
        if (!alive) return;
        setDetail(null);
        setDetailError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [selected]);

  return (
    <AnalyzeLayout path={path} go={go}>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Loading platforms…</p>}
      {data && (
        <>
          <p className="muted">{data.note}</p>
          <section className="kpis">
            <article className="kpi">
              <span>Subdomain cap</span>
              <strong>{fmt(data.cap)}</strong>
              <em>per apex (non-apex hosts)</em>
            </article>
            {data.sourceMix.map((s) => (
              <article key={s.source} className="kpi">
                <span>Done via {s.source}</span>
                <strong>{fmt(s.count)}</strong>
              </article>
            ))}
          </section>

          <div className="analyze-split">
            <section className="panel">
              <div className="panel-head">
                <h3>Apex fan-out</h3>
                <label className="inline-field">
                  <span>Filter</span>
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="neocities…"
                  />
                </label>
              </div>
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Apex</th>
                    <th>Done</th>
                    <th>Hosts</th>
                    <th>Empty/parked</th>
                    <th>Junk</th>
                    <th>Subs</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => {
                    const classes = [
                      selected === row.apex ? "row-on" : "",
                      row.blocked ? "row-blocked" : "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <tr key={row.apex} className={classes || undefined}>
                        <td>
                          <button
                            type="button"
                            className="linkish"
                            onClick={() =>
                              go(`/analyze/platforms?apex=${encodeURIComponent(row.apex)}`)
                            }
                          >
                            {row.apex}
                          </button>
                        </td>
                        <td>{fmt(row.done)}</td>
                        <td>{fmt(row.hosts)}</td>
                        <td>{pct(row.emptyParkedRate)}</td>
                        <td>{pct(row.junkRate)}</td>
                        <td>
                          {fmt(row.subdomains)}/{fmt(row.cap)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            <section className="panel">
              <h3>Detail</h3>
              {!selected && <p className="muted">Select an apex.</p>}
              {detailError && <p className="error">{detailError}</p>}
              {detail && (
                <>
                  <p>
                    <strong>{detail.apex}</strong>
                    {detail.blocked && (
                      <span className="pill warn"> blocked · {detail.blocked.source}</span>
                    )}
                  </p>
                  {detail.blocked && (
                    <div className="block-callout">
                      <p className="block-callout-label">Block reason</p>
                      <p>{detail.blocked.reason}</p>
                      <p className="muted small">
                        {detail.blocked.source}
                        {detail.blocked.createdAt
                          ? ` · ${new Date(detail.blocked.createdAt).toLocaleString()}`
                          : ""}
                      </p>
                    </div>
                  )}
                  <p className="muted small">
                    {fmt(detail.done)} done · {fmt(detail.hosts)} hosts · empty/parked{" "}
                    {pct(detail.emptyParkedRate)} · junk {pct(detail.junkRate)} · subs{" "}
                    {fmt(detail.subdomains)}/{fmt(detail.cap)}
                  </p>
                  <h4>Source mix</h4>
                  <BarList
                    max={Math.max(1, ...detail.sources.map((s) => s.count))}
                    rows={detail.sources.map((s) => ({ name: s.source, count: s.count }))}
                  />
                  <h4>Categories</h4>
                  <BarList
                    max={Math.max(1, ...detail.topCategories.map((c) => c.count))}
                    rows={detail.topCategories.map((c) => ({
                      name: c.name,
                      count: c.count,
                      onClick: () => go(buildSearchUrl({ categoryId: c.id })),
                    }))}
                  />
                  <h4>Languages</h4>
                  <BarList
                    max={Math.max(1, ...detail.topLanguages.map((l) => l.count))}
                    rows={detail.topLanguages.map((l) => ({
                      name: l.language,
                      count: l.count,
                    }))}
                  />
                  <h4>Recent samples</h4>
                  <ul className="feed">
                    {detail.samples.map((s) => (
                      <li key={s.id}>
                        <a href={`https://${s.host}`} target="_blank" rel="noreferrer">
                          {s.host}
                        </a>
                        <span className="muted">
                          {" "}
                          · {s.categoryName ?? "—"} · {(s.summary ?? "").slice(0, 80)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
        </>
      )}
    </AnalyzeLayout>
  );
}
