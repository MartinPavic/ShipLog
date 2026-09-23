import { NextResponse } from "next/server";
import { generateShipLog } from "@/lib/ai";

export async function POST(request: Request) {
  const { prompt } = await request.json();

  if (!prompt) {
    return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
  }

  const result = await generateShipLog(prompt);

  return NextResponse.json({ result });
}
