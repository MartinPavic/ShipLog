import { clerkClient } from "@clerk/nextjs/server";
import { appUrl } from "@/lib/app-url";
import { isEmailConfigured, sendEmail } from "@/lib/email";

async function getUserEmail(userId: string): Promise<string | null> {
  const user = await (await clerkClient()).users.getUser(userId);
  return user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// Best effort: a failed notification must never fail the job that triggered it.
export async function notifyProjectCreator(userId: string, project: { id: string; name: string }, reason: string) {
  if (!isEmailConfigured()) return;
  try {
    const to = await getUserEmail(userId);
    if (!to) return;
    const link = `${appUrl()}/dashboard/projects/${project.id}?tab=settings`;
    await sendEmail({
      to: [to],
      subject: `ShipLog: scheduled log for ${project.name} was skipped`,
      text: `The scheduled ship log for "${project.name}" was skipped.\n\n${reason}\n\nFix it here: ${link}`,
      html: `<p>The scheduled ship log for <strong>${escapeHtml(project.name)}</strong> was skipped.</p><p>${escapeHtml(reason)}</p><p><a href="${link}">Open project settings</a></p>`,
    });
  } catch (err) {
    console.error("Could not send scheduling notification:", err);
  }
}
