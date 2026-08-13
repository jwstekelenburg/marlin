/** Shared chat-completion sampling knobs (catalog + steward policies). */
export type LlmSampling = {
  temperature: number;
  top_p: number;
  top_k: number;
  max_tokens: number;
};

export const DEFAULT_CATALOG_SAMPLING: LlmSampling = {
  temperature: 0.2,
  top_p: 0.95,
  top_k: 64,
  max_tokens: 400,
};

export const DEFAULT_STEWARD_SAMPLING: LlmSampling = {
  temperature: 0.1,
  top_p: 0.95,
  top_k: 64,
  max_tokens: 400,
};

export function asNonNegNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

export function asPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

/** top_k: positive int, or -1 (disabled on vLLM / llama.cpp). */
export function asTopK(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i === -1 || i > 0) return i;
  return fallback;
}

/** Parse sampling object; missing fields fall back to `defaults`. */
export function parseLlmSampling(raw: unknown, defaults: LlmSampling): LlmSampling {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  return {
    temperature: asNonNegNumber(obj.temperature, defaults.temperature),
    top_p: asNonNegNumber(obj.top_p, defaults.top_p),
    top_k: asTopK(obj.top_k, defaults.top_k),
    max_tokens: asPositiveInt(obj.max_tokens, defaults.max_tokens),
  };
}

/** `--policy` / `-P` from argv (does not consume positionals). */
export function policyNameFromArgv(argv: string[]): string | null {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--policy" || a === "-P") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(`missing value for ${a}`);
      }
      return next;
    }
    if (a.startsWith("--policy=")) return a.slice("--policy=".length) || null;
    if (a.startsWith("-P=")) return a.slice("-P=".length) || null;
  }
  return null;
}

/** Join string or line-array prompts from policy JSON. */
export function normalizePrompt(value: unknown, label: string): string {
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) throw new Error(`${label} systemPrompt is empty`);
    return s;
  }
  if (Array.isArray(value)) {
    const lines = value.filter((x): x is string => typeof x === "string");
    if (lines.length !== value.length) {
      throw new Error(`${label} systemPrompt array must contain only strings`);
    }
    const s = lines.join("\n").trim();
    if (!s) throw new Error(`${label} systemPrompt is empty`);
    return s;
  }
  throw new Error(`${label} missing systemPrompt (string or string[])`);
}
