import "dotenv/config";
import cors from "@fastify/cors";
import Fastify from "fastify";
import {
  analyzeCategoryProfile,
  analyzeCategorySimilarity,
  analyzeLabelsOverview,
  analyzeLexicalCandidates,
  analyzeOverview,
  analyzePlatformDetail,
  analyzePlatforms,
  analyzeSteward,
  analyzeTagPairs,
  applyMerges,
  blockApex,
  dashboardSnapshot,
  domainStats,
  labelsByIds,
  listLabels,
  listSpiralCandidates,
  pipelineSnapshot,
  planOneMerge,
  pool,
  searchDomains,
  setLabelIgnored,
  typeaheadCountries,
  typeaheadLabels,
  typeaheadLanguages,
  unblockApex,
  type TagPairMetric,
} from "@marlin/db";

const port = Number(process.env.API_PORT ?? 3000);

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get("/api/health", async () => ({ ok: true }));

app.get("/api/stats", async () => domainStats());

app.get("/api/dashboard", async () => {
  const snap = await dashboardSnapshot();
  return {
    ...snap,
    fetchMaxReady: Math.max(1, Number(process.env.FETCH_MAX_READY ?? 500) || 500),
  };
});

app.get("/api/workers", async () => {
  const snap = await pipelineSnapshot();
  return {
    ...snap,
    fetchMaxReady: Math.max(1, Number(process.env.FETCH_MAX_READY ?? 500) || 500),
  };
});

