import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLmProfile, type LmProfile } from "./lm-profile.js";

/** Resolved worker profile: runtime knobs + LM connection fields. */
export type WorkerProfile = {
  name: string;
  /** LM profile key from `data/lm-profiles.json`. */
  lm: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  concurrency: number;
  timeoutMs: number;
};

type WorkerFileEntry = {
  lm?: string;
  concurrency?: unknown;
};

type WorkerFile = Record<string, WorkerFileEntry>;

const DEFAULTS = {
  concurrency: 1,
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

function normalizeWorker(
  name: string,
  raw: WorkerFileEntry,
  lm: LmProfile,
): WorkerProfile {
  return {
    name,
    lm: lm.name,
    baseUrl: lm.baseUrl,
    model: lm.model,
    apiKey: lm.apiKey,
    concurrency: asPositiveInt(raw.concurrency, DEFAULTS.concurrency),
    timeoutMs: lm.timeoutMs,
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
  for (const [name, raw] of Object.entries(parsed as WorkerFile)) {
    if (!raw || typeof raw !== "object") continue;
    const lmKey = typeof raw.lm === "string" ? raw.lm.trim() : "";
    if (!lmKey) {
      throw new Error(`worker profile "${name}" missing lm (key into lm-profiles.json)`);
    }
    out[name] = normalizeWorker(name, raw, getLmProfile(lmKey));
  }
  if (Object.keys(out).length === 0) {
    throw new Error(`no worker profiles defined in ${file}`);
  }
  return out;
}

/** Positional name or `--profile` / `-p`. Skips values of `--policy` / `--lm`. */
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
  // Do not treat `--policy v1-simple` / `--lm x` values as the worker profile name.
  const skip = new Set<number>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (
      a === "--profile" ||
      a === "-p" ||
      a === "--policy" ||
      a === "-P" ||
      a === "--lm" ||
      a === "-l"
    ) {
      skip.add(i + 1);
    }
  }
  for (let i = 0; i < args.length; i++) {
    if (skip.has(i)) continue;
    const a = args[i]!;
    if (!a.startsWith("-")) return a;
  }
  return null;
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
        `  npm run worker -- ${names.includes("vast-g4-4b-1") ? "vast-g4-4b-1" : names[0] ?? "local"}\n` +
        `  WORKER_PROFILE=${names[0] ?? "local"} npm run worker`,
    );
  }
  const profile = profiles[chosen];
  if (!profile) {
    throw new Error(`unknown worker profile "${chosen}" (available: ${names.join(", ")})`);
  }
  return profile;
}
