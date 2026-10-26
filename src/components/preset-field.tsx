"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Preset = { value: string; effect: string };

export const TONE_PRESETS: Preset[] = [
  { value: "friendly and upbeat", effect: "Warm, casual wording that celebrates progress. Good for customer-facing updates." },
  { value: "professional and formal", effect: "Neutral, polished wording with no slang. Good for clients and management." },
  { value: "short and direct", effect: "Fewer words and no filler, so each point reads as a quick fact. Good for standups." },
  { value: "enthusiastic", effect: "Energetic wording that highlights wins. Good for launches and public changelogs." },
];

export const AUDIENCE_PRESETS: Preset[] = [
  { value: "customers", effect: "Focuses on what users can now do and what got better for them, without internal jargon." },
  { value: "non-technical stakeholders", effect: "Explains outcomes and business value in everyday language, leaving out technical detail." },
  { value: "engineering team", effect: "Allows technical terms and more detail, such as what was refactored or which areas changed." },
  { value: "investors", effect: "Emphasizes momentum and product progress in concise, factual terms, without inventing metrics." },
];

export function PresetField({
  id,
  label,
  help,
  presets,
  value,
  onChange,
  maxLength,
  placeholder,
}: {
  id: string;
  label: string;
  help: string;
  presets: Preset[];
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder: string;
}) {
  const active = presets.find((p) => p.value === value.trim().toLowerCase());

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} maxLength={maxLength} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      <p className="text-xs text-muted-foreground">{help}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${label} suggestions`}>
        {presets.map((p) => (
          <Button
            key={p.value}
            type="button"
            size="xs"
            variant={active === p ? "default" : "outline"}
            aria-pressed={active === p}
            onClick={() => onChange(active === p ? "" : p.value)}
          >
            {p.value}
          </Button>
        ))}
      </div>
      {active && <p className="text-xs text-muted-foreground">Effect: {active.effect}</p>}
    </div>
  );
}
