import { getDomain } from "tldts";

export const DEFAULT_MAX_SUBDOMAINS_PER_APEX = 100;

/**
 * ICANN eTLD+1 (`alice.tumblr.com` → `tumblr.com`, `a.b.example.co.uk` → `example.co.uk`).
 * Do not use private suffixes — those would treat each Tumblr/GitHub Pages host as its own apex.
 */
export function hostApex(host: string): string {
  return getDomain(host, { allowPrivateDomains: false }) ?? host;
}

export function maxSubdomainsPerApex(): number {
  const raw = process.env.MAX_SUBDOMAINS_PER_APEX?.trim();
  if (!raw) return DEFAULT_MAX_SUBDOMAINS_PER_APEX;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_MAX_SUBDOMAINS_PER_APEX;
  return Math.max(0, Math.floor(n));
}
