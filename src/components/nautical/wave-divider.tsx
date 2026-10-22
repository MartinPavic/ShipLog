import { cn } from "@/lib/utils";

/** Full-width wave edge; set the colour with `text-*` (it fills with currentColor). */
export function WaveDivider({ className, flip }: { className?: string; flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 1200 40"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn("block h-6 w-full fill-current md:h-10", flip && "rotate-180", className)}
    >
      <path d="M0 20 Q 75 0 150 20 T 300 20 T 450 20 T 600 20 T 750 20 T 900 20 T 1050 20 T 1200 20 V40 H0 Z" />
    </svg>
  );
}
