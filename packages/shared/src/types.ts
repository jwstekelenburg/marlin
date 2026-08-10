export type DomainStatus =
  | "pending"
  | "fetching"
  | "ready"
  | "summarizing"
  | "done"
  | "failed"
  | "skipped";
export type DomainSource = "list" | "spider" | "link";

export type DomainResult = {
  id: string;
  host: string;
  name: string | null;
  summary: string | null;
  language: string | null;
  place: string | null;
  country: string | null;
  category: { id: number; name: string } | null;
  tags: { id: number; name: string }[];
  score: number | null;
};

export type LabelRow = {
  id: number;
  name: string;
  ignored: boolean;
  domainCount: number;
};

export type SearchParams = {
  q?: string;
  categoryId?: number;
  tagIds?: number[];
  country?: string;
  limit?: number;
  offset?: number;
};
