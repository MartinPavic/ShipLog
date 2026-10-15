import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { UsageMeter } from "@/components/usage-meter";
import { buildOnboarding } from "@/lib/dashboard";

const render = (input: Parameters<typeof buildOnboarding>[0]) => {
  const { steps, next } = buildOnboarding(input);
  return renderToStaticMarkup(<OnboardingChecklist steps={steps} next={next} />);
};

describe("OnboardingChecklist", () => {
  it("shows progress and a single call to action for the next step", () => {
    const html = render({ github: true, ai: false, firstProjectId: null, hasLog: false });
    expect(html).toContain("1 of 4 steps done");
    expect(html).toContain("Connect GitHub");
    expect(html).toContain("(done)");
    // Only the next step gets a button; its description is shown, completed ones are struck through.
    expect(html.match(/href="\/dashboard\/settings"/g)).toHaveLength(1);
    expect(html).toContain("Use your own OpenAI, Anthropic or Grok key");
    expect(html).toContain("line-through");
    expect(html).not.toContain("Let ShipLog read the commits");
  });

  it("links the last step to the first project once there is one", () => {
    const html = render({ github: true, ai: true, firstProjectId: "p-123", hasLog: false });
    expect(html).toContain("3 of 4 steps done");
    expect(html).toContain('href="/dashboard/projects/p-123"');
  });

  it("marks every step done when finished", () => {
    const html = render({ github: true, ai: true, firstProjectId: "p", hasLog: true });
    expect(html).toContain("4 of 4 steps done");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("(to do)");
  });
});

describe("UsageMeter", () => {
  it("shows used / limit with an accessible progress bar", () => {
    const html = renderToStaticMarkup(<UsageMeter used={3} limit={5} />);
    expect(html).toContain("3 / 5 generations this month");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="3"');
    expect(html).toContain('aria-valuemax="5"');
    expect(html).toContain("width:60%");
  });

  it("turns red and caps at 100% when the limit is reached or exceeded", () => {
    const html = renderToStaticMarkup(<UsageMeter used={9} limit={5} />);
    expect(html).toContain("width:100%");
    expect(html).toContain("bg-red-500");
  });

  it("shows a plain count when there is no limit, and survives a zero limit", () => {
    const unlimited = renderToStaticMarkup(<UsageMeter used={12} limit={null} />);
    expect(unlimited).toContain("12 generations this month");
    expect(unlimited).not.toContain("progressbar");
    expect(() => renderToStaticMarkup(<UsageMeter used={0} limit={0} />)).not.toThrow();
  });
});
