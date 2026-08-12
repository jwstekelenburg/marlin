export type SearchUrlState = {
  q: string;
  categoryId?: number;
  tagIds: number[];
  country?: string;
  language?: string;
};

function parseId(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseIds(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function parseSearchUrl(search: string): SearchUrlState {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const country = p.get("country")?.trim().toUpperCase() || undefined;
  const language = p.get("language")?.trim().toLowerCase() || undefined;
  return {
    q: p.get("q")?.trim() ?? "",
    categoryId: parseId(p.get("category")),
    tagIds: parseIds(p.get("tags")),
    country,
    language,
  };
}

export function buildSearchUrl(state: {
  q?: string;
  categoryId?: number;
  tagIds?: number[];
  country?: string;
  language?: string;
}): string {
  const p = new URLSearchParams();
  const q = state.q?.trim() ?? "";
  if (q) p.set("q", q);
  if (state.categoryId) p.set("category", String(state.categoryId));
  if (state.tagIds?.length) p.set("tags", state.tagIds.join(","));
  if (state.country?.trim()) p.set("country", state.country.trim());
  if (state.language?.trim()) p.set("language", state.language.trim());
  const s = p.toString();
  return s ? `/?${s}` : "/";
}
