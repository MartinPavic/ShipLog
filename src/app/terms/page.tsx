import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  const { name, supportEmail, legal } = siteConfig;
  return (
    <LegalPage title="Terms of Service">
      <section>
        <h2>1. The service</h2>
        <p>
          {name} (the &quot;Service&quot;) is operated by {legal.companyName}, {legal.address}. It generates written
          summaries of your software activity using GitHub data and AI providers. By creating an account or using the
          Service you agree to these terms.
        </p>
      </section>
      <section>
        <h2>2. Accounts and workspaces</h2>
        <p>
          You are responsible for your account, for the people you invite to your organization, and for activity under
          them. Keep your credentials confidential and tell us promptly about any misuse.
        </p>
      </section>
      <section>
        <h2>3. Your content and connected services</h2>
        <p>
          You keep ownership of your repositories and of the logs generated for you. You authorize the Service to read
          the repositories you select and to send the relevant activity to the AI provider you choose. You must have the
          right to do so, including for private repositories and third-party code.
        </p>
      </section>
      <section>
        <h2>4. Plans, billing and cancellation</h2>
        <p>
          Paid plans renew automatically until cancelled. You can cancel at any time from Settings; access continues until
          the end of the paid period. Fees already paid are non-refundable except where required by law.
        </p>
      </section>
      <section>
        <h2>5. Acceptable use</h2>
        <ul>
          <li>Do not attempt to disrupt the Service or access data that is not yours.</li>
          <li>Do not use the Service to generate unlawful or infringing content.</li>
          <li>Do not exceed fair-use limits or circumvent usage limits.</li>
        </ul>
      </section>
      <section>
        <h2>6. AI-generated output</h2>
        <p>
          Output is produced by AI models and may be inaccurate or incomplete. Review every log before you share or
          publish it. You are responsible for what you share.
        </p>
      </section>
      <section>
        <h2>7. Termination</h2>
        <p>
          You may stop using the Service at any time. We may suspend accounts that breach these terms. On termination
          your data is deleted as described in the Privacy Policy.
        </p>
      </section>
      <section>
        <h2>8. Disclaimers and liability</h2>
        <p>
          The Service is provided &quot;as is&quot;. To the extent permitted by law, {legal.companyName} is not liable
          for indirect or consequential losses, and total liability is limited to the fees you paid in the twelve months
          before the claim. These terms are governed by the laws of {legal.jurisdiction}.
        </p>
      </section>
      <section>
        <h2>9. Changes and contact</h2>
        <p>
          We may update these terms and will announce material changes. Questions: <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
