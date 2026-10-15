"use client";

import { ErrorPanel } from "@/components/error-panel";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="container mx-auto px-4">
      <ErrorPanel error={error} retry={retry} />
    </main>
  );
}
