"use client";

import { useEffect } from "react";

// Replaces the root layout, so it brings its own document and avoids app styles and providers.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "Georgia, serif", textAlign: "center", padding: "4rem 1rem", background: "#f3ead6", color: "#1c2a44" }}>
        <h1 style={{ fontSize: "1.5rem" }}>Something went wrong</h1>
        <p style={{ color: "#4a5670" }}>
          An unexpected error occurred.{error.digest ? ` Reference: ${error.digest}.` : ""}
        </p>
        <button
          onClick={() => retry()}
          style={{ padding: "0.5rem 1rem", background: "#7a5a1a", color: "#fbf5e6", border: 0, borderRadius: 4, cursor: "pointer" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
