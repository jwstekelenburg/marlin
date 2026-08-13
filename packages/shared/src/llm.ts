/**
 * Catalog LM: fixed JSON schema + parse helpers.
 * Prompt / sampling / textChars live in `data/catalog-policies.json` (see catalog-policy.ts).
 *
 * Always send sampling fields on every chat completion. vLLM (and some other servers)
 * fall back to the model's generation_config.json for any sampling field omitted from
 * the request — those defaults can differ by model (e.g. Gemma 4 uses temperature
 * 1.0 / top_k 64 / top_p 0.95). Pinning keeps catalog quality stable across backends.
 *
 * top_p 1 + top_k -1 = no nucleus/top-k truncation; temperature alone controls
 * entropy. top_k -1 is "disabled" on vLLM and llama.cpp / LM Studio.
 */

import { normalizeCountry, normalizeLanguage, normalizePlace } from "./geo.js";

export const LLM_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: {
      type: "string",
      description:
        'Proper site name from the page title (e.g. "Shippensburg University"). Not a generic type word like university/blog/shop, and not just the hostname.',
    },
    summary: {
      type: "string",
      description:
        "2-3 complete factual sentences (not a label). What the site is, what it offers, who it is for. Must not be the category or a tag.",
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
    language: {
      type: "string",
      description:
        "ISO 639-1 code of the dominant visible body language (en, ja, pt). mul if genuinely mixed. Empty string if unknown. Not from hostname or TLD.",
    },
    place: {
      type: "string",
      description:
        'Short place phrase if the page is about a location or a local/national org names one (Sydney, Iceland, Kyoto, Brandon). Universities and local news count. Empty if global. Not from hostname. Ignore footer-only addresses on product sites.',
    },
    country: {
      type: "string",
      description:
        "ISO 3166-1 alpha-2 (AU, GB, JP, US) only when place is in exactly one country. Empty if multi-country, global, or unclear. Never infer from language, TLD, hostname, or locale switcher. GB not UK.",
    },
  },
  required: ["name", "summary", "category", "tags", "language", "place", "country"],
} as const;

export type LlmCatalogResult = {
  name: string;
  summary: string;
  category: string;
  tags: string[];
  language: string | null;
  place: string | null;
  country: string | null;
};

export function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True when the model stuffed a category/tag stub into summary instead of prose. */
export function isWeakSummary(
  summary: string,
  category = "",
  tags: string[] = [],
): boolean {
  const s = summary.trim();
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 8) return true;

  const lower = normalizeLabel(s);
  const cat = normalizeLabel(category);
  if (cat && (lower === cat || lower === cat.replace(/\s+/g, "-"))) return true;

  for (const tag of tags) {
    const t = normalizeLabel(tag);
    if (!t) continue;
    if (lower === t || lower === t.replace(/\s+/g, "-")) return true;
  }

  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(s) && words.length <= 3) return true;
  return false;
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

  return {
    name: name || "",
    summary,
    category,
    tags,
    language: normalizeLanguage(typeof obj.language === "string" ? obj.language : ""),
    place: normalizePlace(typeof obj.place === "string" ? obj.place : ""),
    country: normalizeCountry(typeof obj.country === "string" ? obj.country : ""),
  };
}
