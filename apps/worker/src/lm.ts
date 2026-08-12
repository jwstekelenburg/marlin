import {
  LLM_JSON_SCHEMA,
  LLM_SAMPLING,
  LLM_SYSTEM_PROMPT,
  isWeakSummary,
  log,
  parseCatalogResult,
  type LlmCatalogResult,
} from "@marlin/shared";
import type { WorkerProfile } from "./profile.js";

type ChatMessage = { role: "system" | "user"; content: string };

export type LmClient = Pick<
  WorkerProfile,
  "baseUrl" | "model" | "apiKey" | "timeoutMs" | "textChars"
>;

async function listModels(baseUrl: string, apiKey: string): Promise<string | null> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: { id?: string }[] };
  return body.data?.[0]?.id ?? null;
}

async function chat(
  lm: LmClient,
  model: string,
  messages: ChatMessage[],
  structured: boolean,
): Promise<string> {
  const payload: Record<string, unknown> = {
    model,
    ...LLM_SAMPLING.catalog,
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

  const res = await fetch(`${lm.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(lm.timeoutMs),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lm.apiKey}`,
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
  lm: LmClient;
  /** Override profile model for multi-model compares. */
  model?: string;
}): Promise<LlmCatalogResult> {
  const { lm } = input;
  let model = input.model?.trim() || lm.model;
  if (!model) {
    model = (await listModels(lm.baseUrl, lm.apiKey)) ?? "";
  }
  if (!model) {
    throw new Error(`profile model is empty and ${lm.baseUrl}/models returned nothing`);
  }

  const text = input.text.length > lm.textChars ? input.text.slice(0, lm.textChars) : input.text;
  const messages: ChatMessage[] = [
    { role: "system", content: LLM_SYSTEM_PROMPT },
    {
      role: "user",
      content: JSON.stringify({
        url: input.url,
        title: input.title,
        body: text,
      }),
    },
  ];

  const retryMessages: ChatMessage[] = [
    ...messages,
    {
      role: "user",
      content:
        "Your previous JSON was invalid or summary was a short label. Resend JSON only. summary must be 2-3 full sentences of prose, not the category and not a tag.",
    },
  ];

  try {
    const content = await chat(lm, model, messages, true);
    const result = parseCatalogResult(extractJson(content));
    if (isWeakSummary(result.summary, result.category, result.tags)) {
      throw new Error(`summary too thin: ${result.summary.slice(0, 80)}`);
    }
    return result;
  } catch (first) {
    const message = first instanceof Error ? first.message : String(first);
    if (/context size has been exceeded/i.test(message)) {
      throw first;
    }
    log.warn("structured LM call failed, retrying prompt-only:", first);
    const content = await chat(lm, model, retryMessages, false);
    const result = parseCatalogResult(extractJson(content));
    if (isWeakSummary(result.summary, result.category, result.tags)) {
      throw new Error(`summary too thin after retry: ${result.summary.slice(0, 80)}`, {
        cause: first,
      });
    }
    return result;
  }
}
