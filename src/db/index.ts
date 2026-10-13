import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

let instance: ReturnType<typeof createDb> | undefined;

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url });
  attachDatabasePool(pool);
  return drizzle(pool, { schema });
}

// Lazy so importing this module (e.g. during `next build`) doesn't require DATABASE_URL.
export function getDb() {
  return (instance ??= createDb());
}

export { schema };
