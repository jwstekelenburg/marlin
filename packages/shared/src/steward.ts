/**
 * Steward spiral judge — confirm whether an apex is a crawler trap / SEO mill.
 * Not the catalog prompt. Input is a small sample of already-summarized hosts.
 * Prompt / sampling live in `data/steward-policies.json` (see steward-policy.ts).
 */

export const STEWARD_SPIRAL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: {
      type: "string",
      enum: ["block", "keep", "unsure"],
      description: "block = crawler trap; keep = fine / UGC; unsure = need more samples",
    },
    reason: {
      type: "string",
      description: "One or two short factual sentences.",
    },
  },
  required: ["verdict", "reason"],
} as const;

export type SpiralVerdict = "block" | "keep" | "unsure";

export type SpiralJudgeResult = {
  verdict: SpiralVerdict;
  reason: string;
};

export type SpiralSampleHost = {
  host: string;
  name: string | null;
  summary: string | null;
  category: string | null;
  language: string | null;
};

export function parseSpiralJudgeResult(value: unknown): SpiralJudgeResult {
  if (!value || typeof value !== "object") throw new Error("spiral judge: not an object");
  const obj = value as Record<string, unknown>;
  const verdict = typeof obj.verdict === "string" ? obj.verdict.trim().toLowerCase() : "";
  if (verdict !== "block" && verdict !== "keep" && verdict !== "unsure") {
    throw new Error(`spiral judge: bad verdict ${verdict}`);
  }
  const reason = typeof obj.reason === "string" ? obj.reason.trim() : "";
  if (!reason) throw new Error("spiral judge: empty reason");
  return { verdict, reason: reason.slice(0, 1000) };
}
