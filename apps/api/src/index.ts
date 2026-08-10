import "dotenv/config";
import cors from "@fastify/cors";
import Fastify from "fastify";
import {
  dashboardSnapshot,
  domainStats,
  listLabels,
  pool,
  searchDomains,
  setLabelIgnored,
  typeaheadCountries,
  typeaheadLabels,
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

app.get("/api/search", async (req) => {
  const q = req.query as Record<string, string | undefined>;
  const tagIds = (q.tagIds ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  return searchDomains({
    q: q.q,
    categoryId: q.categoryId ? Number(q.categoryId) : undefined,
    tagIds,
    country: q.country,
    limit: q.limit ? Number(q.limit) : undefined,
    offset: q.offset ? Number(q.offset) : undefined,
  });
});

app.get("/api/countries", async (req) => {
  const q = (req.query as { q?: string }).q ?? "";
  return typeaheadCountries(q, q ? 20 : 50);
});

app.get("/api/categories", async (req) => {
  const q = (req.query as { q?: string }).q ?? "";
  return typeaheadLabels("category", q, q ? 20 : 200);
});

app.get("/api/tags", async (req) => {
  const q = (req.query as { q?: string }).q ?? "";
  return typeaheadLabels("tag", q, q ? 20 : 200);
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

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port, host: "0.0.0.0" });
