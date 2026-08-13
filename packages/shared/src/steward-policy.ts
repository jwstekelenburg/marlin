import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_STEWARD_SAMPLING,
  asPositiveInt,
  normalizePrompt,
  parseLlmSampling,
  policyNameFromArgv,
  type LlmSampling,
} from "./llm-sampling.js";

export type StewardPolicy = {
  name: string;
  systemPrompt: string;
  /** Max chars of each sample host summary sent to the judge. */
  sampleSummaryChars: number;
  sampling: LlmSampling;
};

type StewardPolicyFileEntry = {
  systemPrompt?: unknown;
  sampleSummaryChars?: unknown;
  sampling?: unknown;
};

type StewardPolicyFile = Record<string, StewardPolicyFileEntry>;

const DEFAULTS = {
  sampleSummaryChars: 400,
  sampling: DEFAULT_STEWARD_SAMPLING,
} as const;

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function stewardPoliciesFilePath(): string {
  const override = process.env.STEWARD_POLICIES_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(repoRoot(), "data/steward-policies.json");
}

function normalizeStewardPolicy(name: string, raw: StewardPolicyFileEntry): StewardPolicy {
  return {
    name,
    systemPrompt: normalizePrompt(raw.systemPrompt, `steward policy "${name}"`),
    sampleSummaryChars: asPositiveInt(raw.sampleSummaryChars, DEFAULTS.sampleSummaryChars),
    sampling: parseLlmSampling(raw.sampling, DEFAULTS.sampling),
  };
}

export function loadStewardPolicies(): Record<string, StewardPolicy> {
  const file = stewardPoliciesFilePath();
  if (!existsSync(file)) {
    throw new Error(`steward policies file not found: ${file}`);
  }
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`steward policies must be a JSON object of named policies: ${file}`);
  }
  const out: Record<string, StewardPolicy> = {};
  for (const [name, raw] of Object.entries(parsed as StewardPolicyFile)) {
    if (!raw || typeof raw !== "object") continue;
    out[name] = normalizeStewardPolicy(name, raw);
  }
  if (Object.keys(out).length === 0) {
    throw new Error(`no steward policies defined in ${file}`);
  }
  return out;
}

export function getStewardPolicy(name: string): StewardPolicy {
  const policies = loadStewardPolicies();
  const policy = policies[name];
  if (!policy) {
    const names = Object.keys(policies).sort();
    throw new Error(`unknown steward policy "${name}" (available: ${names.join(", ")})`);
  }
  return policy;
}

/**
 * Resolve steward spiral-judge policy.
 * Prefer `--policy` / `-P` from argv; else `STEWARD_POLICY` env.
 */
export function resolveStewardPolicy(opts?: {
  argv?: string[];
  name?: string | null;
}): StewardPolicy {
  const policies = loadStewardPolicies();
  const names = Object.keys(policies).sort();
  const chosen =
    opts?.name?.trim() ||
    (opts?.argv ? policyNameFromArgv(opts.argv) : null)?.trim() ||
    process.env.STEWARD_POLICY?.trim() ||
    "";
  if (!chosen) {
    throw new Error(
      `Set STEWARD_POLICY or pass --policy <name> (available: ${names.join(", ")}).\n` +
        `  npm run steward -- --policy ${names.includes("v1-simple") ? "v1-simple" : names[0] ?? "v1-simple"}\n` +
        `  STEWARD_POLICY=${names[0] ?? "v1-simple"} npm run steward`,
    );
  }
  return getStewardPolicy(chosen);
}
