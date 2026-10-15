import { Resend } from "resend";

export const isEmailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);

export async function sendEmail(message: { to: string[]; subject: string; html: string; text: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) throw new Error("Email delivery is not configured on this server.");

  const { error } = await new Resend(apiKey).emails.send({ from, ...message });
  if (error) throw new Error(`Email provider rejected the message: ${error.message}`);
}
