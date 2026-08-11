import { useEffect, useRef, useState } from "react";
import { fetchWorkers, type WorkersData } from "./api";

const POLL_MS = 5000;
const RING_MAX = 120;
const STUCK_MS = 10 * 60 * 1000;
const CATEGORY_SPARKS = 6;

type Sample = {
  t: number;
  fetchQueue: number;
  lmBuffer: number;
  summarizing: number;
  done: number;
  failed: number;
  fill: number;
  doneDelta: number;
  failedDelta: number;
  oldestReadySec: number;
  oldestFetchingSec: number;
  oldestSummarizingSec: number;
  categoriesMinute: Record<string, number>;
};

function fmt(n: number): string {
  return n.toLocaleString();
}

function ageMs(iso: string | null): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const s = Math.floor(ageMs(iso) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function fmtSec(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function langLabel(code: string): string {
  if (code === "(unknown)") return "unknown";
  if (code === "mul") return "multiple";
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function Sparkline({
  values,
  label,
  unit,
}: {
  values: number[];
  label: string;
  unit?: string;
}) {
  const w = 280;
  const h = 56;
  const pad = 2;
  if (values.length < 2) {
    return (
      <div className="spark">
        <header>
          <h3>{label}</h3>
          <em>collecting…</em>
        </header>
        <svg className="spark-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
          <line x1={pad} y1={h / 2} x2={w - pad} y2={h / 2} className="spark-base" />
        </svg>
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = values[values.length - 1]!;
  const lastLabel =
    unit === "%"
      ? `${last.toFixed(0)}%`
      : unit === "s"
        ? fmtSec(last)
        : fmt(Math.round(last));

  return (
    <div className="spark">
      <header>
        <h3>{label}</h3>
        <em>
          {lastLabel}
          {min !== max ? ` · ${fmt(Math.round(min))}–${fmt(Math.round(max))}` : ""}
        </em>
      </header>
      <svg className="spark-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
        <polyline points={pts} className="spark-line" fill="none" />
      </svg>
    </div>
  );
}

function BarList({
  rows,
  max,
}: {
  rows: { name: string; count: number; hint?: string }[];
  max: number;
}) {
  const width = Math.max(max, 1);
  return (
    <ul className="bar-list">
      {rows.map((row) => (
        <li key={row.name}>
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

function categoriesMinuteMap(data: WorkersData): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of data.doneByCategory) {
    if (row.minute > 0) out[row.name] = row.minute;
  }
  return out;
}

function toSample(data: WorkersData, prev: Sample | null): Sample {
  const fetchQueue = data.stats.pending + data.stats.fetching;
  const lmBuffer = data.stats.ready + data.stats.summarizing;
  const fill = Math.min(1, lmBuffer / Math.max(1, data.fetchMaxReady));
  const doneDelta = prev ? Math.max(0, data.stats.done - prev.done) : 0;
  const failedDelta = prev ? Math.max(0, data.stats.failed - prev.failed) : 0;
  return {
    t: Date.now(),
    fetchQueue,
    lmBuffer,
    summarizing: data.stats.summarizing,
    done: data.stats.done,
    failed: data.stats.failed,
    fill,
    doneDelta,
    failedDelta,
    oldestReadySec: ageMs(data.queueAge.oldestReady) / 1000,
    oldestFetchingSec: ageMs(data.queueAge.oldestFetching) / 1000,
    oldestSummarizingSec: ageMs(data.queueAge.oldestSummarizing) / 1000,
    categoriesMinute: categoriesMinuteMap(data),
  };
}

function topCategories(data: WorkersData, n: number): string[] {
  return [...data.doneByCategory]
    .sort((a, b) => b.minute - a.minute || b.fifteen - a.fifteen)
    .slice(0, n)
    .map((r) => r.name);
}

export function Workers() {
  const [data, setData] = useState<WorkersData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const prevRef = useRef<Sample | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const next = await fetchWorkers();
        if (!alive) return;
        const sample = toSample(next, prevRef.current);
        prevRef.current = sample;
        setData(next);
        setSamples((prev) => {
          const ring = [...prev, sample];
          return ring.length > RING_MAX ? ring.slice(ring.length - RING_MAX) : ring;
        });
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
    }, POLL_MS);
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
    return <p className="muted">Loading workers…</p>;
  }

  if (!data) {
    return <p className="error">{error}</p>;
  }

  const { stats, throughput, failedThroughput, fetchMaxReady, queueAge } = data;
  const fetchQueue = stats.pending + stats.fetching;
  const lmBuf = stats.ready + stats.summarizing;
  const fill = Math.min(1, lmBuf / Math.max(1, fetchMaxReady));
  const lmPct = fill * 100;
  const last = samples[samples.length - 1];
  const doneDelta = last?.doneDelta ?? 0;
  const failedDelta = last?.failedDelta ?? 0;
  const ratePerMin =
    last && samples.length >= 2
      ? (doneDelta / (POLL_MS / 1000)) * 60
      : throughput.minute;

  const capped = fill >= 0.95;
  const starveRisk = fill <= 0.05 && fetchQueue > 0;
  const stuck =
    ageMs(queueAge.oldestFetching) >= STUCK_MS ||
    ageMs(queueAge.oldestSummarizing) >= STUCK_MS;

  const flags: { key: string; label: string; cls: string }[] = [];
  if (capped) flags.push({ key: "capped", label: "Capped", cls: "flag-capped" });
  if (starveRisk) flags.push({ key: "starve", label: "Starve risk", cls: "flag-starve" });
  if (stuck) flags.push({ key: "stuck", label: "Stuck", cls: "flag-stuck" });
  if (flags.length === 0) flags.push({ key: "ok", label: "Healthy", cls: "flag-ok" });

  const priMax = Math.max(
    1,
    ...data.pendingByPriority.map((r) => r.count),
    ...data.readyByPriority.map((r) => r.count),
  );

  const catMinuteMax = Math.max(1, ...data.doneByCategory.map((r) => r.minute));
  const catFifteenMax = Math.max(1, ...data.doneByCategory.map((r) => r.fifteen));
  const langFifteenMax = Math.max(1, ...data.doneByLanguage.map((r) => r.fifteen));
  const skipFifteenMax = Math.max(
    1,
    data.noLmSkips.empty.fifteen,
    data.noLmSkips.parked.fifteen,
  );
  const failErrMax = Math.max(1, ...data.failedByError.map((r) => r.count));
  const noLmFifteen = data.noLmSkips.empty.fifteen + data.noLmSkips.parked.fifteen;
  const sparkCats = topCategories(data, CATEGORY_SPARKS);

  return (
    <div className="dash">
      {error && <p className="error">{error}</p>}
      <p className="dash-live muted">
        session charts · 5s poll · refresh clears history
        {updated ? ` · ${updated.toLocaleTimeString()}` : ""}
        {samples.length ? ` · ${samples.length} samples` : ""}
      </p>

      <div className="worker-flags">
        {flags.map((f) => (
          <span key={f.key} className={`worker-flag ${f.cls}`}>
            {f.label}
          </span>
        ))}
      </div>

      <section className="kpis">
        <article className="kpi">
          <span>Fetch queue</span>
          <strong>{fmt(fetchQueue)}</strong>
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
          <em>
            {lmPct.toFixed(0)}% fill · {fmt(stats.ready)} ready · {fmt(stats.summarizing)} summarizing
          </em>
        </article>
        <article className="kpi">
          <span>Throughput</span>
          <strong>
            {fmt(Math.round(ratePerMin))}
            <small>/min</small>
          </strong>
          <em>
            Δ {fmt(doneDelta)} / poll · window {fmt(throughput.minute)}/min ·{" "}
            {fmt(throughput.fifteen)} / 15m
          </em>
        </article>
        <article className="kpi">
          <span>Failed</span>
          <strong>{fmt(failedThroughput.minute)}</strong>
          <em>
            last min · Δ {fmt(failedDelta)} / poll · {fmt(failedThroughput.fifteen)} / 15m ·{" "}
            {fmt(stats.failed)} total
          </em>
        </article>
        <article className="kpi">
          <span>In-flight LM</span>
          <strong>{fmt(stats.summarizing)}</strong>
          <em>
            {queueAge.oldestSummarizing
              ? `oldest ${ago(queueAge.oldestSummarizing)}`
              : "none claimed"}
            {queueAge.oldestReady ? ` · ready ${ago(queueAge.oldestReady)}` : ""}
          </em>
        </article>
      </section>

      <section className="panel">
        <header>
          <h2>Pipeline trends</h2>
          <em>this tab only</em>
        </header>
        <div className="spark-grid">
          <Sparkline label="Fetch queue" values={samples.map((s) => s.fetchQueue)} />
          <Sparkline label="LM fill" values={samples.map((s) => s.fill * 100)} unit="%" />
          <Sparkline label="Summarizing" values={samples.map((s) => s.summarizing)} />
          <Sparkline label="Done Δ / poll" values={samples.map((s) => s.doneDelta)} />
          <Sparkline label="Failed Δ / poll" values={samples.map((s) => s.failedDelta)} />
          <Sparkline
            label="Oldest ready"
            values={samples.map((s) => s.oldestReadySec)}
            unit="s"
          />
        </div>
      </section>

      <section className="panel">
        <header>
          <h2>Category mix</h2>
          <em>completed rows · rolling windows</em>
        </header>
        <div className="dash-grid">
          <article>
            <header className="subhead">
              <h3>Last minute</h3>
              <em>{fmt(throughput.minute)} total</em>
            </header>
            {data.doneByCategory.filter((r) => r.minute > 0).length === 0 ? (
              <p className="muted">Nothing in the last minute.</p>
            ) : (
              <BarList
                max={catMinuteMax}
                rows={data.doneByCategory
                  .filter((r) => r.minute > 0)
                  .map((r) => ({ name: r.name, count: r.minute }))}
              />
            )}
          </article>
          <article>
            <header className="subhead">
              <h3>Last 15 minutes</h3>
              <em>{fmt(throughput.fifteen)} total</em>
            </header>
            {data.doneByCategory.length === 0 ? (
              <p className="muted">Nothing in the last 15 minutes.</p>
            ) : (
              <BarList
                max={catFifteenMax}
                rows={data.doneByCategory.map((r) => ({
                  name: r.name,
                  count: r.fifteen,
                  hint: r.minute > 0 ? `${r.minute}/min` : undefined,
                }))}
              />
            )}
          </article>
        </div>
      </section>

      {sparkCats.length > 0 && (
        <section className="panel">
          <header>
            <h2>Category trends</h2>
            <em>1m window each poll · session only</em>
          </header>
          <div className="spark-grid">
            {sparkCats.map((name) => (
              <Sparkline
                key={name}
                label={name}
                values={samples.map((s) => s.categoriesMinute[name] ?? 0)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="dash-grid">
        <article className="panel">
          <header>
            <h2>Language mix</h2>
            <em>last 15m</em>
          </header>
          {data.doneByLanguage.length === 0 ? (
            <p className="muted">Nothing in the last 15 minutes.</p>
          ) : (
            <BarList
              max={langFifteenMax}
              rows={data.doneByLanguage.map((r) => ({
                name: langLabel(r.language),
                count: r.fifteen,
                hint: r.minute > 0 ? `${r.minute}/min · ${r.language}` : r.language,
              }))}
            />
          )}
        </article>

        <article className="panel">
          <header>
            <h2>No-LM skips</h2>
            <em>{fmt(noLmFifteen)} / 15m · empty + parked</em>
          </header>
          {noLmFifteen === 0 ? (
            <p className="muted">No empty/parked skips in the last 15 minutes.</p>
          ) : (
            <BarList
              max={skipFifteenMax}
              rows={[
                {
                  name: "empty",
                  count: data.noLmSkips.empty.fifteen,
                  hint:
                    data.noLmSkips.empty.minute > 0
                      ? `${data.noLmSkips.empty.minute}/min`
                      : undefined,
                },
                {
                  name: "parked",
                  count: data.noLmSkips.parked.fifteen,
                  hint:
                    data.noLmSkips.parked.minute > 0
                      ? `${data.noLmSkips.parked.minute}/min`
                      : undefined,
                },
              ]}
            />
          )}
        </article>
      </section>

      <section className="panel">
        <header>
          <h2>Failed by error</h2>
          <em>{fmt(failedThroughput.fifteen)} / 15m</em>
        </header>
        {data.failedByError.length === 0 ? (
          <p className="muted">No failures in the last 15 minutes.</p>
        ) : (
          <BarList
            max={failErrMax}
            rows={data.failedByError.map((r) => ({ name: r.error, count: r.count }))}
          />
        )}
      </section>

      <section className="dash-grid">
        <article className="panel">
          <header>
            <h2>Recent completions</h2>
            <em>log substitute</em>
          </header>
          {data.recentDone.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <ul className="feed">
              {data.recentDone.map((row) => (
                <li key={row.id}>
                  <strong>{row.host}</strong>
                  <span>
                    [{row.categoryName ?? "?"}]
                    {row.name ? ` ${row.name}` : ""}
                    {row.processedAt ? ` · ${ago(row.processedAt)} ago` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="panel">
          <header>
            <h2>Pending by source</h2>
            <em>{fmt(stats.pending)}</em>
          </header>
          {data.pendingBySource.length === 0 ? (
            <p className="muted">Fetch queue empty.</p>
          ) : (
            <BarList
              max={Math.max(...data.pendingBySource.map((r) => r.count))}
              rows={data.pendingBySource.map((r) => ({ name: r.source, count: r.count }))}
            />
          )}
        </article>
      </section>

      <section className="dash-grid">
        <article className="panel">
          <header>
            <h2>Pending by priority</h2>
            <em>{fmt(stats.pending)}</em>
          </header>
          {data.pendingByPriority.length === 0 ? (
            <p className="muted">Empty</p>
          ) : (
            <ul className="bar-list">
              {data.pendingByPriority.map((row) => (
                <li key={`p-${row.priority}`}>
                  <div className="bar-meta">
                    <span>p{row.priority}</span>
                    <em>{fmt(row.count)}</em>
                  </div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${(row.count / priMax) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
        <article className="panel">
          <header>
            <h2>Ready by priority</h2>
            <em>{fmt(stats.ready)}</em>
          </header>
          {data.readyByPriority.length === 0 ? (
            <p className="muted">Empty</p>
          ) : (
            <ul className="bar-list">
              {data.readyByPriority.map((row) => (
                <li key={`r-${row.priority}`}>
                  <div className="bar-meta">
                    <span>p{row.priority}</span>
                    <em>{fmt(row.count)}</em>
                  </div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${(row.count / priMax) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    </div>
  );
}
