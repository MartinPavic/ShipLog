import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LogViewer } from "./log-viewer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/components/markdown", () => ({ Markdown: ({ children }: { children: string }) => <article>{children}</article> }));
vi.mock("@/components/export-menu", () => ({ ExportMenu: () => null }));
vi.mock("@/components/upgrade-button", () => ({ UpgradeButton: () => null }));
vi.mock("@/components/ui/badge", () => ({ Badge: ({ children }: { children: string }) => <span>{children}</span> }));
vi.mock("@/components/ui/button", () => ({ Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));
vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
}));
vi.mock("@/components/ui/input", () => ({ Input: () => null }));
vi.mock("@/components/ui/textarea", () => ({ Textarea: () => null }));

describe("LogViewer report header", () => {
  it("shows the generation time instead of repeating the report period", () => {
    const html = renderToStaticMarkup(
      <LogViewer
        projectId="project-id"
        pdfAllowed
        log={{
          id: "log-id",
          title: "Weekly report: 1 Oct 2026 – 7 Oct 2026",
          content: "Report body",
          pinned: false,
          status: "ready",
          periodStart: "2026-10-01T00:00:00Z",
          periodEnd: "2026-10-07T00:00:00Z",
          createdAt: "2026-10-08T12:34:00Z",
        }}
        versions={[]}
      />
    );

    expect(html).toContain("Generated 8 Oct 2026, 12:34");
  expect(html).not.toContain(">1 Oct 2026 – 7 Oct 2026<");
  });
});