import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { rows } = await getDb().execute<{ tables: number }>(
      sql`select count(*)::int as tables from information_schema.tables where table_schema = 'public' and table_name in ('projects', 'ship_logs', 'billing_accounts')`
    );
    return NextResponse.json({ db: "ok", schemaReady: rows[0]?.tables === 3 });
  } catch (err) {
    console.error("Health check failed:", err);
    return NextResponse.json({ db: "error" }, { status: 503 });
  }
}
