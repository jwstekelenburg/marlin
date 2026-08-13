import "dotenv/config";
import {
  blockApex,
  bootstrapBlockedApexesFromFile,
  dropBlockedApexQueue,
  listSpiralCandidates,
  pool,
  recordApexReview,
  refreshBlockedApexGate,
  sampleDoneHostsForApex,
} from "@marlin/db";
import { log, resolveWorkerProfile, envInt } from "@marlin/shared";
import { judgeSpiralApex } from "./lm.js";

const profile = resolveWorkerProfile({ argv: process.argv });
const pollMs = envInt("STEWARD_POLL_MS", 60_000);
const batchLimit = envInt("STEWARD_BATCH", 10);
const sampleFirst = envInt("STEWARD_SAMPLE", 5);
const sampleExtra = envInt("STEWARD_SAMPLE_EXTRA", 5);

async function reviewOne(candidate: Awaited<ReturnType<typeof listSpiralCandidates>>[number]) {
  const first = await sampleDoneHostsForApex(candidate.apex, sampleFirst);
  if (first.length === 0) {
    if (candidate.hotelName && candidate.hosts >= 50) {
      const reason =
        "Hotel-named apex at subdomain-cap scale with no usable done samples — treated as a microsite mill";
      const { dropped } = await blockApex({
        apex: candidate.apex,
        reason,
        source: "steward",
        evidence: {
          hosts: candidate.hosts,
          done: candidate.done,
          hotelName: true,
          sampleHosts: [],
        },
        sampleSize: 0,
      });
      log.info(`steward BLOCK ${candidate.apex} dropped=${dropped} hosts=${candidate.hosts}: ${reason}`);
      return;
    }
    log.noisy(`steward skip ${candidate.apex}: no done samples yet (${candidate.hosts} hosts)`);
    return;
  }

  let samples = first;
  let judgment = await judgeSpiralApex({
    apex: candidate.apex,
    hosts: candidate.hosts,
    done: candidate.done,
    samples,
    lm: profile,
  });

  if (judgment.verdict === "unsure") {
    const more = await sampleDoneHostsForApex(candidate.apex, sampleFirst + sampleExtra);
    samples = more;
    judgment = await judgeSpiralApex({
      apex: candidate.apex,
      hosts: candidate.hosts,
      done: candidate.done,
      samples,
      lm: profile,
    });
    if (judgment.verdict === "unsure") {
      judgment = { verdict: "keep", reason: `${judgment.reason} (still unsure after ${samples.length} samples)` };
    }
  }

  const evidence = {
    hosts: candidate.hosts,
    done: candidate.done,
    junkDone: candidate.junkDone,
    spamLangDone: candidate.spamLangDone,
    hotelName: candidate.hotelName,
    sampleHosts: samples.map((s) => s.host),
  };

  if (judgment.verdict === "block") {
    const { dropped } = await blockApex({
      apex: candidate.apex,
      reason: judgment.reason,
      source: "steward",
      evidence,
      sampleSize: samples.length,
    });
    log.info(
      `steward BLOCK ${candidate.apex} dropped=${dropped} hosts=${candidate.hosts}: ${judgment.reason}`,
    );
    return;
  }

  await recordApexReview({
    apex: candidate.apex,
    verdict: "keep",
    reason: judgment.reason,
    sampleSize: samples.length,
    evidence,
  });
  log.info(`steward keep ${candidate.apex} hosts=${candidate.hosts}: ${judgment.reason}`);
}

async function pass(): Promise<number> {
  await refreshBlockedApexGate();
  const candidates = await listSpiralCandidates(batchLimit);
  if (candidates.length === 0) return 0;
  log.info(`steward reviewing ${candidates.length} candidate apex(es)`);
  for (const c of candidates) {
    try {
      await reviewOne(c);
    } catch (err) {
      log.warn(`steward failed ${c.apex}:`, err);
    }
  }
  return candidates.length;
}

const seeded = await bootstrapBlockedApexesFromFile();
if (seeded > 0) log.info(`steward seeded ${seeded} blocked_apexes from file`);

const blockedDropped = await dropBlockedApexQueue();
if (blockedDropped > 0) log.info(`steward dropped ${blockedDropped} unfinished blocked-apex row(s)`);

log.info(
  `steward starting profile=${profile.name} lm=${profile.lm} model=${profile.model || "(auto)"} ` +
    `url=${profile.baseUrl} poll=${pollMs}ms batch=${batchLimit}`,
);

while (true) {
  try {
    const n = await pass();
    if (n === 0) await new Promise((r) => setTimeout(r, pollMs));
    else await new Promise((r) => setTimeout(r, Math.min(pollMs, 5_000)));
  } catch (err) {
    log.error("steward loop error:", err);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

await pool.end();
