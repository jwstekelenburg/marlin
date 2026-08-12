import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isBlockedApexHost } from "./blocked-apex.js";
import { hasNonEnglishLanguageSubdomain } from "./language-subdomain.js";

/**
 * Fallback if `data/tlds.txt` is missing.
 * Prefer editing that file. Last label only (`example.co.uk` → `uk`).
 */
export const DEFAULT_ENGLISH_TLDS = new Set([
  "com",
  "org",
  "net",
  "edu",
  "gov",
  "mil",
  "int",
  "info",
  "biz",
  "name",
  "pro",
  "io",
  "ai",
  "app",
  "dev",
  "co",
  "xyz",
  "me",
  "tech",
  "cloud",
  "digital",
  "software",
  "gg",
  "tv",
  "cc",
  "club",
  "town",
  "as",
  "page",
  "cool",
  "uk",
  "gb",
  "us",
  "au",
  "nz",
  "ca",
  "ie",
  "za",
]);

let cachedFileTlds: Set<string> | null = null;

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function tldFilePath(): string {
  const override = process.env.TLD_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(repoRoot(), "data/tlds.txt");
}

export function parseTldFile(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const label = trimmed.replace(/^\./, "").toLowerCase();
    if (label) out.add(label);
  }
  return out;
}

function parseTldWhitelistEnv(raw: string): Set<string> {
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((s) => s.replace(/^\./, "").toLowerCase())
      .filter(Boolean),
  );
}

/** Load from `data/tlds.txt` (or `TLD_FILE`). Missing file → DEFAULT_ENGLISH_TLDS. */
export function loadAllowedTlds(reload = false): Set<string> {
  if (cachedFileTlds && !reload) return cachedFileTlds;
  const file = tldFilePath();
  if (!existsSync(file)) {
    cachedFileTlds = new Set(DEFAULT_ENGLISH_TLDS);
    return cachedFileTlds;
  }
  cachedFileTlds = parseTldFile(readFileSync(file, "utf8"));
  return cachedFileTlds;
}

/**
 * Effective TLD whitelist for this process.
 * `TLD_WHITELIST` (comma/space) replaces the file entirely when set.
 */
export function allowedTlds(): Set<string> {
  const raw = process.env.TLD_WHITELIST?.trim();
  if (raw) return parseTldWhitelistEnv(raw);
  return loadAllowedTlds();
}

export function hostTld(host: string): string {
  const parts = host.split(".");
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

export function isAllowedEnglishTld(host: string): boolean {
  return allowedTlds().has(hostTld(host));
}

export function isIndexableHost(host: string): boolean {
  return (
    isAllowedEnglishTld(host) &&
    !hasNonEnglishLanguageSubdomain(host) &&
    !isBlockedApexHost(host)
  );
}

export function hostSkipReason(host: string): string | null {
  if (!isAllowedEnglishTld(host)) return `tld not in english whitelist: .${hostTld(host)}`;
  if (hasNonEnglishLanguageSubdomain(host)) {
    return "non-english language subdomain";
  }
  if (isBlockedApexHost(host)) return `blocked crawler-trap apex: ${host}`;
  return null;
}
