import Image from "next/image";
import { ShipWheel } from "@/components/nautical/ship-wheel";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

export function Brand({ className }: { className?: string }) {
  const { logo, name } = siteConfig;
  return (
    <span className={cn("inline-flex items-center gap-2 font-heading font-semibold", className)}>
      {logo ? <Image src={logo.src} alt={logo.alt} width={24} height={24} unoptimized /> : <ShipWheel className="size-6 text-brass" />}
      {name}
    </span>
  );
}
