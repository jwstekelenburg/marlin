import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
    corporate: -20,
    documentation: -20,
    ecommerce: -15,
    saas: -10,
    news: -8,
    "social-media": -8,
    government: -5,
    education: -5,
    entertainment: -5,
    parked: -30,
    personal: 20,
    blog: 20,
    wiki: 15,
    forum: 10,
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
