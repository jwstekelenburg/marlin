import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type WorkerProfile = {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  concurrency: number;
  timeoutMs: number;
  textChars: number;
};

type ProfileFile = Record<string, Partial<Omit<WorkerProfile, "name">> & { baseUrl?: string }>;

const DEFAULTS = {
  apiKey: "lm-studio",
  concurrency: 1,
  timeoutMs: 120_000,
  textChars: 4_000,
} as const;

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function workerProfilesFilePath(): string {
  const override = process.env.WORKER_PROFILES_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(repoRoot(), "data/worker-profiles.json");
}

function asPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function normalizeProfile(name: string, raw: ProfileFile[string]): WorkerProfile {
  const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : "";
  if (!baseUrl) throw new Error(`worker profile "${name}" missing baseUrl`);
  return {
    name,
    baseUrl,
    model: typeof raw.model === "string" ? raw.model.trim() : "",
    apiKey:
      typeof raw.apiKey === "string" && raw.apiKey.trim()
        ? raw.apiKey.trim()
        : DEFAULTS.apiKey,
    concurrency: asPositiveInt(raw.concurrency, DEFAULTS.concurrency),
    timeoutMs: asPositiveInt(raw.timeoutMs, DEFAULTS.timeoutMs),
    textChars: asPositiveInt(raw.textChars, DEFAULTS.textChars),
  };
}

export function loadWorkerProfiles(): Record<string, WorkerProfile> {
  const file = workerProfilesFilePath();
  if (!existsSync(file)) {
    throw new Error(`worker profiles file not found: ${file}`);
  }
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`worker profiles must be a JSON object of named profiles: ${file}`);
  }
  const out: Record<string, WorkerProfile> = {};
  for (const [name, raw] of Object.entries(parsed as ProfileFile)) {
    if (!raw || typeof raw !== "object") continue;
    out[name] = normalizeProfile(name, raw);
  }
  if (Object.keys(out).length === 0) {
    throw new Error(`no worker profiles defined in ${file}`);
  }
  return out;
}

/** Positional name or `--profile` / `-p`. */
export function profileNameFromArgv(argv: string[]): string | null {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--profile" || a === "-p") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(`missing value for ${a}`);
      }
      return next;
    }
    if (a.startsWith("--profile=")) return a.slice("--profile=".length) || null;
    if (a.startsWith("-p=")) return a.slice("-p=".length) || null;
  }
  const positional = args.find((a) => !a.startsWith("-"));
  return positional ?? null;
}

export function resolveWorkerProfile(opts?: {
  /** Pass process.argv to allow `--profile` / positional override. Omit for env-only. */
  argv?: string[];
}): WorkerProfile {
  const profiles = loadWorkerProfiles();
  const names = Object.keys(profiles).sort();
  const chosen =
    (opts?.argv ? profileNameFromArgv(opts.argv) : null)?.trim() ||
    process.env.WORKER_PROFILE?.trim() ||
    "";
  if (!chosen) {
    throw new Error(
      `Set WORKER_PROFILE or pass a profile name (available: ${names.join(", ")}).\n` +
        `  npm run worker -- vast\n` +
        `  WORKER_PROFILE=local npm run worker`,
    );
  }
  const profile = profiles[chosen];
  if (!profile) {
    throw new Error(`unknown worker profile "${chosen}" (available: ${names.join(", ")})`);
  }
  return profile;
}
