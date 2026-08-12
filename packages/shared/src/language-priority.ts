import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Outbound link queue adjustments from the source page's LM language.
 * Additive on top of category weight. Prefer `data/language-priority.txt`.
 *
 * null / unknown → 0 (always include; no signal yet)
 * en → listed weight (default 0)
 * mul → mild demote
 * anything else → `default` weight
 */

export type LanguagePriorityConfig = {
  /** Explicit ISO codes (and `mul`). */
  languages: Record<string, number>;
  /** Any other non-empty language code. */
  default: number;
};

/** Fallback if `data/language-priority.txt` is missing. Keep in sync with that file. */
export const DEFAULT_LANGUAGE_PRIORITY: LanguagePriorityConfig = {
  languages: { en: 0, mul: -10 },
  default: -50,
};

/** Same as `mul` in DEFAULT_LANGUAGE_PRIORITY / data/language-priority.txt. */
export const LANGUAGE_CRAWL_ADJUST_MUL = DEFAULT_LANGUAGE_PRIORITY.languages.mul ?? -10;
/** Same as `default` in DEFAULT_LANGUAGE_PRIORITY / data/language-priority.txt. */
export const LANGUAGE_CRAWL_ADJUST_NON_ENGLISH = DEFAULT_LANGUAGE_PRIORITY.default;

let cached: LanguagePriorityConfig | null = null;

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function languagePriorityFilePath(): string {
  const override = process.env.LANGUAGE_PRIORITY_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(repoRoot(), "data/language-priority.txt");
}

export function parseLanguagePriorityFile(text: string): LanguagePriorityConfig {
  const languages: Record<string, number> = {
    ...DEFAULT_LANGUAGE_PRIORITY.languages,
  };
  let fallback = DEFAULT_LANGUAGE_PRIORITY.default;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const weight = Number(parts[parts.length - 1]);
    if (!Number.isFinite(weight)) continue;
    const key = parts.slice(0, -1).join(" ").toLowerCase();
    if (!key) continue;
    if (key === "default" || key === "*") fallback = weight;
    else languages[key] = weight;
  }

  return { languages, default: fallback };
}

export function loadLanguagePriorityConfig(reload = false): LanguagePriorityConfig {
  if (cached && !reload) return cached;
  const file = languagePriorityFilePath();
  if (!existsSync(file)) {
    cached = {
      languages: { ...DEFAULT_LANGUAGE_PRIORITY.languages },
      default: DEFAULT_LANGUAGE_PRIORITY.default,
    };
    return cached;
  }
  cached = parseLanguagePriorityFile(readFileSync(file, "utf8"));
  return cached;
}

export function crawlPriorityAdjustForLanguage(
  language: string | null | undefined,
): number {
  if (language == null || language === "") return 0;
  const cfg = loadLanguagePriorityConfig();
  const code = language.trim().toLowerCase();
  if (!code) return 0;
  return cfg.languages[code] ?? cfg.default;
}
