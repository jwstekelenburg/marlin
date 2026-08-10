/**
 * Outbound link queue adjustments from the source page's LM language.
 * Additive on top of category weight. Hardcoded for now — personal index is English-only.
 *
 * null / unknown → 0 (always include; no signal yet)
 * en → 0
 * mul → mild demote (mixed homepage; might still yield English neighbours)
 * anything else → hard demote (still crawled eventually, after English backlog)
 */
export const LANGUAGE_CRAWL_ADJUST_MUL = -10;
export const LANGUAGE_CRAWL_ADJUST_NON_ENGLISH = -50;

export function crawlPriorityAdjustForLanguage(
  language: string | null | undefined,
): number {
  if (language == null || language === "") return 0;
  if (language === "en") return 0;
  if (language === "mul") return LANGUAGE_CRAWL_ADJUST_MUL;
  return LANGUAGE_CRAWL_ADJUST_NON_ENGLISH;
}
