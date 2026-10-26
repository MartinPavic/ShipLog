import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AUDIENCE_PRESETS, PresetField, TONE_PRESETS } from "./preset-field";

const render = (value: string) =>
  renderToStaticMarkup(
    <PresetField
      id="tone"
      label="Tone"
      help="How the log sounds."
      presets={TONE_PRESETS}
      value={value}
      onChange={() => {}}
      maxLength={100}
      placeholder="e.g."
    />
  );

describe("PresetField", () => {
  it("explains the field and offers suggestions", () => {
    const html = render("");
    expect(html).toContain("How the log sounds.");
    for (const p of TONE_PRESETS) expect(html).toContain(p.value);
    expect(html).not.toContain("Effect:");
  });

  it("shows what the chosen suggestion does, ignoring case and spacing", () => {
    const html = render("  Short and Direct ");
    expect(html).toContain("Effect: Fewer words");
    expect(html).toContain('aria-pressed="true"');
  });

  it("describes every suggestion", () => {
    for (const p of [...TONE_PRESETS, ...AUDIENCE_PRESETS]) expect(p.effect.length).toBeGreaterThan(30);
  });
});
