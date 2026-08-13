import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type LmProfile = {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
};

type ProfileFile = Record<string, Partial<Omit<LmProfile, "name">> & { baseUrl?: string }>;

const DEFAULTS = {
  apiKey: "lm-studio",
  timeoutMs: 120_000,
} as const;

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function lmProfilesFilePath(): string {
  const override = process.env.LM_PROFILES_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(repoRoot(), "data/lm-profiles.json");
}

function asPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function normalizeProfile(name: string, raw: ProfileFile[string]): LmProfile {
  const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : "";
  if (!baseUrl) throw new Error(`lm profile "${name}" missing baseUrl`);
  return {
    name,
    baseUrl,
    model: typeof raw.model === "string" ? raw.model.trim() : "",
    apiKey:
      typeof raw.apiKey === "string" && raw.apiKey.trim()
        ? raw.apiKey.trim()
        : DEFAULTS.apiKey,
    timeoutMs: asPositiveInt(raw.timeoutMs, DEFAULTS.timeoutMs),
  };
}

export function loadLmProfiles(): Record<string, LmProfile> {
  const file = lmProfilesFilePath();
  if (!existsSync(file)) {
    throw new Error(`lm profiles file not found: ${file}`);
  }
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`lm profiles must be a JSON object of named profiles: ${file}`);
  }
  const out: Record<string, LmProfile> = {};
  for (const [name, raw] of Object.entries(parsed as ProfileFile)) {
    if (!raw || typeof raw !== "object") continue;
    out[name] = normalizeProfile(name, raw);
  }
  if (Object.keys(out).length === 0) {
    throw new Error(`no lm profiles defined in ${file}`);
  }
  return out;
}

/** `--lm` / `-l` value from argv (does not consume positionals). */
export function lmNameFromArgv(argv: string[]): string | null {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--lm" || a === "-l") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(`missing value for ${a}`);
      }
      return next;
    }
    if (a.startsWith("--lm=")) return a.slice("--lm=".length) || null;
    if (a.startsWith("-l=")) return a.slice("-l=".length) || null;
  }
  return null;
}

export function getLmProfile(name: string): LmProfile {
  const profiles = loadLmProfiles();
  const profile = profiles[name];
  if (!profile) {
    const names = Object.keys(profiles).sort();
    throw new Error(`unknown lm profile "${name}" (available: ${names.join(", ")})`);
  }
  return profile;
}

/**
 * Resolve an LM connection profile.
 * Prefer `--lm` / `-l` from argv; optional `name` override; no env default
 * (one-shot CLIs should pass an explicit key).
 */
export function resolveLmProfile(opts?: {
  argv?: string[];
  /** Explicit profile name (wins over argv). */
  name?: string | null;
}): LmProfile {
  const profiles = loadLmProfiles();
  const names = Object.keys(profiles).sort();
  const chosen =
    opts?.name?.trim() ||
    (opts?.argv ? lmNameFromArgv(opts.argv) : null)?.trim() ||
    "";
  if (!chosen) {
    throw new Error(
      `Pass --lm <name> (available: ${names.join(", ")}).\n` +
        `  npm run probe -- example.com --lm lm-studio\n` +
        `  npm run compare-models -- lm-studio lm-studio-g2b`,
    );
  }
  return getLmProfile(chosen);
}
