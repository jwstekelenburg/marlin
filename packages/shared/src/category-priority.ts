import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crawlPriorityAdjustForLanguage } from "./language-priority.js";
import { normalizeLabel } from "./llm.js";

export type CategoryPriorityConfig = {
  seed: number;
  default: number;
  categories: Record<string, number>;
};

/** Used when `data/category-priority.txt` is missing. Keep in sync with that file. */
export const DEFAULT_CATEGORY_PRIORITY: CategoryPriorityConfig = {
  seed: 50,
  default: 0,
  categories: {
    portfolio: 40,
    "art-portfolio": 40,
    art: 35,
    hobby: 35,
    comics: 30,
    community: 28,
    software: 24,
    magazine: 22,
    wiki: 22,
    research: 22,
    journal: 20,
    event: 20,
    theatre: 28,
    festival: 24,
    museum: 16,
    forum: -12,
    "fan-site": 0,
    blog: 18,
    personal: 6,
    entertainment: 4,
    education: -5,
    conference: -10,
    government: -8,
    organization: -8,
    news: -12,
    media: -12,
    sports: -10,
    "social-media": -15,
    saas: -18,
    documentation: -18,
    ecommerce: -20,
    retail: -20,
    corporate: -25,
    parked: -30,
    empty: -30,
    gambling: -40,
    hotel: -20,
    restaurant: -15,
    healthcare: -15,
    finance: -20,
    "real-estate": -20,
    "travel-booking": -20,
    "job-board": -15,
    dating: -20,
  },
};

let cached: CategoryPriorityConfig | null = null;

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function parseCategoryPriorityFile(text: string): CategoryPriorityConfig {
  const categories: Record<string, number> = {};
  let seed = DEFAULT_CATEGORY_PRIORITY.seed;
  let fallback = DEFAULT_CATEGORY_PRIORITY.default;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const weight = Number(parts[parts.length - 1]);
    if (!Number.isFinite(weight)) continue;
    const key = normalizeLabel(parts.slice(0, -1).join(" "));
    if (!key) continue;
    if (key === "seed") seed = weight;
    else if (key === "default") fallback = weight;
    else categories[key] = weight;
  }

  return { seed, default: fallback, categories };
}

export function categoryPriorityFilePath(): string {
  const override = process.env.CATEGORY_PRIORITY_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(repoRoot(), "data/category-priority.txt");
}

export function loadCategoryPriorityConfig(reload = false): CategoryPriorityConfig {
  if (cached && !reload) return cached;
  const file = categoryPriorityFilePath();
  if (!existsSync(file)) {
    cached = {
      seed: DEFAULT_CATEGORY_PRIORITY.seed,
      default: DEFAULT_CATEGORY_PRIORITY.default,
      categories: { ...DEFAULT_CATEGORY_PRIORITY.categories },
    };
    return cached;
  }

  cached = parseCategoryPriorityFile(readFileSync(file, "utf8"));
  return cached;
}

export function seedCrawlPriority(): number {
  return loadCategoryPriorityConfig().seed;
}

export function defaultCrawlPriority(): number {
  return loadCategoryPriorityConfig().default;
}

export function crawlPriorityForCategory(category: string): number {
  const cfg = loadCategoryPriorityConfig();
  return cfg.categories[normalizeLabel(category)] ?? cfg.default;
}

/** Category weight + language demotion for hosts discovered on a classified page. */
export function crawlPriorityForOutbound(
  category: string,
  language?: string | null,
): number {
  return crawlPriorityForCategory(category) + crawlPriorityAdjustForLanguage(language);
}
