"use client";

import { useEffect, useRef, useState } from "react";
import { ProjectGenerate } from "@/components/project-generate";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TemplateView } from "@/lib/ai/templates";
import { PROJECT_COOKIE } from "@/lib/constants";

type QuickProject = { id: string; name: string; defaultPeriodDays: number; template: string };

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
  const projectTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const items = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  useEffect(() => {
    if (restoreFocusRef.current) {
      projectTriggerRef.current?.focus();
      restoreFocusRef.current = false;
    }
  }, [projectId]);

  if (!project) return null;

  return (
    <ProjectGenerate
      key={project.id}
      projectId={project.id}
      defaultDays={project.defaultPeriodDays}
      defaultTemplate={project.template}
      templates={templates}
      setupMessage={setupMessage}
      usage={usage}
      projectField={
        <div className="min-w-0 space-y-2">
          <Label htmlFor="quick-project">Project</Label>
          <Select value={project.id} items={items} onValueChange={(value) => {
            if (!value || !projects.some((candidate) => candidate.id === value)) return;
            restoreFocusRef.current = value !== project.id;
            setProjectId(value);
            document.cookie = `${PROJECT_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
          }}>
            <SelectTrigger ref={projectTriggerRef} id="quick-project" className="w-full">
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
      }
    />
  );
}
