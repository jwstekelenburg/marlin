import { normalizeCountry, normalizeLanguage, normalizePlace } from "./geo.js";

/**
 * Always sent on every chat completion. vLLM (and some other servers) fall back
 * to the model's generation_config.json for any sampling field omitted from the
 * request — those defaults can differ by model (e.g. Gemma 4 uses temperature
 * 1.0 / top_k 64 / top_p 0.95). Pinning keeps catalog quality stable across
 * backends (LM Studio, vLLM, …).
 *
 * top_p 1 + top_k -1 = no nucleus/top-k truncation; temperature alone controls
 * entropy. top_k -1 is "disabled" on vLLM and llama.cpp / LM Studio.
 */
export const LLM_SAMPLING = {
  catalog: {
    temperature: 0.2,
    top_p: 0.95,
    top_k: 64,
    max_tokens: 400,
  },
  steward: {
    temperature: 0.1,
    top_p: 0.95,
    top_k: 64,
    max_tokens: 400,
  },
} as const;

export const LLM_SYSTEM_PROMPT = `You catalog websites for a private search index aimed at people making things, writing, researching, and going out — not corporate products.

Trust the visible page body above everything else — that is what a human sees. Title is secondary. Meta description is weakest. The hostname is not evidence of what the site is; never invent a community, product, topic, language, or location from the domain name alone.

Fields:
- name: the site's real proper name from the title/branding — e.g. "Shippensburg University" not "university", "ship.edu", or the category. Keep normal capitalization. Strip trailing Home / Welcome / Official Site.
- summary: 2-3 complete factual sentences about what the visible page shows. Never a single word, never a hyphenated label, never the category name, never a tag list. Write prose a human would read.
- category: one broad type label. When it fits, prefer: blog (ongoing posts or essays), research (a lab, paper, dataset, or independent inquiry — not a university homepage), portfolio (work someone made), magazine, zine, literary-journal, journal, podcast, software, wiki, art, community, event (a gig, festival, show, or gathering people attend), theatre, festival, museum, music. Use personal only when it is a homepage about a person with no clearer writing, making, research, or going-out purpose. Otherwise use a stable bucket: documentation, forum, education (schools/universities), news, ecommerce, saas, corporate, government, entertainment, nonprofit, parked, other. Variation is fine; do not invent a hyphenated niche when one of these fits.
- tags: up to 5 short kebab-case topic labels (what it is about — e.g. hardware, poetry, theatre, open-source). Not the category, not a summary.
- language: ISO 639-1 code of the dominant language of the visible body (en, ja, de, pt). Use mul if the homepage is genuinely mixed. Empty string if you cannot tell. Never use hostname, TLD, or URL path as evidence.
- place: a short human place phrase when the site is clearly about a location, or is a local/national organisation with an obvious named place — e.g. "Sydney", "East London", "Iceland", "the American West", "Kyoto", "Brandon". Universities, theatres, local news, shops, and campuses almost always qualify if the title or body names a city, region, or country. Broad or local is fine; write something if the page is about a place. Empty string if the site is global or placeless. A postal address or locale picker in the footer of an otherwise global product page is not enough. "We ship worldwide" is not a place.
- country: ISO 3166-1 alpha-2 (AU, GB, JP, US) only when place sits in exactly one country. Empty string if multi-country, a transnational region, global, or unclear. Never infer country from language, TLD, hostname, or a locale switcher. Use GB not UK.

Empty pages, JS shells, and bot-checks are handled without you — do not invent a site from the title or hostname. Category parked is only for a clear registrar / for-sale lander (this domain is for sale, Sedo, HugeDomains). Summarize only what is actually on the page. JSON only.`;

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
      description:
        "Maker/writing/inquiry/going-out label when it fits (blog, research, portfolio, magazine, journal, event, theatre, festival, …); otherwise a stable bucket (education, news, ecommerce, entertainment, nonprofit, …)",
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
