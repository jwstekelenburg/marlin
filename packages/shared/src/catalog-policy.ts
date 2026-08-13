import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CATALOG_SAMPLING,
  asPositiveInt,
  normalizePrompt,
  parseLlmSampling,
  policyNameFromArgv,
  type LlmSampling,
} from "./llm-sampling.js";

export type CatalogPolicy = {
  name: string;
  systemPrompt: string;
  textChars: number;
  sampling: LlmSampling;
};

type CatalogPolicyFileEntry = {
  systemPrompt?: unknown;
  textChars?: unknown;
  sampling?: unknown;
};

type CatalogPolicyFile = Record<string, CatalogPolicyFileEntry>;

const DEFAULTS = {
  textChars: 4_000,
  sampling: DEFAULT_CATALOG_SAMPLING,
} as const;

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function catalogPoliciesFilePath(): string {
  const override = process.env.CATALOG_POLICIES_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(repoRoot(), "data/catalog-policies.json");
}

function normalizeCatalogPolicy(name: string, raw: CatalogPolicyFileEntry): CatalogPolicy {
  return {
    name,
    systemPrompt: normalizePrompt(raw.systemPrompt, `catalog policy "${name}"`),
    textChars: asPositiveInt(raw.textChars, DEFAULTS.textChars),
    sampling: parseLlmSampling(raw.sampling, DEFAULTS.sampling),
  };
}

export function loadCatalogPolicies(): Record<string, CatalogPolicy> {
  const file = catalogPoliciesFilePath();
  if (!existsSync(file)) {
    throw new Error(`catalog policies file not found: ${file}`);
  }
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`catalog policies must be a JSON object of named policies: ${file}`);
  }
  const out: Record<string, CatalogPolicy> = {};
  for (const [name, raw] of Object.entries(parsed as CatalogPolicyFile)) {
    if (!raw || typeof raw !== "object") continue;
    out[name] = normalizeCatalogPolicy(name, raw);
  }
  if (Object.keys(out).length === 0) {
    throw new Error(`no catalog policies defined in ${file}`);
  }
  return out;
}

export function getCatalogPolicy(name: string): CatalogPolicy {
  const policies = loadCatalogPolicies();
  const policy = policies[name];
  if (!policy) {
    const names = Object.keys(policies).sort();
    throw new Error(`unknown catalog policy "${name}" (available: ${names.join(", ")})`);
  }
  return policy;
}

/**
 * Resolve catalog LM policy (prompt + textChars + sampling).
 * Prefer `--policy` / `-P` from argv; else `CATALOG_POLICY` env.
 */
export function resolveCatalogPolicy(opts?: {
  argv?: string[];
  /** Explicit name (wins over argv / env). */
  name?: string | null;
}): CatalogPolicy {
  const policies = loadCatalogPolicies();
  const names = Object.keys(policies).sort();
  const chosen =
    opts?.name?.trim() ||
    (opts?.argv ? policyNameFromArgv(opts.argv) : null)?.trim() ||
    process.env.CATALOG_POLICY?.trim() ||
    "";
  if (!chosen) {
    throw new Error(
      `Set CATALOG_POLICY or pass --policy <name> (available: ${names.join(", ")}).\n` +
        `  npm run worker -- vast-g4-4b-1 --policy ${names.includes("v1-simple") ? "v1-simple" : names[0] ?? "v1-simple"}\n` +
        `  CATALOG_POLICY=${names[0] ?? "v1-simple"} npm run worker`,
    );
  }
  return getCatalogPolicy(chosen);
}

export { policyNameFromArgv };
