"use client";

import { useState } from "react";
import { ProjectGenerate } from "@/components/project-generate";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TemplateView } from "@/lib/ai/templates";

type QuickProject = { id: string; name: string; defaultPeriodDays: number; template: string };

// The same generator as the project page, with a project picker in front.
export function QuickGenerate({
  projects,
  templates,
  initialProjectId,
  usage,
  setupMessage,
}: {
  projects: QuickProject[];
  templates: TemplateView[];
  initialProjectId: string;
  usage: { used: number; limit: number | null };
  setupMessage: string | null;
}) {
  const [projectId, setProjectId] = useState(initialProjectId);
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const items = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  return (
    <div className="space-y-4">
      {projects.length > 1 && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Project</span>
          <Select value={project.id} items={items} onValueChange={(v) => v && setProjectId(v)}>
            <SelectTrigger className="min-w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <ProjectGenerate
        key={project.id}
        projectId={project.id}
        defaultDays={project.defaultPeriodDays}
        defaultTemplate={project.template}
        templates={templates}
        setupMessage={setupMessage}
        usage={usage}
      />
    </div>
  );
}
