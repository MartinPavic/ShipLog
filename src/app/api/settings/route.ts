import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { githubToken, aiApiKey, aiProvider } = body;

  const client = await clerkClient();

  await client.users.updateUserMetadata(userId, {
    privateMetadata: {
      githubToken: githubToken || "",
      aiApiKey: aiApiKey || "",
      aiProvider: aiProvider || "openai",
    },
  });

  return NextResponse.json({ success: true });
}