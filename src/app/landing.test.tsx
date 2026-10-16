import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import { siteConfig } from "@/config/site";

vi.mock("@clerk/nextjs", () => ({
  Show: ({ when, children }: { when: string; children: React.ReactNode }) => (when === "signed-out" ? children : null),
  SignInButton: ({ children }: { children: React.ReactNode }) => children,
  UserButton: () => null,
}));

afterEach(() => {
  delete process.env.BILLING_ENABLED;
  delete process.env.TEAMS_ENABLED;
  delete process.env.MANAGED_AI_ENABLED;
  vi.unstubAllGlobals();
});

describe("landing page", () => {
  const html = () => renderToStaticMarkup(<Home />);

  it("is built from the site config", () => {
    const out = html();
    expect(out).toContain(siteConfig.name);
    expect(out).toContain(siteConfig.description);
    for (const f of siteConfig.features) expect(out).toContain(f.title);
    for (const item of siteConfig.faq) expect(out).toContain(item.q);
    expect(out).toContain(`mailto:${siteConfig.supportEmail}`);
    expect(out).toContain('href="/terms"');
    expect(out).toContain('href="/privacy"');
  });

  it("shows pricing derived from the real plan limits", () => {
    const out = html();
    expect(out).toContain("Simple pricing");
    expect(out).toContain("5 generations / month with your own AI key");
    expect(out).toContain("200 managed-AI generations / month");
    expect(out).toContain(`${siteConfig.pricing.currency}${siteConfig.pricing.pro.price}`);
  });

  it("drops managed AI and teams from the pricing when those are switched off", () => {
    process.env.MANAGED_AI_ENABLED = "false";
    process.env.TEAMS_ENABLED = "false";
    const out = html();
    expect(out).not.toContain("managed-AI");
    expect(out).not.toContain("Teams with organizations");
  });

  it("hides pricing entirely when billing is off", () => {
    process.env.BILLING_ENABLED = "false";
    const out = html();
    expect(out).not.toContain("Simple pricing");
    expect(out).not.toContain("Upgrade to Pro");
  });

  it("no longer describes the old token flow", () => {
    expect(html()).not.toMatch(/personal access token/i);
  });
});

describe("legal pages", () => {
  it("are marked as templates until reviewed, and use the company details from the config", () => {
    for (const Page of [TermsPage, PrivacyPage]) {
      const out = renderToStaticMarkup(<Page />);
      expect(out).toContain("Template, not legal advice");
      expect(out).toContain(siteConfig.legal.companyName);
      expect(out).toContain(siteConfig.supportEmail);
    }
  });

  it("drop the banner once the buyer marks them reviewed", () => {
    siteConfig.legal.reviewed = true;
    try {
      expect(renderToStaticMarkup(<TermsPage />)).not.toContain("Template, not legal advice");
    } finally {
      siteConfig.legal.reviewed = false;
    }
  });
});
