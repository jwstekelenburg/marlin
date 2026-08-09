import Iso6391 from "iso-639-1";
import { iso6393 } from "iso-639-3";
import { getDomain, getSubdomain } from "tldts";

const iso3 = new Set(iso6393.map((row) => row.iso6393));

/** 3-letter labels that collide with ISO 639-3 but are almost never a language edition. */
const TECH_OR_AMBIGUOUS = new Set([
  "www",
  "www2",
  "www3",
  "com",
  "net",
  "org",
  "edu",
  "gov",
  "app",
  "api",
  "cdn",
  "img",
  "css",
  "dev",
  "pro",
  "web",
  "new",
  "min",
  "ban",
  "mad",
  "gun",
  "off",
  "fit",
  "map",
  "log",
  "run",
  "job",
  "lab",
  "max",
  "box",
  "bit",
  "top",
  "try",
  "get",
  "got",
  "old",
  "big",
  "pay",
  "buy",
  "git",
  "sql",
  "ftp",
  "ssl",
  "dns",
  "aws",
  "cdn",
  "s3",
  "ns1",
  "ns2",
  "mx1",
  "cms",
  "vpn",
  "blog",
  "shop",
  "docs",
  "test",
  "beta",
  "demo",
  "mail",
  "smtp",
  "imap",
  "pop",
]);

const EXTRA_LANG_EDITIONS = new Set(["simple"]);

function primarySubtag(label: string): string {
  return label.toLowerCase().split(/[-_]/)[0] ?? "";
}

/** True if this DNS label is a non-English language / locale edition. `en` / `en-us` allowed. */
export function isNonEnglishLangLabel(label: string): boolean {
  const raw = label.toLowerCase();
  if (!raw || TECH_OR_AMBIGUOUS.has(raw)) return false;
  if (EXTRA_LANG_EDITIONS.has(raw)) return true;

  const primary = primarySubtag(raw);
  if (!primary || primary === "en") return false;
  if (TECH_OR_AMBIGUOUS.has(primary)) return false;

  if (primary.length === 2 && Iso6391.validate(primary)) return true;
  if (primary.length === 3 && iso3.has(primary)) return true;
  return false;
}

/**
 * Public-suffix aware: labels before the registrable root (e.g. `fr` in
 * `fr.wikipedia.org`, `tr` in `tr.mitsubishielectric.com`, not `co` in `example.co.uk`).
 */
export function hasNonEnglishLanguageSubdomain(host: string): boolean {
  const registrable = getDomain(host, { allowPrivateDomains: true });
  if (!registrable) return false;

  const subdomain = getSubdomain(host, { allowPrivateDomains: true });
  if (!subdomain) return false;

  return subdomain.split(".").some((label) => isNonEnglishLangLabel(label));
}
