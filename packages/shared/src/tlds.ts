import { hasNonEnglishLanguageSubdomain } from "./language-subdomain.js";

/**
 * English-oriented TLDs. Last label only (`example.co.uk` → `uk`).
 * Override entirely with TLD_WHITELIST=com,org,net,uk (comma/space separated).
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

export function hostTld(host: string): string {
  const parts = host.split(".");
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

export function allowedTlds(): Set<string> {
  const raw = process.env.TLD_WHITELIST?.trim();
  if (!raw) return DEFAULT_ENGLISH_TLDS;
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((s) => s.replace(/^\./, "").toLowerCase())
      .filter(Boolean),
  );
}

export function isAllowedEnglishTld(host: string): boolean {
  return allowedTlds().has(hostTld(host));
}

export function isIndexableHost(host: string): boolean {
  return isAllowedEnglishTld(host) && !hasNonEnglishLanguageSubdomain(host);
}

export function hostSkipReason(host: string): string | null {
  if (!isAllowedEnglishTld(host)) return `tld not in english whitelist: .${hostTld(host)}`;
  if (hasNonEnglishLanguageSubdomain(host)) {
    return "non-english language subdomain";
  }
  return null;
}
