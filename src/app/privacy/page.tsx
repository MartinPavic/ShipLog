import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  const { name, supportEmail, legal } = siteConfig;
  return (
    <LegalPage title="Privacy Policy">
      <section>
        <h2>1. Who we are</h2>
        <p>
          {legal.companyName}, {legal.address}, operates {name} and is the controller of the personal data described
          here. Contact: <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
        </p>
      </section>
      <section>
        <h2>2. What we process</h2>
        <ul>
          <li>Account data: name, email address and profile image, provided through our sign-in provider.</li>
          <li>GitHub data: your GitHub username, an access token (stored encrypted) and the commit messages, pull request
            and issue titles, descriptions and releases of the repositories you select, plus the names of changed files
            and short excerpts of added code for the most recent changes.</li>
          <li>AI settings: the API key you provide (stored encrypted) and your chosen provider and model.</li>
          <li>Content you create: projects, generated logs, edits, share settings and delivery channels (webhook URLs are stored encrypted).</li>
          <li>Billing data: handled by our payment provider; we keep your customer id, plan and status, not your card number.</li>
          <li>Technical data: usage counters, and logs needed to keep the Service secure and reliable.</li>
        </ul>
      </section>
      <section>
        <h2>3. Why we process it</h2>
        <p>
          To provide the Service you asked for, to bill you, to keep it secure, and to meet legal obligations. We do not
          sell your data and do not use your repository content to train models.
        </p>
      </section>
      <section>
        <h2>4. Who receives it</h2>
        <p>
          Providers that process data on our behalf: Clerk (authentication), Neon (database), Stripe (payments), Resend
          (email), Vercel (hosting), GitHub (source of activity data), and the AI provider you choose (OpenAI, Anthropic
          or xAI), which receives the activity text needed to write a log. Shared links and public changelogs are visible
          to anyone with the address.
        </p>
      </section>
      <section>
        <h2>5. Retention and your rights</h2>
        <p>
          We keep your data while your account is active. Archived or deleted projects and their logs are removed from
          active use immediately. You may ask for access, correction, export or deletion at any time, and you may object
          to or restrict processing where the law gives you that right. Contact us at the address above.
        </p>
      </section>
      <section>
        <h2>6. Security</h2>
        <p>
          Tokens, API keys and webhook URLs are encrypted at rest. Access to workspaces is limited to their members.
          No system is perfectly secure; tell us promptly if you suspect a problem.
        </p>
      </section>
      <section>
        <h2>7. Changes</h2>
        <p>We will update this policy as the Service changes and announce material changes.</p>
      </section>
    </LegalPage>
  );
}
