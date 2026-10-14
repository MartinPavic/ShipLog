"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "next/link";
import { PROJECT_COOKIE } from "@/lib/constants";

function rememberProject(id: string) {
  document.cookie = `${PROJECT_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
}

export function ProjectSwitcher({ projects }: { projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const currentId = /^\/dashboard\/projects\/([0-9a-f-]{36})/i.exec(pathname)?.[1] ?? null;

  useEffect(() => {
    if (currentId) rememberProject(currentId);
  }, [currentId]);

  if (projects.length === 0) {
    return (
      <Link href="/dashboard/projects" className="text-sm text-muted-foreground hover:text-foreground">
        Create a project
      </Link>
    );
  }

  const items = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  return (
    <Select
      value={currentId && items[currentId] ? currentId : null}
      items={items}
      onValueChange={(id) => {
        if (!id) return;
        rememberProject(id);
        router.push(`/dashboard/projects/${id}`);
      }}
    >
      <SelectTrigger size="sm" className="min-w-40">
        <SelectValue placeholder="Select project" />
      </SelectTrigger>
      <SelectContent>
        {projects.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
