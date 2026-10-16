import { siteConfig } from "@/config/site";
import { NotFoundPanel } from "@/components/not-found-panel";

// Same answer for unknown, removed and malformed links, so nothing about their state is revealed.
export default function NotFound() {
  return (
    <main className="container mx-auto px-4">
      <NotFoundPanel
        title="This link isn't available"
        message="It may have been removed, or the address may be wrong."
        href="/"
        label={`Go to ${siteConfig.name}`}
      />
    </main>
  );
}
