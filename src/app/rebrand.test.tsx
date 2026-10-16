import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import SharedNotFound from "@/app/s/[token]/not-found";
import ChangelogNotFound from "@/app/p/[ownerSlug]/[projectSlug]/not-found";
import { Brand } from "@/components/brand";
import { GithubCard } from "@/components/settings-form";
import { siteConfig } from "@/config/site";
import { buildOnboarding } from "@/lib/dashboard";

vi.mock("@clerk/nextjs", () => ({
  Show: ({ when, children }: { when: string; children: React.ReactNode }) => (when === "signed-out" ? children : null),
  SignInButton: ({ children }: { children: React.ReactNode }) => children,
  UserButton: () => null,
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("next/font/google", () => ({ Inter: () => ({ className: "" }) }));

// A buyer changes only src/config/site.ts. Nothing the product renders may still say the old name.
const ORIGINAL = { name: siteConfig.name, description: siteConfig.description };
const OLD = ORIGINAL.name;

beforeEach(() => {
  siteConfig.name = "Acme Reports";
  siteConfig.description = ORIGINAL.description.replaceAll(OLD, siteConfig.name);
});
afterEach(() => {
  Object.assign(siteConfig, ORIGINAL);
});

describe("rebranding through site config only", () => {
  const pages: [string, () => string][] = [
    ["landing page", () => renderToStaticMarkup(<Home />)],
    ["terms", () => renderToStaticMarkup(<TermsPage />)],
    ["privacy", () => renderToStaticMarkup(<PrivacyPage />)],
    ["shared-link not-found page", () => renderToStaticMarkup(<SharedNotFound />)],
    ["public changelog not-found page", () => renderToStaticMarkup(<ChangelogNotFound />)],
    ["header brand", () => renderToStaticMarkup(<Brand />)],
    ["GitHub settings card", () => renderToStaticMarkup(<GithubCard login={null} notice={null} />)],
    ["onboarding checklist copy", () => JSON.stringify(buildOnboarding({ github: false, ai: false, firstProjectId: null, hasLog: false }))],
  ];

  for (const [label, render] of pages) {
    it(`${label} shows the new name and never the old one`, () => {
      const html = render();
      expect(html).not.toMatch(new RegExp(OLD, "i"));
      if (label !== "onboarding checklist copy" && label !== "shared-link not-found page" && label !== "public changelog not-found page") {
        expect(html).toContain("Acme Reports");
      }
    });
  }

  it("not-found pages link back using the new name", () => {
    expect(renderToStaticMarkup(<SharedNotFound />)).toContain("Go to Acme Reports");
  });

  it("page titles and social metadata use the new name", async () => {
    // A fresh module graph evaluates the layout's module-level metadata with the edited config.
    vi.resetModules();
    const fresh = (await import("@/config/site")).siteConfig;
    fresh.name = siteConfig.name;
    fresh.description = siteConfig.description;
    const { metadata } = await import("@/app/layout");
    const text = JSON.stringify(metadata);
    expect(text).toContain("Acme Reports");
    expect(text).not.toMatch(new RegExp(OLD, "i"));
  });
});
