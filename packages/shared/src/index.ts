export { log } from "./log.js";
export { normalizeHost, hostToUrl } from "./hostname.js";
export {
  fetchHomepage,
  extractPage,
  fetchOptionsFromEnv,
  llmTextLimitFromEnv,
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_FETCH_MAX_BYTES,
  DEFAULT_TEXT_LIMIT,
  MAX_REDIRECTS,
  type FetchedPage,
  type FetchFailure,
  type ExtractedPage,
  type FetchOptions,
} from "./page.js";
export {
  LLM_SYSTEM_PROMPT,
  LLM_JSON_SCHEMA,
  parseCatalogResult,
  isWeakSummary,
  normalizeLabel,
  type LlmCatalogResult,
} from "./llm.js";
export { cleanPageTitle, pickSiteName } from "./name.js";
export {
  DEFAULT_ENGLISH_TLDS,
  hostTld,
  allowedTlds,
  isAllowedEnglishTld,
  isIndexableHost,
  hostSkipReason,
} from "./tlds.js";
export {
  isNonEnglishLangLabel,
  hasNonEnglishLanguageSubdomain,
} from "./language-subdomain.js";
export {
  DEFAULT_CATEGORY_PRIORITY,
  parseCategoryPriorityFile,
  categoryPriorityFilePath,
  loadCategoryPriorityConfig,
  seedCrawlPriority,
  defaultCrawlPriority,
  crawlPriorityForCategory,
  type CategoryPriorityConfig,
} from "./category-priority.js";
export type {
  DomainStatus,
  DomainSource,
  DomainResult,
  LabelRow,
  SearchParams,
} from "./types.js";
