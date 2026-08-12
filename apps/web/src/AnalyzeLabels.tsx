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
import {
  AnalyzeLayout,
  BarList,
  InfoTip,
  PanelTitle,
  Spinner,
  fmt,
  pct,
} from "./AnalyzeLayout";
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

const TIPS = {
  categories:
    "Done domains grouped by the LM category label. Click a name to open its tag profile beside this table.",
  profile:
    "Tags that appear on done domains in the selected category. Bar width = count in this category. Click a tag name to search.",
  share:
    "Share: fraction of this category’s domains that carry the tag (count ÷ category size).",
  lift:
    "Lift: how enriched the tag is in this category vs the whole corpus. 1 = same rate as everywhere; >1 = over-represented here; <1 = under-represented.",
  exclusive: "Exclusive: this tag only appears under this category among done domains.",
  tags: "Most common tags across done domains (above the min-count floor). Click a bar label to search.",
  languages: "Language codes on done domains (including null). Exact ISO 639-1 when set.",
  countries: "Country codes on done domains (including null). Exact ISO 3166-1 alpha-2 when set.",
  cooccur:
    "Pairwise tag association on done domains. Sort metric changes ranking only — all columns stay visible.",
  both: "Number of done domains that have both tags.",
  jaccard:
    "Overlap of the two tag sets: both ÷ (countA + countB − both). Near 1 = almost always together.",
  pairLift:
    "Co-occurrence vs independence: both ÷ expected. >1 means the tags attract each other.",
  pmi: "log₂ of the probability form of lift. Highlights surprising pairs, including rarer ones.",
  twins: "Very high Jaccard pairs — relational twins. Diagnose; do not auto-merge.",
  implies: "One tag nearly always appears when the other does (asymmetric). Hierarchy / qualifier signal.",
  similar:
    "Categories whose tag-count vectors point the same way (cosine). Near 1 = almost the same tag mix.",
  cosine: "Cosine similarity of tag weight vectors for the two categories (0–1).",
  shared: "How many distinct tags appear in both categories’ profiles.",
  lexical:
    "Name-only near-duplicates (hyphen/space/smashed). Safe merge candidates — unlike co-occurrence twins.",
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
  const [profileLoading, setProfileLoading] = useState(false);
  const [metric, setMetric] = useState("jaccard");
  const [minCount, setMinCount] = useState(50);
  const [tagFloor, setTagFloor] = useState(10000);
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
    setProfileLoading(true);
    setError(null);
    try {
      setProfile(await fetchAnalyzeCategoryProfile(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProfileLoading(false);
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
      {!overview && !error && <Spinner label="Loading labels…" />}

      {overview && (
        <>
          <p className="muted">
            Lexical near-dupes are merge candidates. Relational twins (high Jaccard) are{" "}
            <em>not</em> auto-merged — diagnose first.
          </p>

          <div className="analyze-split labels-cat-split">
            <section className="panel">
              <div className="panel-head">
                <PanelTitle tip={TIPS.categories}>Categories</PanelTitle>
              </div>
              <p className="muted small panel-desc">{TIPS.categories}</p>
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
                    <tr
                      key={c.id}
                      className={[
                        c.ignored ? "dim" : "",
                        profile?.id === c.id ? "row-on" : "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined}
                    >
                      <td>
                        <button
                          type="button"
                          className="linkish"
                          onClick={() => void loadProfile(c.id)}
                        >
                          {c.name}
                        </button>
                      </td>
                      <td>{fmt(c.domainCount)}</td>
                      <td className="actions icon-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          title={c.ignored ? "Unignore" : "Ignore"}
                          aria-label={c.ignored ? "Unignore" : "Ignore"}
                          disabled={busy === `categories-${c.id}`}
                          onClick={() => void toggleIgnore("categories", c.id, c.ignored)}
                        >
                          {c.ignored ? (
                            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                              <path
                                fill="currentColor"
                                d="M8 3C4.5 3 1.7 5.1.5 8c1.2 2.9 4 5 7.5 5s6.3-2.1 7.5-5C14.3 5.1 11.5 3 8 3zm0 8.2A3.2 3.2 0 1 1 8 4.8a3.2 3.2 0 0 1 0 6.4zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"
                              />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                              <path
                                fill="currentColor"
                                d="M2.1 1.4 1.4 2.1l2.2 2.2C2.3 5.3 1.2 6.5.5 8c1.2 2.9 4 5 7.5 5 1.4 0 2.7-.3 3.9-.9l2 2 .7-.7L2.1 1.4zM5.2 5.9l1.1 1.1A2 2 0 0 0 8 10a2 2 0 0 0 1.9-1.5l1.2 1.2A3.2 3.2 0 0 1 5.2 5.9zM8 3c3.5 0 6.3 2.1 7.5 5-.4 1-.9 1.8-1.7 2.5l-1.1-1.1A3.2 3.2 0 0 0 6.6 4.1L5.4 2.9C6.2 3.2 7.1 3 8 3z"
                              />
                            </svg>
                          )}
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Search"
                          aria-label={`Search ${c.name}`}
                          onClick={() => go(buildSearchUrl({ categoryId: c.id }))}
                        >
                          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                            <path
                              fill="currentColor"
                              d="M11.5 10.4a5.5 5.5 0 1 0-1.1 1.1l3 3 .7-.7-3-3zM6.5 11a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"
                            />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="panel">
              <div className="panel-head">
                <PanelTitle tip={TIPS.profile}>
                  Category profile
                  {profile ? (
                    <>
                      {" "}
                      · {profile.name}{" "}
                      <span className="muted">({fmt(profile.domainCount)})</span>
                    </>
                  ) : null}
                </PanelTitle>
              </div>
              <p className="muted small panel-desc">
                {TIPS.profile}{" "}
                <InfoTip text={TIPS.share} /> share{" "}
                <InfoTip text={TIPS.lift} /> lift{" "}
                <InfoTip text={TIPS.exclusive} /> exclusive
              </p>
              {profileLoading && <Spinner label="Loading profile…" />}
              {!profileLoading && !profile && (
                <p className="muted">Select a category to see its tag mix.</p>
              )}
              {!profileLoading && profile && (
                <BarList
                  max={Math.max(1, ...profile.tags.map((t) => t.count))}
                  rows={profile.tags.map((t) => ({
                    key: String(t.id),
                    name: t.name,
                    count: t.count,
                    badge: t.exclusive ? "exclusive" : undefined,
                    stats: `count: ${fmt(t.count)} · share: ${pct(t.share)} · lift: ${t.lift.toFixed(2)}`,
                    onClick: () => go(buildSearchUrl({ tagIds: [t.id] })),
                  }))}
                />
              )}
            </section>
          </div>

          <div className="dash-grid labels-tri-grid">
            <section className="panel">
              <div className="panel-head">
                <PanelTitle tip={TIPS.tags}>Tags</PanelTitle>
                
                <input
                    className="tag-floor-input"
                    type="number"
                    min={1}
                    value={tagFloor}
                    onChange={(e) => setTagFloor(Number(e.target.value) || 1)}
                  />
              </div>
              <p className="muted small panel-desc">{TIPS.tags}</p>
              
              <BarList
                max={Math.max(1, ...tags.slice(0, 30).map((t) => t.domainCount))}
                rows={tags.slice(0, 30).map((t) => ({
                  key: String(t.id),
                  name: t.name,
                  count: t.domainCount,
                  dim: t.ignored,
                  onClick: () => go(buildSearchUrl({ tagIds: [t.id] })),
                }))}
              />
            </section>

            <section className="panel">
              <PanelTitle tip={TIPS.languages}>Languages</PanelTitle>
              <p className="muted small panel-desc" style={{marginTop: '10px'}}>{TIPS.languages}</p>
              <BarList
                max={Math.max(1, ...overview.languages.map((l) => l.count))}
                rows={overview.languages.slice(0, 20).map((l) => ({
                  name: l.language,
                  count: l.count,
                }))}
              />
            </section>
            <section className="panel">
              <PanelTitle tip={TIPS.countries}>Countries</PanelTitle>
              <p className="muted small panel-desc" style={{marginTop: '10px'}}>{TIPS.countries}</p>
              <BarList
                max={Math.max(1, ...overview.countries.map((c) => c.count))}
                rows={overview.countries.slice(0, 20).map((c) => ({
                  name: c.country,
                  count: c.count,
                }))}
              />
            </section>
          </div>

          <section className="panel">
            <div className="panel-head">
              <PanelTitle tip={TIPS.cooccur}>Tag co-occurrence</PanelTitle>
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
            <p className="muted small panel-desc">{TIPS.cooccur}</p>
            <p className="muted small metric-blurb">{METRIC_BLURBS[metric]}</p>
            {!pairs && <Spinner label="Computing pairs…" />}
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
                      <th>
                        Both <InfoTip text={TIPS.both} />
                      </th>
                      <th>
                        Jaccard <InfoTip text={TIPS.jaccard} />
                      </th>
                      <th>
                        Lift <InfoTip text={TIPS.pairLift} />
                      </th>
                      <th>
                        PMI <InfoTip text={TIPS.pmi} />
                      </th>
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

                <h4>
                  Relational twins (Jaccard ≥ 0.85) <InfoTip text={TIPS.twins} />
                </h4>
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

                <h4>
                  Implications <InfoTip text={TIPS.implies} />
                </h4>
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
            <PanelTitle tip={TIPS.similar}>Categories with similar tag profiles</PanelTitle>
            <p className="muted small panel-desc">{TIPS.similar}</p>
            {!similarity && <Spinner label="Loading similarity…" />}
            {similarity && (
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>A</th>
                    <th>B</th>
                    <th>
                      Cosine <InfoTip text={TIPS.cosine} />
                    </th>
                    <th>
                      Shared tags <InfoTip text={TIPS.shared} />
                    </th>
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
            <PanelTitle tip={TIPS.lexical}>Lexical merge candidates</PanelTitle>
            <p className="muted small panel-desc">
              {TIPS.lexical} Copy the alias line into <code>data/label-aliases.txt</code> to keep
              merges reproducible.
            </p>
            {!lexical && <Spinner label="Loading lexical candidates…" />}
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
