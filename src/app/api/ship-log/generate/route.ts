import { auth, currentUser, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  const meta = (user?.privateMetadata || {}) as {
    githubToken?: string;
    aiApiKey?: string;
    aiProvider?: string;
    shipLogs?: any[];
    plan?: string;
    generationCount?: number;
    generationMonth?: string; // "2026-10"
  };

  // --- Plan limit check ---
  const isPro = meta.plan === "pro";
  const currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"

  let generationCount = meta.generationCount || 0;
  let generationMonth = meta.generationMonth || currentMonth;

  // Reset counter if it's a new month
  if (generationMonth !== currentMonth) {
    generationCount = 0;
    generationMonth = currentMonth;
  }

  if (!isPro && generationCount >= 5) {
    return NextResponse.json(
      {
        error: "Free plan limit reached (5 generations per month). Upgrade to Pro for unlimited.",
        code: "LIMIT_REACHED",
      },
      { status: 403 }
    );
  }

  if (!meta.githubToken || !meta.aiApiKey) {
    return NextResponse.json(
      { error: "Missing GitHub token or AI API key. Go to Settings." },
      { status: 400 }
    );
  }

  const body = await req.json();
  // const days = Math.min(Math.max(Number(body.days) || 7, 1), 30);
  const days = Number(body.days) || 7;
  const repo = body.repo as string | null;

  // 1. Fetch commits from GitHub
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceISO = since.toISOString();

  let commitsText = "";

  try {
    if (repo) {
      // Specific repo
      const url = `https://api.github.com/repos/${repo}/commits?since=${sinceISO}&per_page=50`;
      const ghRes = await fetch(url, {
        headers: {
          Authorization: `Bearer ${meta.githubToken}`,
          Accept: "application/vnd.github+json",
        },
      });

      if (!ghRes.ok) {
        const err = await ghRes.text();
        return NextResponse.json(
          { error: `GitHub error: ${ghRes.status} – check token and repo name` },
          { status: 400 }
        );
      }

      const commits = await ghRes.json();
      commitsText = commits
        .map((c: any) => `- ${c.commit.message.split("\n")[0]} (${c.commit.author.date.slice(0, 10)})`)
        .join("\n");
    } else {
      // User events (simpler fallback)
      const url = `https://api.github.com/users/${user?.username || "me"}/events?per_page=50`;
      const ghRes = await fetch(url, {
        headers: {
          Authorization: `Bearer ${meta.githubToken}`,
          Accept: "application/vnd.github+json",
        },
      });

      if (!ghRes.ok) {
        return NextResponse.json(
          { error: "Could not fetch GitHub activity. Check your token." },
          { status: 400 }
        );
      }

      const events = await ghRes.json();
      const pushEvents = events.filter((e: any) => e.type === "PushEvent");
      commitsText = pushEvents
        .flatMap((e: any) =>
          (e.payload.commits || []).map(
            (c: any) => `- ${c.message.split("\n")[0]} (${e.repo.name})`
          )
        )
        .slice(0, 40)
        .join("\n");
    }
  } catch (e) {
    return NextResponse.json({ error: "Failed to reach GitHub" }, { status: 500 });
  }

  if (!commitsText.trim()) {
    return NextResponse.json(
      { error: "No commits found in the selected period." },
      { status: 400 }
    );
  }

  // 2. Call AI
  const prompt = `You are an expert engineering manager. Turn the following git commits into a clean, professional weekly ship log / progress report.

Rules:
- Group related work into 3-7 bullet points
- Use clear, non-technical language when possible
- Highlight what was shipped / finished
- Mention anything that looks like work-in-progress or blockers if obvious
- Keep it concise (max ~250 words)
- Output only the report, no extra commentary

Commits:
${commitsText}`;

  let aiContent = "";

  try {
    if (meta.aiProvider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": meta.aiApiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await res.json();
      aiContent = data.content?.[0]?.text || "No response from AI";
    } else if (meta.aiProvider === "grok") {
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${meta.aiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "grok-beta",
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await res.json();
      aiContent = data.choices?.[0]?.message?.content || "No response from AI";
    } else {
      // OpenAI default
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${meta.aiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await res.json();
      aiContent = data.choices?.[0]?.message?.content || "No response from AI";
    }
  } catch (e) {
    return NextResponse.json({ error: "AI provider request failed" }, { status: 500 });
  }

  // 3. Save to history (keep last 10)
  const newLog = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    content: aiContent,
    period: `Last ${days} days`,
  };

  const existingLogs = meta.shipLogs || [];
  const updatedLogs = [newLog, ...existingLogs].slice(0, 10);

  const client = await clerkClient();
  await client.users.updateUserMetadata(userId, {
    privateMetadata: {
      ...meta,
      shipLogs: updatedLogs,
      generationCount: generationCount + 1,
      generationMonth,
    },
  });

  return NextResponse.json({
    content: aiContent,
    log: newLog,
  });
}