import { NotFoundPanel } from "@/components/not-found-panel";

export default function NotFound() {
  return (
    <NotFoundPanel
      title="Not found"
      message="This project or log doesn't exist, or you don't have access to it."
      href="/dashboard/projects"
      label="All projects"
    />
  );
}
