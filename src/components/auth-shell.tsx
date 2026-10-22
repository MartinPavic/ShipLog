import Link from "next/link";
import { Brand } from "@/components/brand";
import { ShipWheel } from "@/components/nautical/ship-wheel";
import { WaveDivider } from "@/components/nautical/wave-divider";
import { ThemeToggle } from "@/components/theme-toggle";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-6 overflow-hidden px-4">
      <ShipWheel className="pointer-events-none absolute -left-24 -top-24 size-96 text-brass opacity-10" />
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <Link href="/" className="relative text-2xl">
        <Brand />
      </Link>
      <div className="relative">{children}</div>
      <WaveDivider className="absolute inset-x-0 bottom-0 text-secondary" />
    </div>
  );
}
