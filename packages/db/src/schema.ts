import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
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
    name: text("name"),
    summary: text("summary"),
    categoryId: integer("category_id").references(() => categories.id),
    status: text("status").notNull().default("pending"),
    error: text("error"),
    httpStatus: integer("http_status"),
    source: text("source").notNull().default("list"),
    pageTitle: text("page_title"),
    pageText: text("page_text"),
    pageUrl: text("page_url"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    index("domains_status_idx").on(t.status),
    index("domains_category_id_idx").on(t.categoryId),
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

export type Category = typeof categories.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Domain = typeof domains.$inferSelect;
export type NewDomain = typeof domains.$inferInsert;
