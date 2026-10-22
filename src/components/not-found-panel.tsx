import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export function NotFoundPanel({
  title = "Lost at sea",
  message = "This page has drifted off the chart. It may have been moved or deleted.",
  href,
  label,
}: {
  title?: string;
  message?: string;
  href: string;
  label: string;
}) {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Link href={href} className={buttonVariants()}>
        {label}
      </Link>
    </div>
  );
}
