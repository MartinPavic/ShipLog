import Image from "next/image";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

export function Brand({ className }: { className?: string }) {
  const { logo, name } = siteConfig;
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold", className)}>
      {logo && <Image src={logo.src} alt={logo.alt} width={24} height={24} unoptimized />}
      {name}
    </span>
  );
}
