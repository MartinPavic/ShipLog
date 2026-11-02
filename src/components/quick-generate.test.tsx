import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickGenerate } from "./quick-generate";

const controls = vi.hoisted(() => ({ change: undefined as undefined | ((value: string | null) => void) }));

vi.mock("@/components/project-generate", () => ({
  ProjectGenerate: (props: { projectId: string; defaultDays: number; defaultTemplate: string; projectField?: React.ReactNode }) => (
    <div data-project={props.projectId} data-days={props.defaultDays} data-template={props.defaultTemplate}>{props.projectField}</div>
  ),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange }: { children: React.ReactNode; onValueChange: typeof controls.change }) => {
    controls.change = onValueChange;
    return <div>{children}</div>;
  },
  SelectTrigger: ({ children, ...props }: ComponentProps<"button">) => <button {...props}>{children}</button>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const projects = [
  { id: "alpha", name: "Alpha", defaultPeriodDays: 7, template: "weekly_update" },
  { id: "beta", name: "Beta", defaultPeriodDays: 14, template: "client_report" },
];
const render = (available = projects, initialProjectId = "alpha") => renderToStaticMarkup(
  <QuickGenerate projects={available} initialProjectId={initialProjectId} templates={[]} usage={{ used: 0, limit: 5 }} setupMessage={null} />
);

afterEach(() => vi.unstubAllGlobals());

describe("QuickGenerate", () => {
  it("always shows an associated project label, including with one project", () => {
    const html = render(projects.slice(0, 1));
    expect(html).toContain('for="quick-project"');
    expect(html).toContain('id="quick-project"');
    expect(html).toContain("Alpha");
  });

  it("loads the remembered project's defaults and falls back from an unavailable project", () => {
    expect(render(projects, "beta")).toContain('data-project="beta" data-days="14" data-template="client_report"');
    expect(render(projects, "other-owner-project")).toContain('data-project="alpha"');
  });

  it("remembers only a valid selection for future visits", () => {
    const document = { cookie: "" };
    vi.stubGlobal("document", document);
    render();
    controls.change?.("beta");
    expect(document.cookie).toBe("active_project=beta; path=/; max-age=31536000; samesite=lax");
    document.cookie = "";
    controls.change?.("other-owner-project");
    controls.change?.(null);
    expect(document.cookie).toBe("");
  });

  it("handles an empty project list without rendering a generator", () => {
    expect(render([])).not.toContain("data-project");
  });
});