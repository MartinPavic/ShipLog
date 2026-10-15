import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import GlobalError from "@/app/global-error";
import AppNotFound from "@/app/not-found";
import DashboardNotFound from "@/app/dashboard/not-found";
import ProjectNotFound from "@/app/dashboard/projects/[id]/not-found";
import PublicChangelogNotFound from "@/app/p/[ownerSlug]/[projectSlug]/not-found";
import ShareNotFound from "@/app/s/[token]/not-found";
import { ErrorPanel } from "@/components/error-panel";
import { PageSkeleton } from "@/components/page-skeleton";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  // Effects don't run during server rendering anyway; this keeps the test about markup.
  return { ...actual, useEffect: () => {} };
});

const secretError = Object.assign(new Error("password=hunter2 at /srv/app/db.ts:42"), { digest: "abc123" });

describe("ErrorPanel", () => {
  const html = renderToStaticMarkup(<ErrorPanel error={secretError} retry={() => {}} backHref="/dashboard" backLabel="Dashboard" />);

  it("is announced as an alert with a way to retry and a way out", () => {
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try again");
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain("Dashboard");
  });

  it("shows only the reference digest, never the error message", () => {
    expect(html).toContain("reference abc123");
    expect(html).not.toContain("hunter2");
    expect(html).not.toContain("db.ts");
  });

  it("omits the reference when there is no digest", () => {
    const plain = renderToStaticMarkup(<ErrorPanel error={new Error("x")} retry={() => {}} />);
    expect(plain).not.toContain("reference");
    expect(plain).not.toContain("<a ");
  });
});

describe("GlobalError", () => {
  it("brings its own document and hides the message", () => {
    const html = renderToStaticMarkup(<GlobalError error={secretError} retry={() => {}} />);
    expect(html).toContain("<html");
    expect(html).toContain("<body");
    expect(html).toContain("Reference: abc123");
    expect(html).not.toContain("hunter2");
  });
});

describe("not-found pages", () => {
  it("point people somewhere useful", () => {
    expect(renderToStaticMarkup(<AppNotFound />)).toContain('href="/"');
    expect(renderToStaticMarkup(<DashboardNotFound />)).toContain('href="/dashboard"');
    expect(renderToStaticMarkup(<ProjectNotFound />)).toContain('href="/dashboard/projects"');
  });

  it("give public links one neutral answer that reveals nothing about their state", () => {
    const share = renderToStaticMarkup(<ShareNotFound />);
    const changelog = renderToStaticMarkup(<PublicChangelogNotFound />);
    expect(share).toBe(changelog);
    expect(share).toContain("This link isn&#x27;t available");
    expect(share).not.toMatch(/password|expired|private|deleted/i);
  });

  it("don't leak whether a resource exists in another workspace", () => {
    const html = renderToStaticMarkup(<ProjectNotFound />);
    expect(html).toContain("doesn&#x27;t exist, or you don&#x27;t have access");
  });
});

describe("PageSkeleton", () => {
  it("is an accessible loading placeholder with the requested number of blocks", () => {
    const html = renderToStaticMarkup(<PageSkeleton rows={4} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading"');
    expect(html.match(/h-24/g)).toHaveLength(4);
  });
});
