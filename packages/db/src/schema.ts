import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  ignored: boolean("ignored").notNull().default(false),
  domainCount: integer("domain_count").notNull().default(0),
});

export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  ignored: boolean("ignored").notNull().default(false),
  domainCount: integer("domain_count").notNull().default(0),
});

export const domains = pgTable(
  "domains",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    host: text("host").notNull().unique(),
    apex: text("apex").notNull(),
    name: text("name"),
    summary: text("summary"),
    language: text("language"),
    place: text("place"),
    country: text("country"),
    categoryId: integer("category_id").references(() => categories.id),
    status: text("status").notNull().default("pending"),
    error: text("error"),
    httpStatus: integer("http_status"),
    source: text("source").notNull().default("list"),
    pageTitle: text("page_title"),
    pageText: text("page_text"),
    pageUrl: text("page_url"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    priority: integer("priority").notNull().default(0),
    outboundHosts: text("outbound_hosts").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    index("domains_status_idx").on(t.status),
    index("domains_category_id_idx").on(t.categoryId),
    index("domains_apex_idx").on(t.apex),
    // Partial search indexes: migrations/0007_search_indexes.sql
    // (done processed_at DESC, done language). Drizzle does not emit WHERE here.
  ],
);

export const domainTags = pgTable(
  "domain_tags",
  {
    domainId: bigint("domain_id", { mode: "number" })
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.domainId, t.tagId] })],
);

export const blockedApexes = pgTable("blocked_apexes", {
  apex: text("apex").primaryKey(),
  reason: text("reason").notNull(),
  source: text("source").notNull().default("steward"),
  evidence: jsonb("evidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apexReviews = pgTable("apex_reviews", {
  apex: text("apex").primaryKey(),
  verdict: text("verdict").notNull(),
  reason: text("reason").notNull().default(""),
  sampleSize: integer("sample_size").notNull().default(0),
  evidence: jsonb("evidence"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const feedEvents = pgTable(
  "feed_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    domainId: bigint("domain_id", { mode: "number" })
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("feed_events_domain_id_idx").on(t.domainId),
    index("feed_events_kind_created_idx").on(t.kind, t.createdAt),
  ],
);

export type Category = typeof categories.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Domain = typeof domains.$inferSelect;
export type NewDomain = typeof domains.$inferInsert;
export type BlockedApex = typeof blockedApexes.$inferSelect;
export type ApexReview = typeof apexReviews.$inferSelect;
export type FeedEvent = typeof feedEvents.$inferSelect;
