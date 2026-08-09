import {
  LLM_JSON_SCHEMA,
  LLM_SYSTEM_PROMPT,
  llmTextLimitFromEnv,
  log,
  parseCatalogResult,
  type LlmCatalogResult,
} from "@marlin/shared";

type ChatMessage = { role: "system" | "user"; content: string };

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

async function listModels(baseUrl: string, apiKey: string): Promise<string | null> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: { id?: string }[] };
  return body.data?.[0]?.id ?? null;
}

async function chat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  structured: boolean,
  timeoutMs: number,
): Promise<string> {
  const payload: Record<string, unknown> = {
    model,
    temperature: 0.2,
    max_tokens: 400,
    messages,
  };

  if (structured) {
    payload.response_format = {
      type: "json_schema",
      json_schema: {
        name: "domain_catalog",
        strict: true,
        schema: LLM_JSON_SCHEMA,
      },
    };
  }

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LM Studio ${res.status}: ${text.slice(0, 500)}`);
  }

  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("LM Studio returned empty content");
  return content;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("response was not JSON");
  }
}

export async function catalogPage(input: {
  url: string;
  title: string;
  text: string;
}): Promise<LlmCatalogResult> {
  const baseUrl = process.env.LM_BASE_URL ?? "http://localhost:1234/v1";
  const apiKey = process.env.LM_API_KEY || "lm-studio";
  const timeoutMs = envInt("LM_TIMEOUT_MS", 120_000);
  let model = process.env.LM_MODEL?.trim() || "";
  if (!model) {
    model = (await listModels(baseUrl, apiKey)) ?? "";
  }
  if (!model) throw new Error("LM_MODEL is empty and /v1/models returned nothing");

  const limit = llmTextLimitFromEnv();
  const text = input.text.length > limit ? input.text.slice(0, limit) : input.text;
  const messages: ChatMessage[] = [
    { role: "system", content: LLM_SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify({ ...input, text }) },
  ];

  try {
    const content = await chat(baseUrl, apiKey, model, messages, true, timeoutMs);
    return parseCatalogResult(extractJson(content));
  } catch (first) {
    const message = first instanceof Error ? first.message : String(first);
    if (/context size has been exceeded/i.test(message)) {
      throw first;
    }
    log.warn("structured LM call failed, retrying prompt-only:", first);
    const content = await chat(baseUrl, apiKey, model, messages, false, timeoutMs);
    return parseCatalogResult(extractJson(content));
  }
}
