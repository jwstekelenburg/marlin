import { pickSiteName } from "./name.js";
import { isNearEmptyBody, NEAR_EMPTY_BODY_CHARS, NEAR_EMPTY_BODY_WORDS } from "./page.js";

export type SkipLmKind = "empty" | "challenge" | "parked";

export const EMPTY_SUMMARY =
  "No meaningful visible page content. The homepage is empty, a JavaScript-only shell, or a placeholder — not a real site.";

export const CHALLENGE_SUMMARY =
  "Bot-check or CDN interstitial (Cloudflare “Just a moment…”, waiting room, or similar) — not the real homepage.";

export const PARKED_SUMMARY =
  "Registrar or for-sale parking page. The domain is listed for purchase or expired parking, not an active site.";

const CHALLENGE_TITLE =
  /^(just a moment|attention required|please wait|one more step|checking your browser|security check|access denied|pardon our interruption|pardon the interruption)\b/i;

const CHALLENGE_BODY =
  /(?:\bcloudflare\b|\bcf-ray\b|\bray id\b|challenge-platform|cf-browser-verification|enable javascript and cookies to continue|verify you are human|review the security of your connection|performing security verification|ddos protection by cloudflare|why have i been blocked|you have been blocked|sucuri website firewall|incapsula incident id|pardon our interruption|checking your browser before accessing)/i;

const PARKED_SIGNAL =
  /(?:\b(?:this )?domain (?:is )?(?:for sale|may be for sale|has expired|expired)\b|\bbuy this domain\b|\bmake an offer\b|\bdomain parking\b|\bparked (?:free )?by\b|\bhugedomains\b|\bsedo(?:parking)?\b|\bafternic\b|\bbodis\b|\bparkingcrew\b|\bgodaddy\b.{0,40}\b(?:park|for sale|auction)\b|\bthis website is for sale\b)/i;

const USELESS_TITLE =
  /^(just a moment|attention required|please wait|redirecting|website expired|domain expired|page not found|404(\s+error)?|403(\s+forbidden)?|error|connectyourdomain error|coming soon|under construction|index of\/?)\b/i;

export function isBotChallengePage(title: string, body: string): boolean {
  const t = title.replace(/\s+/g, " ").trim();
  const b = body.replace(/\s+/g, " ").trim();
  if (CHALLENGE_TITLE.test(t)) return true;
  if (CHALLENGE_BODY.test(`${t} ${b}`)) return true;
  return false;
}

export function isParkedLander(title: string, body: string): boolean {
  const blob = `${title} ${body}`.replace(/\s+/g, " ").trim();
  return PARKED_SIGNAL.test(blob);
}

/** Why the worker should not call LM. Parked only for clear for-sale / registrar copy. */
export function skipLmReason(title: string, body: string): SkipLmKind | null {
  if (isParkedLander(title, body)) return "parked";
  if (isBotChallengePage(title, body)) return "challenge";
  if (isNearEmptyBody(body)) return "empty";
  return null;
}

export function catalogWithoutLlm(
  kind: SkipLmKind,
  host: string,
  title: string,
): { name: string; summary: string; category: string; tags: string[] } {
  const category = kind === "parked" ? "parked" : "empty";
  const summary =
    kind === "parked" ? PARKED_SUMMARY : kind === "challenge" ? CHALLENGE_SUMMARY : EMPTY_SUMMARY;
  const tags = kind === "parked" ? ["parked"] : kind === "challenge" ? ["empty", "challenge"] : ["empty"];
  const nameTitle = USELESS_TITLE.test(title.replace(/\s+/g, " ").trim()) ? "" : title;
  return {
    name: pickSiteName({ llmName: "", title: nameTitle, host, category }),
    summary,
    category,
    tags,
  };
}

export { NEAR_EMPTY_BODY_CHARS, NEAR_EMPTY_BODY_WORDS };
