"use client";

import { useEffect } from "react";

// Replaces the root layout, so it brings its own document and avoids app styles and providers.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "4rem 1rem" }}>
        <h1 style={{ fontSize: "1.25rem" }}>Something went wrong</h1>
        <p style={{ color: "#666" }}>
          An unexpected error occurred.{error.digest ? ` Reference: ${error.digest}.` : ""}
        </p>
        <button onClick={() => retry()} style={{ padding: "0.5rem 1rem" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
