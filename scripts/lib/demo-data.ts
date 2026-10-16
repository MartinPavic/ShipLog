import type { Activity, ActivityPull, RepoActivity } from "../../src/lib/github-activity";
import { defaultLogTitle } from "../../src/lib/ai/templates";

export const DEMO_SLUG = "demo-project";
const REPO = "acme/web-app";
const DAY_MS = 24 * 60 * 60 * 1000;

type WeekSpec = {
  pulls: { number: number; title: string; label: string; body: string }[];
  issues: { number: number; title: string; label: string }[];
  commits: string[];
  release?: { tag: string; name: string };
};

// Oldest first; the last entry is the most recent week.
const WEEKS: WeekSpec[] = [
  {
    pulls: [
      { number: 101, title: "Add team invitations", label: "feature", body: "Admins can invite teammates by email." },
      { number: 103, title: "Speed up dashboard queries", label: "performance", body: "Cuts the dashboard load time in half." },
    ],
    issues: [{ number: 98, title: "Invitation emails land in spam", label: "bug" }],
    commits: ["Refactor settings form state", "Bump dependencies"],
  },
  {
    pulls: [
      { number: 108, title: "Introduce usage meter", label: "feature", body: "Shows monthly usage next to the generate button." },
      { number: 110, title: "Dark mode for the public changelog", label: "feature", body: "Follows the visitor's system theme." },
    ],
    issues: [
      { number: 105, title: "Wrong timezone on scheduled posts", label: "bug" },
      { number: 106, title: "Export button hidden on mobile", label: "bug" },
    ],
    commits: ["Tidy up the pricing page copy"],
  },
  {
    pulls: [
      { number: 115, title: "Slack delivery for weekly logs", label: "feature", body: "Send a finished log to a Slack channel." },
      { number: 117, title: "Rate-limit the public API", label: "security", body: "Protects shared links from abuse." },
    ],
    issues: [{ number: 112, title: "Typo in the onboarding checklist", label: "docs" }],
    commits: ["Add integration tests for delivery", "Update screenshots"],
    release: { tag: "v1.2.0", name: "Spring release" },
  },
  {
    pulls: [
      { number: 121, title: "Search across all logs", label: "feature", body: "Find any past update by keyword." },
      { number: 123, title: "Fix duplicate emails on retry", label: "bug", body: "Retries no longer send the message twice." },
      { number: 124, title: "Add CSV export", label: "feature", body: "Download a project's history as CSV." },
    ],
    issues: [{ number: 118, title: "Cannot clear the custom prompt", label: "bug" }],
    commits: ["Improve empty states", "Remove unused feature flag"],
  },
];

export const DEMO_WEEKS = WEEKS.length;

function snapshot(week: WeekSpec, start: Date, end: Date): Activity {
  const at = (offsetDays: number) => new Date(start.getTime() + offsetDays * DAY_MS).toISOString();
  const pullRequests: ActivityPull[] = week.pulls.map((p, i) => ({
    number: p.number,
    title: p.title,
    body: p.body,
    labels: [p.label],
    author: i % 2 === 0 ? "ana" : "ben",
    mergedAt: at(1 + i),
    url: `https://github.com/${REPO}/pull/${p.number}`,
  }));
  const repo: RepoActivity = {
    repo: REPO,
    commits: week.commits.map((message, i) => ({
      sha: `${week.pulls[0].number}${i}`.padEnd(40, "0"),
      message,
      author: "ana",
      date: at(2 + i),
      url: `https://github.com/${REPO}/commit/${week.pulls[0].number}${i}`,
    })),
    pullRequests,
    issues: week.issues.map((issue, i) => ({
      number: issue.number,
      title: issue.title,
      labels: [issue.label],
      closedAt: at(3 + i),
      url: `https://github.com/${REPO}/issues/${issue.number}`,
    })),
    releases: week.release
      ? [{ tag: week.release.tag, name: week.release.name, body: "", publishedAt: at(5), url: `https://github.com/${REPO}/releases/${week.release.tag}` }]
      : [],
    omitted: { commits: 0, pullRequests: 0, issues: 0, releases: 0 },
  };
  return { since: start.toISOString(), until: end.toISOString(), repos: [repo] };
}

function content(week: WeekSpec): string {
  const lines = ["## Shipped", ""];
  for (const p of week.pulls) lines.push(`- **${p.title}** (#${p.number}): ${p.body}`);
  if (week.release) lines.push(`- Released **${week.release.tag}**, the ${week.release.name}.`);
  lines.push("", "## Fixes", "");
  lines.push(...week.issues.map((i) => `- ${i.title} (#${i.number})`));
  lines.push("", "## Under the hood", "");
  lines.push(...week.commits.map((c) => `- ${c}`));
  return lines.join("\n");
}

export type DemoLog = {
  title: string;
  content: string;
  periodStart: Date;
  periodEnd: Date;
  createdAt: Date;
  pinned: boolean;
  snapshot: Activity;
  // An earlier draft, so the version history has something to show.
  previousContent: string | null;
};

export function buildDemoLogs(now: Date): DemoLog[] {
  return WEEKS.map((week, index) => {
    const weeksAgo = WEEKS.length - 1 - index;
    const periodEnd = new Date(now.getTime() - weeksAgo * 7 * DAY_MS);
    const periodStart = new Date(periodEnd.getTime() - 7 * DAY_MS);
    const isLatest = weeksAgo === 0;
    return {
      title: defaultLogTitle("weekly_update", periodStart, periodEnd),
      content: content(week),
      periodStart,
      periodEnd,
      createdAt: periodEnd,
      pinned: isLatest,
      snapshot: snapshot(week, periodStart, periodEnd),
      previousContent: isLatest ? `${content(week)}\n\n- (draft) check wording` : null,
    };
  });
}

export const DEMO_PROJECT = {
  name: "Demo project",
  slug: DEMO_SLUG,
  description: "Sample data so you can explore the dashboard without connecting GitHub or an AI provider.",
  repos: [{ fullName: REPO }],
  template: "weekly_update",
  defaultPeriodDays: 7,
};
