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
  limit?: number;
  offset?: number;
};
