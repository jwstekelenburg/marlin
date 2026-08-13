import { useEffect, useState } from "react";
import { fetchAnalyzeOverview, type AnalyzeOverviewData } from "./api";
import { AnalyzeLayout, BarList, fmt, pct, Spinner } from "./AnalyzeLayout";
import { buildSearchUrl } from "./search-url";

export function AnalyzeOverview({
  path,
  go,
}: {
  path: string;
  go: (to: string) => void;
}) {
  const [data, setData] = useState<AnalyzeOverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchAnalyzeOverview()
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
  }, []);

  return (
    <AnalyzeLayout path={path} go={go}>
      {!data && !error && <Spinner label="Loading overview…" />}
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <section className="kpis">
            <article className="kpi">
              <span>Done</span>
              <strong>{fmt(data.stats.done)}</strong>
              <em>
                {fmt(data.stats.failed)} failed · {fmt(data.stats.skipped)} skipped
              </em>
            </article>
            <article className="kpi">
              <span>Language null</span>
              <strong>
                {data.nullRates.done
                  ? pct(data.nullRates.languageNull / data.nullRates.done)
                  : "—"}
              </strong>
              <em>
                {fmt(data.nullRates.languageNull)} / {fmt(data.nullRates.done)}
              </em>
            </article>
            <article className="kpi">
              <span>Country null</span>
              <strong>
                {data.nullRates.done
                  ? pct(data.nullRates.countryNull / data.nullRates.done)
                  : "—"}
              </strong>
              <em>
                {fmt(data.nullRates.countryNull)} / {fmt(data.nullRates.done)}
              </em>
            </article>
            <article className="kpi">
              <span>Blocked apexes</span>
              <strong>{fmt(data.steward.blockedTotal)}</strong>
              <em>
                <button type="button" className="linkish" onClick={() => go("/analyze/steward")}>
                  steward ledger
                </button>
              </em>
            </article>
          </section>

          <div className="dash-grid">
            <section className="panel">
              <h3>Source mix (done)</h3>
              <p className="muted small">
                list / spider / link — closest proxy to discovery shape (no link graph stored).
              </p>
              <BarList
                max={Math.max(1, ...data.sourceMix.map((s) => s.count))}
                rows={data.sourceMix.map((s) => ({ name: s.source, count: s.count }))}
              />
            </section>
            <section className="panel">
              <h3>Top categories</h3>
              <BarList
                max={Math.max(1, ...data.topCategories.map((c) => c.domainCount))}
                rows={data.topCategories.map((c) => ({
                  name: c.name,
                  count: c.domainCount,
                  dim: c.ignored,
                  onClick: () => go(buildSearchUrl({ categoryId: c.id })),
                }))}
              />
              <button type="button" className="text-btn" onClick={() => go("/analyze/labels")}>
                Open labels →
              </button>
            </section>
            <section className="panel">
              <h3>Top tags</h3>
              <BarList
                max={Math.max(1, ...data.topTags.map((t) => t.domainCount))}
                rows={data.topTags.map((t) => ({
                  name: t.name,
                  count: t.domainCount,
                  dim: t.ignored,
                  onClick: () => go(buildSearchUrl({ tagIds: [t.id] })),
                }))}
              />
            </section>
            <section className="panel">
              <h3>Top platforms</h3>
              <BarList
                max={Math.max(1, ...data.topPlatforms.map((p) => p.done))}
                rows={data.topPlatforms.map((p) => ({
                  name: p.apex,
                  count: p.done,
                  hint: `${fmt(p.empty + p.parked)} empty/parked`,
                  onClick: () => go(`/analyze/platforms?apex=${encodeURIComponent(p.apex)}`),
                }))}
              />
              <button type="button" className="text-btn" onClick={() => go("/analyze/platforms")}>
                Open platforms →
              </button>
            </section>
            <section className="panel">
              <h3>Worst empty/parked rate</h3>
              <p className="muted small">Apexes with ≥20 done.</p>
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Apex</th>
                    <th>Done</th>
                    <th>Empty/parked</th>
                    <th>Junk</th>
                  </tr>
                </thead>
                <tbody>
                  {data.worstQuality.map((w) => (
                    <tr key={w.apex}>
                      <td>
                        <button
                          type="button"
                          className="linkish"
                          onClick={() =>
                            go(`/analyze/platforms?apex=${encodeURIComponent(w.apex)}`)
                          }
                        >
                          {w.apex}
                        </button>
                      </td>
                      <td>{fmt(w.done)}</td>
                      <td>{pct(w.emptyParkedRate)}</td>
                      <td>{pct(w.junkRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="panel">
              <h3>Recent blocks</h3>
              <ul className="feed">
                {data.steward.recentBlocks.map((b) => (
                  <li key={`${b.apex}-${b.createdAt}`}>
                    <strong>{b.apex}</strong>
                    <span className="muted">
                      {" "}
                      · {b.source} · {b.reason.slice(0, 80)}
                    </span>
                  </li>
                ))}
                {data.steward.recentBlocks.length === 0 && (
                  <li className="muted">No blocks yet.</li>
                )}
              </ul>
            </section>
          </div>
        </>
      )}
    </AnalyzeLayout>
  );
}
