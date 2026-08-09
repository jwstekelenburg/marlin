export const LLM_SYSTEM_PROMPT = `You catalog websites for a private search index. Classify by primary purpose, not marketing copy. Use a single broad category and up to 5 short tags. Prefer stable everyday labels when they fit (ecommerce, social-media, news, politics, blog, documentation, saas, corporate, education, government, forum, entertainment, personal, parked, other). Variation is fine. If the page is empty, parked, or an error, still do your best. JSON only.`;

export const LLM_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: {
      type: "string",
      description: "Short human site name",
    },
    summary: {
      type: "string",
      description: "2-3 factual sentences about what the site is and who it is for",
    },
    category: {
      type: "string",
      description: "One broad category label",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      maxItems: 5,
      description: "Up to 5 short tags",
    },
  },
  required: ["name", "summary", "category", "tags"],
} as const;

export type LlmCatalogResult = {
  name: string;
  summary: string;
  category: string;
  tags: string[];
};

export function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseCatalogResult(raw: unknown): LlmCatalogResult {
  if (!raw || typeof raw !== "object") throw new Error("LLM result is not an object");
  const obj = raw as Record<string, unknown>;

  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  const category = typeof obj.category === "string" ? normalizeLabel(obj.category) : "";

  const tagsRaw = Array.isArray(obj.tags) ? obj.tags : [];
  const tags = [
    ...new Set(
      tagsRaw
        .filter((t): t is string => typeof t === "string")
        .map(normalizeLabel)
        .filter(Boolean),
    ),
  ].slice(0, 5);

  if (!summary) throw new Error("LLM result missing summary");
  if (!category) throw new Error("LLM result missing category");

  return { name: name || "", summary, category, tags };
}
