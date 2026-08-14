# Feed prompt → strategy (agent compile)

Marlin’s feed does **not** call the catalog LM. The human writes a high-level intent; an agent (not Gemma 4 E4B) compiles it against the **live** category/tag vocabulary into a JSON allow/deny list. The scroll path is SQL over `done` rows plus `feed_events`.

Do this when `data/feed-prompt.txt` changes, or when the catalog’s label distribution has drifted enough that the river feels wrong.

## Inputs

1. Read [`data/feed-prompt.txt`](../data/feed-prompt.txt) — the only user-facing intent. Do not invent extra goals.
2. Read the current [`data/feed-strategy.json`](../data/feed-strategy.json) if it exists (diff, don’t blindly replace).
3. Query **live Postgres** (Compose service `marlin-postgres-1`, `psql -U marlin -d marlin`). Do not compile from memory of old counts.

## Output

Overwrite [`data/feed-strategy.json`](../data/feed-strategy.json). **Names, not ids** (`normalizeLabel`: trim, lowercase, collapse spaces). Runtime resolves names to ids.

```json
{
  "includeCategories": ["portfolio", "art"],
  "includeTagsAny": ["zine", "hobby"],
  "excludeCategories": ["corporate", "ecommerce"],
  "excludeTags": ["gambling"],
  "requireTagIfCategory": ["blog", "personal", "other"],
  "liftIgnored": [],
  "notes": "why these lists; approximate candidate count; date"
}
```

| Field | Meaning |
| --- | --- |
| `includeCategories` | Free pass: `done` rows in this category are eligible without a tag. **Small, high-precision buckets only.** |
| `includeTagsAny` | Any-of tags that make a row eligible (and that gated categories must have). |
| `excludeCategories` | Hard no, even if a tag matches. Always include `corporate` unless the prompt asks for companies. Include globally-ignored junk (`ecommerce`, `news`, `empty`, `parked`, …) so a later ignore-toggle cannot leak them. |
| `excludeTags` | Hard no. Adult/gambling and other prompt-specific rejects. |
| `requireTagIfCategory` | These categories are **only** eligible when they also have an `includeTagsAny` tag. Always put `blog`, `personal`, and `other` here unless the prompt is “show me everything”. Never put a free-pass category here. |
| `liftIgnored` | Category/tag names that may appear even when `ignored = true` (e.g. `news` for a news feed). Empty for makers. |
| `notes` | Human rationale + rough pool size. Ignored at runtime. |

Unknown names are dropped at runtime (API reports them). Prefer names that exist; check with SQL before writing.

## Matching rules (keep the compiler honest)

A row is eligible when all of:

- `status = 'done'`
- category not in `excludeCategories`, no `excludeTags`
- search ignore still applies unless the label is in `liftIgnored`
- **either** (category in `includeCategories` **and** not in `requireTagIfCategory`) **or** (has any `includeTagsAny`)
- if category is in `requireTagIfCategory`, it **must** have an include tag

Do **not**:

- Put `other`, `blog`, or `personal` in `includeCategories` (138k / 45k / 22k sludge).
- Use broad tags as free passes (`art`, `design`, `writing`, `software`, `music` as tags) unless the prompt is that broad. Category `art` is OK; tag `art` is not.
- Include a label just because crawl [`data/category-priority.txt`](../data/category-priority.txt) boosts it — that file is discovery order, not feed precision.
- Call the catalog / steward LM to pick labels.
- Write integer ids into the JSON.

## Queries to run

Status and vocab size:

```sql
SELECT status, count(*) FROM domains GROUP BY 1;
SELECT count(*) FROM categories;
SELECT count(*) FROM tags;
```

Does a name exist, and how big is it?

```sql
SELECT 'category' AS kind, name, domain_count, ignored FROM categories WHERE name IN (...);
SELECT 'tag' AS kind, name, domain_count, ignored FROM tags WHERE name IN (...);
```

Find labels related to the prompt (example: makers):

```sql
SELECT name, domain_count FROM categories
WHERE name ~ '(portfolio|hobby|zine|comic|art|maker|indie)'
ORDER BY domain_count DESC LIMIT 40;

SELECT name, domain_count FROM tags
WHERE domain_count >= 80
  AND name ~ '(portfolio|hobby|zine|indie|maker|neocit|comic|pixel|webring)'
ORDER BY domain_count DESC LIMIT 60;
```

Estimate pool size **after** drafting lists (paste the arrays). Aim for tens of thousands for an infinite river, not 500 and not 200k.

```sql
-- replace the ARRAY literals with your draft lists
SELECT count(*) FROM domains d
JOIN categories c ON c.id = d.category_id
WHERE d.status = 'done'
  AND c.ignored = false
  AND c.name != ALL (ARRAY['corporate','ecommerce']::text[])
  AND (
    (c.name = ANY (ARRAY['portfolio','art']::text[])
      AND c.name != ALL (ARRAY['blog','personal','other']::text[]))
    OR EXISTS (
      SELECT 1 FROM domain_tags dt
      JOIN tags t ON t.id = dt.tag_id
      WHERE dt.domain_id = d.id
        AND t.name = ANY (ARRAY['zine','hobby']::text[])
    )
  );
```

Sample 8 random summaries from the free-pass cats and 8 from gated cats. If more than about half are shops, agencies, or NSFW, tighten excludes / drop a broad tag.

## Postgres access

Host: published **5433**. Typical Compose:

```bash
docker exec marlin-postgres-1 psql -U marlin -d marlin -c "…"
```

No compile API. Do not add one unless the human asks.

## After writing

The API reloads the JSON on mtime (no restart). Scroll `/feed` and sanity-check the first page. If the human changed only the prompt, do not leave a stale strategy that implements the old intent.
