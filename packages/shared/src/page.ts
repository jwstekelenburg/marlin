import * as cheerio from "cheerio";
import { normalizeHost } from "./hostname.js";

export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
export const DEFAULT_FETCH_MAX_BYTES = 1_000_000;
export const DEFAULT_TEXT_LIMIT = 4_000;
export const MAX_REDIRECTS = 5;

export type FetchedPage = {
  finalUrl: string;
  status: number;
  html: string;
};

export type FetchFailure = {
  error: string;
  status?: number;
};

export type ExtractedPage = {
  title: string;
  description: string;
  /** Visible body text only — what a human would see, not meta/hostname. */
  body: string;
  /** LM payload: title + body, meta last and only if body is real. */
  text: string;
  hosts: string[];
};

export const NEAR_EMPTY_BODY_CHARS = 80;
export const NEAR_EMPTY_BODY_WORDS = 12;

export function isNearEmptyBody(body: string): boolean {
  const t = body.replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (t.length < NEAR_EMPTY_BODY_CHARS) return true;
  return t.split(/\s+/).filter(Boolean).length < NEAR_EMPTY_BODY_WORDS;
}

/** Assemble LM text. Body first; never pad with the hostname. */
export function buildLlmPageText(input: {
  title: string;
  description: string;
  body: string;
  /** Override LM_TEXT_CHARS / default when a worker profile sets textChars. */
  limit?: number;
}): string {
  const limit = input.limit ?? llmTextLimitFromEnv();
  const parts: string[] = [];
  if (input.title.trim()) parts.push(input.title.trim());
  if (input.body.trim()) parts.push(input.body.trim());
  if (input.description.trim() && !isNearEmptyBody(input.body)) {
    parts.push(`Meta description: ${input.description.trim()}`);
  }
  return parts.join("\n\n").slice(0, limit);
}

export type FetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
  delayMs?: number;
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function fetchOptionsFromEnv(): Required<FetchOptions> {
  return {
    timeoutMs: envInt("FETCH_TIMEOUT_MS", DEFAULT_FETCH_TIMEOUT_MS),
    maxBytes: envInt("FETCH_MAX_BYTES", DEFAULT_FETCH_MAX_BYTES),
    userAgent: process.env.FETCH_USER_AGENT ?? "MarlinPersonalIndex/0.1",
    delayMs: envInt("FETCH_DELAY_MS", 200),
  };
}

/** Chars of page text sent to the model. Keep this small if LM Studio parallel > 1 (context is split). */
export function llmTextLimitFromEnv(): number {
  return envInt("LM_TEXT_CHARS", DEFAULT_TEXT_LIMIT);
}

async function sleep(ms: number): Promise<void> {
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return await res.text();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      chunks.push(value.slice(0, Math.max(0, maxBytes - (total - value.byteLength))));
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(concat(chunks));
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function fetchOnce(
  url: string,
  opts: Required<Pick<FetchOptions, "timeoutMs" | "maxBytes" | "userAgent">>,
): Promise<FetchedPage> {
  let current = url;
  let status = 0;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: {
        "User-Agent": opts.userAgent,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
    });
    status = res.status;

    if (status >= 300 && status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`redirect ${status} without Location`);
      current = new URL(loc, current).toString();
      continue;
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
      throw new Error(`unsupported content-type ${contentType}`);
    }

    const html = await readLimited(res, opts.maxBytes);
    return { finalUrl: res.url || current, status, html };
  }

  throw new Error(`too many redirects (${MAX_REDIRECTS}) ending at ${status}`);
}

/** HTTPS then HTTP. Does not store HTML beyond the return value. */
export async function fetchHomepage(
  host: string,
  options: FetchOptions = {},
): Promise<FetchedPage | FetchFailure> {
  const opts = { ...fetchOptionsFromEnv(), ...options };
  await sleep(opts.delayMs);

  const errors: string[] = [];
  for (const protocol of ["https", "http"] as const) {
    try {
      return await fetchOnce(`${protocol}://${host}/`, opts);
    } catch (err) {
      errors.push(`${protocol}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { error: errors.join("; ") };
}

export function extractPage(html: string, baseUrl: string): ExtractedPage {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe").remove();

  const title =
    $("title").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim() ||
    "";
  const description =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    "";

  const body = $("body").text().replace(/\s+/g, " ").trim();
  const text = buildLlmPageText({ title, description, body });

  const hosts = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const url = new URL(href, baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      const host = normalizeHost(url.hostname);
      if (host) hosts.add(host);
    } catch {
      /* ignore malformed hrefs */
    }
  });

  return { title, description, body, text, hosts: [...hosts] };
}
