export type Label = {
  id: number;
  name: string;
  ignored: boolean;
  domainCount: number;
};

export type DomainHit = {
  id: string;
  host: string;
  name: string | null;
  summary: string | null;
  category: { id: number; name: string } | null;
  tags: { id: number; name: string }[];
  score: number | null;
};

export type Stats = {
  pending: number;
  processing: number;
  done: number;
  failed: number;
  skipped: number;
};

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export function searchDomains(params: {
  q: string;
  categoryId?: number;
  tagIds?: number[];
}): Promise<DomainHit[]> {
  const q = new URLSearchParams();
  if (params.q.trim()) q.set("q", params.q.trim());
  if (params.categoryId) q.set("categoryId", String(params.categoryId));
  if (params.tagIds?.length) q.set("tagIds", params.tagIds.join(","));
  return fetch(`/api/search?${q}`).then((r) => json<DomainHit[]>(r));
}

export function typeahead(kind: "categories" | "tags", q: string): Promise<Label[]> {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  return fetch(`/api/${kind}?${params}`).then((r) => json<Label[]>(r));
}

export function fetchIgnoreOptions(): Promise<{ categories: Label[]; tags: Label[] }> {
  return fetch("/api/ignore-options").then((r) => json(r));
}

export function setIgnored(
  kind: "categories" | "tags",
  id: number,
  ignored: boolean,
): Promise<Label> {
  return fetch(`/api/${kind}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ignored }),
  }).then((r) => json<Label>(r));
}

export function fetchStats(): Promise<Stats> {
  return fetch("/api/stats").then((r) => json<Stats>(r));
}
