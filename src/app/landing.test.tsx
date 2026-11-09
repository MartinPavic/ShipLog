import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import { pricingCopyForMode } from "@/components/pricing-section";
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
    expect(out).toContain("GitLab activity");
    expect(out).toContain("self-managed GitLab");
    for (const f of siteConfig.features) expect(out).toContain(f.title);
    for (const item of siteConfig.faq) expect(out).toContain(item.q);
    expect(out).toContain(`mailto:${siteConfig.supportEmail}`);
    expect(out).toContain('href="/terms"');
    expect(out).toContain('href="/privacy"');
  });

  it("shows a clearly fictional report sample for clients and internal teams before feature and pricing details", () => {
    const out = html();
    expect(out).toContain("A week of work, two useful updates");
    expect(out).toContain("Fictional sample activity");
    expect(out).toContain("For clients");
    expect(out).toContain("For your team");
    expect(out).toContain("Client report");
    expect(out).toContain("Weekly update");
    expect(out.indexOf("A week of work, two useful updates")).toBeLessThan(out.indexOf("Connect GitHub or GitLab"));
    expect(out).toContain("Sample content only. No repository is connected.");
  });

  it("shows three pricing cards with BYOK selected by default and VAT-inclusive prices", () => {
    const out = html();
    expect(out).toContain("Simple pricing");
    expect(out).toContain("Free");
    expect(out).toContain("Pro");
    expect(out).toContain("Ultra");
    expect(out).toContain("BYOK");
    expect(out).toContain("Managed AI");
    expect(out).toContain("VAT included");
    expect(out).toContain("5 projects");
    expect(out).toContain("Unlimited projects");
    expect(out).toContain("5 generations / month with your own AI key");
    expect(out).toContain("50 generations / month with your own AI key");
    expect(out).toContain("Unlimited generations with your own AI key");
    expect(out).toContain(`${siteConfig.pricing.currency}12`);
    expect(out).toContain(`${siteConfig.pricing.currency}22`);
    expect(out).not.toContain(`${siteConfig.pricing.currency}19`);
    expect(out).not.toContain(`${siteConfig.pricing.currency}29`);
  });

  it("switches paid copy and checkout payloads when the selector changes mode", () => {
    expect(pricingCopyForMode("byok")).toEqual({
      pro: {
        price: 12,
        highlights: ["5 projects", "50 generations / month with your own AI key"],
        checkout: { tier: "pro", aiMode: "byok" },
      },
      ultra: {
        price: 22,
        highlights: ["Unlimited projects", "Unlimited generations with your own AI key"],
        checkout: { tier: "ultra", aiMode: "byok" },
      },
    });

    expect(pricingCopyForMode("managed")).toEqual({
      pro: {
        price: 19,
        highlights: ["5 projects", "50 managed-AI generations / month"],
        checkout: { tier: "pro", aiMode: "managed" },
      },
      ultra: {
        price: 29,
        highlights: ["Unlimited projects", "200 managed-AI generations / month"],
        checkout: { tier: "ultra", aiMode: "managed" },
      },
    });
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
