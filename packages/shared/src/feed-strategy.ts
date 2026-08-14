import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeLabel } from "./llm.js";

const MAX_LABELS = 200;

export type FeedStrategy = {
  includeCategories: string[];
  includeTagsAny: string[];
  excludeCategories: string[];
  excludeTags: string[];
  requireTagIfCategory: string[];
  liftIgnored: string[];
  notes: string;
};

const EMPTY: FeedStrategy = {
  includeCategories: [],
  includeTagsAny: [],
  excludeCategories: [],
  excludeTags: [],
  requireTagIfCategory: [],
  liftIgnored: [],
  notes: "",
};

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function feedPromptFilePath(): string {
  const override = process.env.FEED_PROMPT_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(repoRoot(), "data/feed-prompt.txt");
}

export function feedStrategyFilePath(): string {
  const override = process.env.FEED_STRATEGY_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(repoRoot(), "data/feed-strategy.json");
}

function labelList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const name = normalizeLabel(item);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= MAX_LABELS) break;
  }
  return out;
}

export function parseFeedStrategy(text: string): FeedStrategy {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("feed strategy must be a JSON object");
  }
  const raw = parsed as Record<string, unknown>;
  return {
    includeCategories: labelList(raw.includeCategories),
    includeTagsAny: labelList(raw.includeTagsAny),
    excludeCategories: labelList(raw.excludeCategories),
    excludeTags: labelList(raw.excludeTags),
    requireTagIfCategory: labelList(raw.requireTagIfCategory),
    liftIgnored: labelList(raw.liftIgnored),
    notes: typeof raw.notes === "string" ? raw.notes.trim() : "",
  };
}

export function emptyFeedStrategy(): FeedStrategy {
  return {
    includeCategories: [...EMPTY.includeCategories],
    includeTagsAny: [...EMPTY.includeTagsAny],
    excludeCategories: [...EMPTY.excludeCategories],
    excludeTags: [...EMPTY.excludeTags],
    requireTagIfCategory: [...EMPTY.requireTagIfCategory],
    liftIgnored: [...EMPTY.liftIgnored],
    notes: "",
  };
}

type FileCache<T> = { value: T; file: string; mtimeMs: number };

let strategyCache: FileCache<FeedStrategy> | null = null;
let promptCache: FileCache<string> | null = null;

function fileMtime(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

export function loadFeedStrategy(reload = false): FeedStrategy {
  const file = feedStrategyFilePath();
  const mtimeMs = fileMtime(file);
  if (
    !reload &&
    strategyCache &&
    strategyCache.file === file &&
    strategyCache.mtimeMs === mtimeMs
  ) {
    return strategyCache.value;
  }
  if (!existsSync(file)) {
    throw new Error(`feed strategy file not found: ${file}`);
  }
  const value = parseFeedStrategy(readFileSync(file, "utf8"));
  strategyCache = { value, file, mtimeMs };
  return value;
}

export function loadFeedPrompt(reload = false): string {
  const file = feedPromptFilePath();
  const mtimeMs = fileMtime(file);
  if (!reload && promptCache && promptCache.file === file && promptCache.mtimeMs === mtimeMs) {
    return promptCache.value;
  }
  if (!existsSync(file)) {
    promptCache = { value: "", file, mtimeMs: 0 };
    return "";
  }
  const value = readFileSync(file, "utf8").trim();
  promptCache = { value, file, mtimeMs };
  return value;
}
