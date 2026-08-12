import { useEffect, useState } from "react";
import {
  fetchAnalyzeCategoryProfile,
  fetchAnalyzeCategorySimilarity,
  fetchAnalyzeLabels,
  fetchAnalyzeLexical,
  fetchAnalyzeTagPairs,
  mergeLabels,
  setIgnored,
  type CategoryProfileData,
  type CategorySimilarityRow,
  type LabelsOverviewData,
  type LexicalCandidate,
  type TagPairsData,
} from "./api";
import { AnalyzeLayout, BarList, fmt, pct } from "./AnalyzeLayout";
import { buildSearchUrl } from "./search-url";

const METRIC_BLURBS: Record<string, string> = {
  jaccard:
    "Overlap of the two tags’ domain sets: both / (A ∪ B). High means they almost always appear together; good for spotting relational twins.",
  lift:
    "How much more often the pair co-occurs than if the tags were independent (both / expected). >1 = attracted; ~1 = chance; <1 = avoid each other.",
  pmi:
    "Pointwise mutual information (log₂ of lift’s probability form). Emphasizes surprising associations; rarer co-hits can rank above frequent-but-expected pairs.",
  count:
    "Raw number of done domains that have both tags. Favours popular tags; use when you care about volume more than association strength.",
};

export function AnalyzeLabels({
  path,
  go,
}: {
  path: string;
  go: (to: string) => void;
}) {
  const [overview, setOverview] = useState<LabelsOverviewData | null>(null);
  const [pairs, setPairs] = useState<TagPairsData | null>(null);
  const [similarity, setSimilarity] = useState<CategorySimilarityRow[] | null>(null);
  const [lexical, setLexical] = useState<LexicalCandidate[] | null>(null);
  const [profile, setProfile] = useState<CategoryProfileData | null>(null);
  const [metric, setMetric] = useState("jaccard");
  const [minCount, setMinCount] = useState(50);
  const [tagFloor, setTagFloor] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function reloadCore() {
    const [o, p, s, l] = await Promise.all([
      fetchAnalyzeLabels(),
      fetchAnalyzeTagPairs({ minCount, metric, limit: 60 }),
      fetchAnalyzeCategorySimilarity(),
      fetchAnalyzeLexical(),
    ]);
    setOverview(o);
    setPairs(p);
    setSimilarity(s);
    setLexical(l);
  }

  useEffect(() => {
    let alive = true;
    setError(null);
    void reloadCore()
      .then(() => {
        if (!alive) return;
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [metric, minCount]);

  async function loadProfile(id: number) {
    try {
      setProfile(await fetchAnalyzeCategoryProfile(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleIgnore(kind: "categories" | "tags", id: number, ignored: boolean) {
    setBusy(`${kind}-${id}`);
    try {
      await setIgnored(kind, id, !ignored);
      await reloadCore();
      if (profile && kind === "categories" && profile.id === id) {
        await loadProfile(id);
      }
      setMessage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function runMerge(kind: "tag" | "category", from: string, to: string, apply: boolean) {
    setBusy(`merge-${from}`);
    setMessage(null);
    try {
      const result = await mergeLabels({ kind, from, to, apply });
      if (!apply) {
        setMessage(
          `Plan: ${result.plan.action} ${result.plan.from} → ${result.plan.to} (${fmt(result.plan.fromCount)} into ${fmt(result.plan.toCount)})${result.plan.ignoreNote ? ` · ${result.plan.ignoreNote}` : ""}`,
        );
      } else {
        setMessage(`Applied ${result.plan.from} → ${result.plan.to}`);
        await reloadCore();
        setProfile(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const tags = (overview?.tags ?? []).filter((t) => t.domainCount >= tagFloor);

  return (
    <AnalyzeLayout path={path} go={go}>
      {error && <p className="error">{error}</p>}
      {message && <p className="ok-msg">{message}</p>}
      {!overview && !error && <p className="muted">Loading labels…</p>}

      {overview && (
        <>
          <p className="muted">
            Lexical near-dupes are merge candidates. Relational twins (high Jaccard) are{" "}
            <em>not</em> auto-merged — diagnose first.
          </p>

          <div className="dash-grid">
            <section className="panel">
              <div className="panel-head">
                <h3>Categories</h3>
              </div>
              <table className="grid-table compact">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Count</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {overview.categories.slice(0, 40).map((c) => (
                    <tr key={c.id} className={c.ignored ? "dim" : undefined}>
                      <td>
                        <button type="button" className="linkish" onClick={() => void loadProfile(c.id)}>
                          {c.name}
                        </button>
                      </td>
                      <td>{fmt(c.domainCount)}</td>
                      <td className="actions">
                        <button
                          type="button"
                          disabled={busy === `categories-${c.id}`}
                          onClick={() => void toggleIgnore("categories", c.id, c.ignored)}
                        >
                          {c.ignored ? "Unignore" : "Ignore"}
                        </button>
                        <button
                          type="button"
                          onClick={() => go(buildSearchUrl({ categoryId: c.id }))}
                        >
                          Search
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h3>Tags</h3>
                <label className="inline-field">
                  <span>Min count</span>
                  <input
                    type="number"
                    min={1}
                    value={tagFloor}
                    onChange={(e) => setTagFloor(Number(e.target.value) || 1)}
                  />
                </label>
              </div>
              <BarList
                max={Math.max(1, ...tags.slice(0, 30).map((t) => t.domainCount))}
                rows={tags.slice(0, 30).map((t) => ({
                  name: t.name,
                  count: t.domainCount,
                  dim: t.ignored,
                  onClick: () => go(buildSearchUrl({ tagIds: [t.id] })),
                }))}
              />
            </section>

            <section className="panel">
              <h3>Languages</h3>
              <BarList
                max={Math.max(1, ...overview.languages.map((l) => l.count))}
                rows={overview.languages.slice(0, 20).map((l) => ({
                  name: l.language,
                  count: l.count,
                }))}
              />
            </section>
            <section className="panel">
              <h3>Countries</h3>
              <BarList
                max={Math.max(1, ...overview.countries.map((c) => c.count))}
                rows={overview.countries.slice(0, 20).map((c) => ({
                  name: c.country,
                  count: c.count,
                }))}
              />
            </section>
          </div>

          {profile && (
            <section className="panel">
              <h3>
                Category profile · {profile.name}{" "}
                <span className="muted">({fmt(profile.domainCount)})</span>
              </h3>
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th>Count</th>
                    <th>Share</th>
                    <th>Lift</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {profile.tags.map((t) => (
                    <tr key={t.id}>
                      <td>
                        {t.name}
                        {t.exclusive ? <span className="pill faint"> exclusive</span> : null}
                      </td>
                      <td>{fmt(t.count)}</td>
                      <td>{pct(t.share)}</td>
                      <td>{t.lift.toFixed(2)}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => go(buildSearchUrl({ tagIds: [t.id] }))}
                        >
                          Search
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="panel">
            <div className="panel-head">
              <h3>Tag co-occurrence</h3>
              <div className="inline-row">
                <label className="inline-field">
                  <span>Metric</span>
                  <select value={metric} onChange={(e) => setMetric(e.target.value)}>
                    <option value="jaccard">Jaccard</option>
                    <option value="lift">Lift</option>
                    <option value="pmi">PMI</option>
                    <option value="count">Count</option>
                  </select>
                </label>
                <label className="inline-field">
                  <span>Min tag count</span>
                  <input
                    type="number"
                    min={5}
                    value={minCount}
                    onChange={(e) => setMinCount(Number(e.target.value) || 50)}
                  />
                </label>
              </div>
            </div>
            <p className="muted small metric-blurb">{METRIC_BLURBS[metric]}</p>
            {!pairs && <p className="muted">Computing pairs…</p>}
            {pairs && (
              <>
                <p className="muted small">
                  Done corpus {fmt(pairs.doneTotal)} · eligible tags ≥ {pairs.minCount}
                </p>
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th>A</th>
                      <th>B</th>
                      <th>Both</th>
                      <th>Jaccard</th>
                      <th>Lift</th>
                      <th>PMI</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {pairs.pairs.map((p) => (
                      <tr key={`${p.tagAId}-${p.tagBId}`}>
                        <td>{p.tagA}</td>
                        <td>{p.tagB}</td>
                        <td>{fmt(p.both)}</td>
                        <td>{p.jaccard.toFixed(3)}</td>
                        <td>{p.lift.toFixed(2)}</td>
                        <td>{p.pmi.toFixed(2)}</td>
                        <td>
                          <button
                            type="button"
                            onClick={() =>
                              go(buildSearchUrl({ tagIds: [p.tagAId, p.tagBId] }))
                            }
                          >
                            Search
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <h4>Relational twins (Jaccard ≥ 0.85) — diagnose, do not auto-merge</h4>
                {pairs.twins.length === 0 ? (
                  <p className="muted">None at this floor.</p>
                ) : (
                  <ul className="feed">
                    {pairs.twins.map((p) => (
                      <li key={`twin-${p.tagAId}-${p.tagBId}`}>
                        <strong>
                          {p.tagA} ↔ {p.tagB}
                        </strong>
                        <span className="muted">
                          {" "}
                          · J={p.jaccard.toFixed(3)} · both {fmt(p.both)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <h4>Implications (one nearly entails the other)</h4>
                {pairs.implications.length === 0 ? (
                  <p className="muted">None at this floor.</p>
                ) : (
                  <ul className="feed">
                    {pairs.implications.map((p) => {
                      const aImpliesB = p.pBGivenA >= p.pAGivenB;
                      const left = aImpliesB ? p.tagA : p.tagB;
                      const right = aImpliesB ? p.tagB : p.tagA;
                      const conf = aImpliesB ? p.pBGivenA : p.pAGivenB;
                      return (
                        <li key={`impl-${p.tagAId}-${p.tagBId}`}>
                          <strong>
                            {left} → {right}
                          </strong>
                          <span className="muted"> · P={pct(conf)} · both {fmt(p.both)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </section>

          <section className="panel">
            <h3>Categories with similar tag profiles</h3>
            {!similarity && <p className="muted">Loading…</p>}
            {similarity && (
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>A</th>
                    <th>B</th>
                    <th>Cosine</th>
                    <th>Shared tags</th>
                  </tr>
                </thead>
                <tbody>
                  {similarity.map((row) => (
                    <tr key={`${row.categoryAId}-${row.categoryBId}`}>
                      <td>
                        <button
                          type="button"
                          className="linkish"
                          onClick={() => void loadProfile(row.categoryAId)}
                        >
                          {row.categoryA}
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="linkish"
                          onClick={() => void loadProfile(row.categoryBId)}
                        >
                          {row.categoryB}
                        </button>
                      </td>
                      <td>{row.cosine.toFixed(3)}</td>
                      <td>{fmt(row.sharedTags)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel">
            <h3>Lexical merge candidates</h3>
            <p className="muted small">
              Spelling / hyphen variants. Dry-run then apply. Copy the alias line into{" "}
              <code>data/label-aliases.txt</code> to keep merges reproducible.
            </p>
            {!lexical && <p className="muted">Loading…</p>}
            {lexical && (
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Reason</th>
                    <th>Alias</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lexical.map((c) => (
                    <tr key={`${c.kind}-${c.fromId}-${c.toId}`}>
                      <td>{c.kind}</td>
                      <td>
                        {c.from} <span className="muted">({fmt(c.fromCount)})</span>
                      </td>
                      <td>
                        {c.to} <span className="muted">({fmt(c.toCount)})</span>
                      </td>
                      <td>{c.reason}</td>
                      <td>
                        <code className="alias-line">{c.aliasLine}</code>
                      </td>
                      <td className="actions">
                        <button
                          type="button"
                          disabled={busy === `merge-${c.from}`}
                          onClick={() => void runMerge(c.kind, c.from, c.to, false)}
                        >
                          Dry-run
                        </button>
                        <button
                          type="button"
                          className="primary"
                          disabled={busy === `merge-${c.from}`}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Merge ${c.kind} "${c.from}" into "${c.to}"? This rewrites the catalog.`,
                              )
                            ) {
                              void runMerge(c.kind, c.from, c.to, true);
                            }
                          }}
                        >
                          Apply
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </AnalyzeLayout>
  );
}
