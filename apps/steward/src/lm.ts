import {
  STEWARD_SPIRAL_JSON_SCHEMA,
  parseSpiralJudgeResult,
  type LmProfile,
  type SpiralJudgeResult,
  type SpiralSampleHost,
  type StewardPolicy,
} from "@marlin/shared";

type ChatMessage = { role: "system" | "user"; content: string };

type LmConn = Pick<LmProfile, "baseUrl" | "model" | "apiKey" | "timeoutMs">;

async function listModels(baseUrl: string, apiKey: string): Promise<string | null> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: { id?: string }[] };
  return body.data?.[0]?.id ?? null;
}

async function chat(
  lm: LmConn,
  model: string,
  messages: ChatMessage[],
  structured: boolean,
  sampling: StewardPolicy["sampling"],
): Promise<string> {
  const payload: Record<string, unknown> = {
    model,
    ...sampling,
    messages,
  };
  if (structured) {
    payload.response_format = {
      type: "json_schema",
      json_schema: {
        name: "spiral_judge",
        strict: true,
        schema: STEWARD_SPIRAL_JSON_SCHEMA,
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
    throw new Error(`LM ${res.status}: ${text.slice(0, 500)}`);
  }

  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("LM returned empty content");
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

export async function judgeSpiralApex(input: {
  apex: string;
  hosts: number;
  done: number;
  samples: SpiralSampleHost[];
  lm: LmConn;
  policy: StewardPolicy;
}): Promise<SpiralJudgeResult> {
  const { policy } = input;
  let model = input.lm.model.trim();
  if (!model) {
    model = (await listModels(input.lm.baseUrl, input.lm.apiKey)) ?? "";
  }
  if (!model) {
    throw new Error(`profile model is empty and ${input.lm.baseUrl}/models returned nothing`);
  }

  const messages: ChatMessage[] = [
    { role: "system", content: policy.systemPrompt },
    {
      role: "user",
      content: JSON.stringify({
        apex: input.apex,
        hosts: input.hosts,
        done: input.done,
        sample: input.samples.map((s) => ({
          host: s.host,
          name: s.name,
          category: s.category,
          language: s.language,
          summary: (s.summary ?? "").slice(0, policy.sampleSummaryChars),
        })),
      }),
    },
  ];

  try {
    const content = await chat(input.lm, model, messages, true, policy.sampling);
    return parseSpiralJudgeResult(extractJson(content));
  } catch {
    const content = await chat(input.lm, model, messages, false, policy.sampling);
    return parseSpiralJudgeResult(extractJson(content));
  }
}