function parseIds(raw: string | undefined): number[] {
  return (raw ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

app.get("/api/search", async (req) => {
  const q = req.query as Record<string, string | undefined>;
  return searchDomains({
    q: q.q,
    categoryId: q.categoryId ? Number(q.categoryId) : undefined,
    tagIds: parseIds(q.tagIds),
    country: q.country,
    language: q.language,
    limit: q.limit ? Number(q.limit) : undefined,
    offset: q.offset ? Number(q.offset) : undefined,
  });
});

app.get("/api/countries", async (req) => {
  const q = (req.query as { q?: string }).q ?? "";
  return typeaheadCountries(q, q ? 20 : 50);
});

app.get("/api/languages", async (req) => {
  const q = (req.query as { q?: string }).q ?? "";
  return typeaheadLanguages(q, q ? 20 : 50);
});

app.get("/api/categories", async (req) => {
  const q = req.query as { q?: string; ids?: string };
  const ids = parseIds(q.ids);
  if (ids.length) return labelsByIds("category", ids);
  return typeaheadLabels("category", q.q ?? "", q.q ? 20 : 200);
});

app.get("/api/tags", async (req) => {
  const q = req.query as { q?: string; ids?: string };
  const ids = parseIds(q.ids);
  if (ids.length) return labelsByIds("tag", ids);
  return typeaheadLabels("tag", q.q ?? "", q.q ? 20 : 200);
});

app.get("/api/ignore-options", async () => ({
  categories: await listLabels("category"),
  tags: await listLabels("tag"),
}));

app.patch("/api/categories/:id", async (req, reply) => {
  const id = Number((req.params as { id: string }).id);
  const ignored = Boolean((req.body as { ignored?: boolean }).ignored);
  const row = await setLabelIgnored("category", id, ignored);
  if (!row) return reply.code(404).send({ error: "not found" });
  return row;
});

app.patch("/api/tags/:id", async (req, reply) => {
  const id = Number((req.params as { id: string }).id);
  const ignored = Boolean((req.body as { ignored?: boolean }).ignored);
  const row = await setLabelIgnored("tag", id, ignored);
  if (!row) return reply.code(404).send({ error: "not found" });
  return row;
});

app.get("/api/analyze", async () => analyzeOverview());

app.get("/api/analyze/platforms", async (req) => {
  const q = req.query as { limit?: string; q?: string; minSubdomains?: string };
  return analyzePlatforms({
    limit: q.limit ? Number(q.limit) : undefined,
    q: q.q,
    minSubdomains: q.minSubdomains != null ? Number(q.minSubdomains) : undefined,
  });
});

app.get("/api/analyze/platforms/:apex", async (req, reply) => {
  const apex = decodeURIComponent((req.params as { apex: string }).apex);
  const detail = await analyzePlatformDetail(apex);
  if (!detail) return reply.code(404).send({ error: "not found" });
  return detail;
});

app.get("/api/analyze/labels", async () => analyzeLabelsOverview());

app.get("/api/analyze/labels/tag-pairs", async (req) => {
  const q = req.query as { minCount?: string; metric?: string; limit?: string };
  const metric = (q.metric ?? "jaccard") as TagPairMetric;
  return analyzeTagPairs({
    minCount: q.minCount ? Number(q.minCount) : undefined,
    metric: ["count", "jaccard", "lift", "pmi"].includes(metric) ? metric : "jaccard",
    limit: q.limit ? Number(q.limit) : undefined,
  });
});

app.get("/api/analyze/labels/categories/:id", async (req, reply) => {
  const id = Number((req.params as { id: string }).id);
  const profile = await analyzeCategoryProfile(id);
  if (!profile) return reply.code(404).send({ error: "not found" });
  return profile;
});

app.get("/api/analyze/labels/category-similarity", async (req) => {
  const limit = Number((req.query as { limit?: string }).limit);
  return analyzeCategorySimilarity(Number.isFinite(limit) ? limit : undefined);
});

app.get("/api/analyze/labels/lexical", async (req) => {
  const limit = Number((req.query as { limit?: string }).limit);
  return analyzeLexicalCandidates(Number.isFinite(limit) ? limit : undefined);
});

app.post("/api/analyze/labels/merge", async (req, reply) => {
  const body = req.body as {
    kind?: string;
    from?: string;
    to?: string;
    apply?: boolean;
  };
  if (body.kind !== "tag" && body.kind !== "category") {
    return reply.code(400).send({ error: "kind must be tag or category" });
  }
  if (!body.from?.trim() || !body.to?.trim()) {
    return reply.code(400).send({ error: "from and to required" });
  }
  const plan = await planOneMerge(body.kind, body.from, body.to);
  if (plan.action === "missing") {
    return reply.code(400).send({ error: "merge not actionable", plan });
  }
  if (!body.apply) {
    return { applied: false, plan };
  }
  const n = await applyMerges([plan]);
  return { applied: true, count: n, plan };
});

app.get("/api/analyze/steward", async (req) => {
  const q = req.query as {
    source?: string;
    q?: string;
    blockLimit?: string;
    reviewLimit?: string;
    candidateLimit?: string;
  };
  const candidateLimit = q.candidateLimit ? Number(q.candidateLimit) : 40;
  const [steward, candidates] = await Promise.all([
    analyzeSteward({
      source: q.source,
      q: q.q,
      blockLimit: q.blockLimit ? Number(q.blockLimit) : undefined,
      reviewLimit: q.reviewLimit ? Number(q.reviewLimit) : undefined,
    }),
    listSpiralCandidates(
      Number.isFinite(candidateLimit) ? Math.min(Math.max(candidateLimit, 1), 100) : 40,
    ),
  ]);
  return { ...steward, candidates };
});
app.delete("/api/analyze/steward/blocks/:apex", async (req, reply) => {
  const apex = decodeURIComponent((req.params as { apex: string }).apex);
  const result = await unblockApex(apex);
  if (!result.ok) return reply.code(404).send({ error: "not blocked", apex: result.apex });
  return result;
});

app.post("/api/analyze/steward/blocks", async (req, reply) => {
  const body = req.body as { apex?: string; reason?: string };
  if (!body.apex?.trim()) return reply.code(400).send({ error: "apex required" });
  try {
    const result = await blockApex({
      apex: body.apex,
      reason: body.reason?.trim() || "manual block from Analyze UI",
      source: "steward",
    });
    return { ok: true, apex: body.apex.trim().toLowerCase(), ...result };
  } catch (err) {
    return reply.code(400).send({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port, host: "0.0.0.0" });
