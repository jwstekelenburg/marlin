import "./env.js";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required");
}

export const pool = new pg.Pool({ connectionString: url });
export const db = drizzle(pool, { schema });
export type Db = typeof db;
