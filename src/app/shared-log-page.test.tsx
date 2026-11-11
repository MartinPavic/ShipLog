import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "./s/[token]/page";

const state = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  log: {
    id: "log-id",
    title: "Weekly report: 1 Oct 2026 – 7 Oct 2026",
    content: "Report body",
    periodStart: new Date("2026-10-01"),
    periodEnd: new Date("2026-10-07"),
    createdAt: new Date("2026-10-08T12:34:00Z"),
    passwordHash: null as string | null,
    projectName: "Project",
    pdfAllowed: false,
  },
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined) }) }));
vi.mock("@/lib/public", () => ({
  getSharedLogForPage: async () => state.log,
}));
vi.mock("@/lib/share", () => ({ ACCESS_COOKIE: "share_access", verifyAccess: () => false }));
vi.mock("@/components/markdown", () => ({ Markdown: ({ children }: { children: string }) => <article>{children}</article> }));
vi.mock("@/components/share-password-gate", () => ({ SharePasswordGate: () => <p>Enter password</p> }));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => <button>Theme</button> }));
vi.mock("@/components/export-menu", () => ({ PrintButton: () => <button>Print / Save as PDF</button> }));

beforeEach(() => {
  state.cookie = undefined;
  Object.assign(state.log, { passwordHash: null, pdfAllowed: false });
});

async function render() {
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ token: "share-token" }) }));
}

describe("shared log page", () => {
  it("shows when the report was generated instead of repeating its period", async () => {
    const html = await render();

    expect(html).toContain("Generated 8 Oct 2026, 12:34");
    expect(html).not.toContain(">1 Oct 2026 – 7 Oct 2026<");
  });

  it("offers PDF printing for a Pro report", async () => {
    state.log.pdfAllowed = true;

    expect(await render()).toContain("Print / Save as PDF");
  });

  it("does not offer PDF printing for a Free report", async () => {
    expect(await render()).not.toContain("Print / Save as PDF");
  });

  it("does not expose the report or PDF action before a password-protected link is unlocked", async () => {
    state.log.passwordHash = "password-hash";
    state.log.pdfAllowed = true;

    const html = await render();
    expect(html).toContain("Enter password");
    expect(html).not.toContain("Report body");
    expect(html).not.toContain("Print / Save as PDF");
  });
});