import { useEffect, useState } from "react";
import {
  fetchAnalyzePlatformDetail,
  fetchAnalyzePlatforms,
  type PlatformDetailData,
  type PlatformsData,
  type StewardEvidence,
} from "./api";
import { AnalyzeLayout, BarList, fmt, pct, ago } from "./AnalyzeLayout";
import { buildSearchUrl } from "./search-url";

const FILTER_DEBOUNCE_MS = 350;

function parseApex(search: string): string {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return p.get("apex")?.trim().toLowerCase() ?? "";
}

function EvidenceBlock({ evidence }: { evidence: StewardEvidence | null }) {
  if (!evidence) return null;
  return (
    <div className="evidence-block">
      <p className="muted small">
        {[
          evidence.hosts != null ? `${fmt(evidence.hosts)} hosts at review` : null,
          evidence.done != null ? `${fmt(evidence.done)} done` : null,
          evidence.junkDone != null ? `${fmt(evidence.junkDone)} junk` : null,
          evidence.spamLangDone != null ? `${fmt(evidence.spamLangDone)} spam-lang` : null,
          evidence.hotelName ? "hotel-name heuristic" : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {evidence.sampleHosts && evidence.sampleHosts.length > 0 && (
        <ul className="feed tight">
          {evidence.sampleHosts.map((h) => (
            <li key={h}>
              <a href={`https://${h}`} target="_blank" rel="noreferrer">
                {h}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<PlatformsData | null>(null);
  const [detail, setDetail] = useState<PlatformDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setQ(qInput.trim()), FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [qInput]);

  useEffect(() => {
    let alive = true;
    void fetchAnalyzePlatforms({ q, limit: 500, minSubdomains: 1 })
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
      setDetailLoading(false);
      return;
    }
    let alive = true;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
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
      })
      .finally(() => {
        if (alive) setDetailLoading(false);
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
              <span>Multi-host apexes</span>
              <strong>{fmt(data.totalMatching)}</strong>
              <em>
                subs &gt; {data.minSubdomains}
                {data.totalMatching > data.rows.length
                  ? ` · showing ${fmt(data.rows.length)} / ${fmt(data.limit)}`
                  : ""}
              </em>
            </article>
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

          <div className="analyze-split bigger-tho">
            <section className="panel">
              <div className="panel-head">
                <h3>Apex fan-out</h3>
                <label className="inline-field">
                  <span>Filter</span>
                  <input
                    value={qInput}
                    onChange={(e) => setQInput(e.target.value)}
                    placeholder="neocities…"
                  />
                </label>
              </div>
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Apex</th>
                    <th>Subs</th>
                    <th>Done</th>
                    <th>Hosts</th>
                    <th>Empty/parked</th>
                    <th>Junk</th>
                    <th>Steward</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => {
                    const classes = [
                      selected === row.apex ? "row-on" : "",
                      row.blocked ? "row-blocked" : "",
                      !row.blocked && !row.review && row.hosts >= 10 ? "row-unreviewed" : "",
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
                          {row.blocked && (
                            <span
                              className="pill warn"
                              title={`${row.blocked.source}: ${row.blocked.reason}`}
                            >
                              {" "}
                              blocked
                            </span>
                          )}
                        </td>
                        <td>
                          {fmt(row.subdomains)}/{fmt(row.cap)}
                        </td>
                        <td>{fmt(row.done)}</td>
                        <td>{fmt(row.hosts)}</td>
                        <td>{pct(row.emptyParkedRate)}</td>
                        <td>{pct(row.junkRate)}</td>
                        <td>
                          {row.blocked
                            ? "blocked"
                            : row.review
                              ? row.review.verdict
                              : row.hosts >= 10
                                ? "none"
                                : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            <section className="panel">
              <h3>Detail</h3>
              {!selected && <p className="muted">Select an apex (any multi-host row).</p>}
              {detailError && <p className="error">{detailError}</p>}
              {detailLoading && <p className="muted">Loading detail…</p>}
              {detail && !detailLoading && (
                <>
                  <p>
                    <strong>{detail.apex}</strong>
                    {detail.blocked && (
                      <span className="pill warn"> blocked · {detail.blocked.source}</span>
                    )}
                    {!detail.blocked && detail.review && (
                      <span className="pill faint"> {detail.review.verdict}</span>
                    )}
                  </p>
                  <p className="muted small">
                    {fmt(detail.done)} done · {fmt(detail.hosts)} hosts · empty/parked{" "}
                    {pct(detail.emptyParkedRate)} · junk {pct(detail.junkRate)} · subs{" "}
                    {fmt(detail.subdomains)}/{fmt(detail.cap)}
                  </p>

                  <h4>Steward</h4>
                  {detail.reviewGap && <p className="review-gap">{detail.reviewGap}</p>}
                  {detail.review && (
                    <div className="steward-card">
                      <p className="block-callout-label">Latest review</p>
                      <p>
                        <strong>{detail.review.verdict}</strong>
                        <span className="muted">
                          {" "}
                          · sample {fmt(detail.review.sampleSize)} ·{" "}
                          {ago(detail.review.reviewedAt)}
                        </span>
                      </p>
                      <p>{detail.review.reason}</p>
                      <EvidenceBlock evidence={detail.review.evidence} />
                      <p className="muted small">
                        apex_reviews keeps one row per apex — earlier judgments are overwritten.
                      </p>
                    </div>
                  )}
                  {detail.blocked && (
                    <div className="block-callout">
                      <p className="block-callout-label">Block</p>
                      <p>{detail.blocked.reason}</p>
                      <p className="muted small">
                        {detail.blocked.source}
                        {detail.blocked.createdAt
                          ? ` · ${new Date(detail.blocked.createdAt).toLocaleString()}`
                          : ""}
                      </p>
                      <EvidenceBlock evidence={detail.blocked.evidence} />
                    </div>
                  )}
                  {!detail.review && !detail.blocked && !detail.reviewGap && (
                    <p className="muted">No steward review or block on file.</p>
                  )}

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
