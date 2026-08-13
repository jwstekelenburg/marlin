import { useEffect, useState, type FormEvent } from "react";
import {
  blockApexManual,
  fetchAnalyzeSteward,
  unblockApex,
  type StewardAnalyzeData,
} from "./api";
import { AnalyzeLayout, fmt, pct, ago, Spinner } from "./AnalyzeLayout";

const FILTER_DEBOUNCE_MS = 350;

export function AnalyzeSteward({
  path,
  go,
}: {
  path: string;
  go: (to: string) => void;
}) {
  const [data, setData] = useState<StewardAnalyzeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [blockApex, setBlockApex] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setQ(qInput.trim()), FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [qInput]);

  async function reload() {
    const next = await fetchAnalyzeSteward({
      source: source || undefined,
      q: q || undefined,
    });
    setData(next);
  }

  useEffect(() => {
    let alive = true;
    void fetchAnalyzeSteward({
      source: source || undefined,
      q: q || undefined,
    })
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
  }, [source, q]);

  async function onUnblock(apex: string) {
    if (!window.confirm(`Unblock ${apex}? Unfinished hosts dropped on block are not requeued.`)) {
      return;
    }
    setBusy(apex);
    setMessage(null);
    try {
      await unblockApex(apex);
      setMessage(`Unblocked ${apex}`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function onBlock(e: FormEvent) {
    e.preventDefault();
    if (!blockApex.trim()) return;
    setBusy("block");
    setMessage(null);
    try {
      const result = await blockApexManual({
        apex: blockApex.trim(),
        reason: blockReason.trim() || undefined,
      });
      setMessage(`Blocked ${result.apex} · dropped ${fmt(result.dropped)} unfinished`);
      setBlockApex("");
      setBlockReason("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AnalyzeLayout path={path} go={go}>
      {error && <p className="error">{error}</p>}
      {message && <p className="ok-msg">{message}</p>}
      {!data && !error && <Spinner label="Loading steward ledger…" />}

      {data && (
        <>
          <section className="kpis">
            <article className="kpi">
              <span>Blocked</span>
              <strong>{fmt(data.counts.blocked)}</strong>
              <em>
                {fmt(data.counts.steward)} steward · {fmt(data.counts.file)} file
              </em>
            </article>
            <article className="kpi">
              <span>Reviews</span>
              <strong>{fmt(data.counts.reviews)}</strong>
            </article>
            <article className="kpi">
              <span>Open candidates</span>
              <strong>{fmt(data.candidates.length)}</strong>
            </article>
          </section>

          <section className="panel">
            <h3>Manual block</h3>
            <p className="muted small">
              Drops unfinished queue under the apex; keeps done. Allowlisted UGC apexes are refused.
            </p>
            <form className="inline-form" onSubmit={(e) => void onBlock(e)}>
              <label className="inline-field">
                <span>Apex</span>
                <input
                  value={blockApex}
                  onChange={(e) => setBlockApex(e.target.value)}
                  placeholder="example.com"
                />
              </label>
              <label className="inline-field grow">
                <span>Reason</span>
                <input
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="crawler trap…"
                />
              </label>
              <button type="submit" className="primary" disabled={busy === "block"}>
                Block
              </button>
            </form>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>Blocked apexes</h3>
              <div className="inline-row">
                <label className="inline-field">
                  <span>Source</span>
                  <select value={source} onChange={(e) => setSource(e.target.value)}>
                    <option value="">all</option>
                    <option value="steward">steward</option>
                    <option value="file">file</option>
                  </select>
                </label>
                <label className="inline-field">
                  <span>Filter</span>
                  <input
                    value={qInput}
                    onChange={(e) => setQInput(e.target.value)}
                    placeholder="apex…"
                  />
                </label>
              </div>
            </div>
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Apex</th>
                  <th>Source</th>
                  <th>Reason</th>
                  <th>When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.blocked.map((b) => (
                  <tr key={b.apex}>
                    <td>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() =>
                          go(`/analyze/platforms?apex=${encodeURIComponent(b.apex)}`)
                        }
                      >
                        {b.apex}
                      </button>
                    </td>
                    <td>{b.source}</td>
                    <td>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => setExpanded(expanded === b.apex ? null : b.apex)}
                      >
                        {b.reason.slice(0, 80)}
                        {b.reason.length > 80 ? "…" : ""}
                      </button>
                      {expanded === b.apex && (
                        <pre className="evidence">
                          {JSON.stringify(b.evidence ?? { reason: b.reason }, null, 2)}
                        </pre>
                      )}
                    </td>
                    <td>{ago(b.createdAt)}</td>
                    <td>
                      <button
                        type="button"
                        disabled={busy === b.apex}
                        onClick={() => void onUnblock(b.apex)}
                      >
                        Unblock
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel">
            <h3>Spiral candidates</h3>
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Apex</th>
                  <th>Hosts</th>
                  <th>Done</th>
                  <th>Junk</th>
                  <th>Spam-lang</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.candidates.map((c) => (
                  <tr key={c.apex}>
                    <td>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() =>
                          go(`/analyze/platforms?apex=${encodeURIComponent(c.apex)}`)
                        }
                      >
                        {c.apex}
                        {c.hotelName ? " (hotel-name)" : ""}
                      </button>
                    </td>
                    <td>{fmt(c.hosts)}</td>
                    <td>{fmt(c.done)}</td>
                    <td>{c.done ? pct(c.junkDone / c.done) : "—"}</td>
                    <td>
                      {c.labeledLang ? pct(c.spamLangDone / c.labeledLang) : "—"}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          setBlockApex(c.apex);
                          setBlockReason("spiral candidate (manual)");
                        }}
                      >
                        Fill block
                      </button>
                    </td>
                  </tr>
                ))}
                {data.candidates.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No open candidates.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="panel">
            <h3>Review history</h3>
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Apex</th>
                  <th>Verdict</th>
                  <th>Sample</th>
                  <th>Reason</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {data.reviews.map((r) => (
                  <tr key={`${r.apex}-${r.reviewedAt}`}>
                    <td>{r.apex}</td>
                    <td>{r.verdict}</td>
                    <td>{fmt(r.sampleSize)}</td>
                    <td>{r.reason.slice(0, 100)}</td>
                    <td>{ago(r.reviewedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </AnalyzeLayout>
  );
}
