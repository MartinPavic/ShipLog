import { describe, expect, it } from "vitest";
import { complete, openCompletionStream } from "./providers";
import { mockLogText, streamMockLog } from "./mock";

const prompt = [
  "Period: 2026-01-01 to 2026-01-07",
  "## acme/web",
  "Merged pull requests:",
  '- #12 Add dark mode [feature] (ana, 2026-01-03): Adds a theme toggle',
  "Commits:",
  "- Fix flaky test (2026-01-04)",
  "- Bump deps (2026-01-05)",
].join("\n");

describe("mock AI provider", () => {
  it("rebuilds a log from the activity in the prompt", () => {
    const text = mockLogText(prompt);
    expect(text).toContain("## Highlights");
    expect(text).toContain("- #12 Add dark mode [feature] (ana, 2026-01-03): Adds a theme toggle");
    expect(text).toContain("- Fix flaky test");
    expect(text).not.toContain("(2026-01-04)");
    expect(text).toContain("placeholder output");
  });

  it("is deterministic and says so when there is no activity", () => {
    expect(mockLogText(prompt)).toBe(mockLogText(prompt));
    expect(mockLogText("nothing here")).toContain("No activity was found");
  });

  it("caps the number of listed items", () => {
    const many = Array.from({ length: 30 }, (_, i) => `- item ${i}`).join("\n");
    expect(mockLogText(many).match(/^- item/gm)).toHaveLength(8);
  });

  it("streams the same text in several chunks", async () => {
    const chunks: string[] = [];
    for await (const c of streamMockLog(prompt)) chunks.push(c);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.join("")).toBe(mockLogText(prompt));
  });

  it("stops streaming when aborted", async () => {
    const controller = new AbortController();
    const received: string[] = [];
    await expect(
      (async () => {
        for await (const c of streamMockLog(prompt, controller.signal)) {
          received.push(c);
          controller.abort();
        }
      })()
    ).rejects.toBeDefined();
    expect(received).toHaveLength(1);
  });

  it("plugs into complete() and openCompletionStream() without any network or key", async () => {
    const input = { provider: "mock" as const, key: "mock", model: "mock", prompt };
    expect(await complete(input)).toBe(mockLogText(prompt));
    let streamed = "";
    for await (const c of await openCompletionStream(input)) streamed += c;
    expect(streamed).toBe(mockLogText(prompt));
  });
});
