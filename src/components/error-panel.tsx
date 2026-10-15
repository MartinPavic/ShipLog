"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";

// The message is deliberately generic: server errors can carry details that must not reach the browser.
export function ErrorPanel({
  error,
  retry,
  title = "Something went wrong",
  backHref,
  backLabel,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  title?: string;
  backHref?: string;
  backLabel?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">
        An unexpected error occurred. You can try again, and if it keeps happening, contact support
        {error.digest ? ` and mention reference ${error.digest}` : ""}.
      </p>
      <div className="flex justify-center gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        {backHref && (
          <Link href={backHref} className={buttonVariants({ variant: "outline" })}>
            {backLabel ?? "Go back"}
          </Link>
        )}
      </div>
    </div>
  );
}
