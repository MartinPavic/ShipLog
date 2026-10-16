import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { siteConfig } from "@/config/site";
import { appUrl } from "@/lib/app-url";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

const title = `${siteConfig.name} — ${siteConfig.tagline} ${siteConfig.taglineMuted}`;

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: { default: title, template: `%s — ${siteConfig.name}` },
  description: siteConfig.description,
  openGraph: { title, description: siteConfig.description, siteName: siteConfig.name, type: "website" },
  twitter: { card: "summary_large_image", title, description: siteConfig.description },
};

// Only set when the buyer configured brand colors; otherwise the theme in globals.css applies.
function brandStyle(): React.CSSProperties | undefined {
  const { primary, primaryForeground } = siteConfig.brand;
  if (!primary && !primaryForeground) return undefined;
  return {
    ...(primary ? { "--primary": primary, "--sidebar-primary": primary } : {}),
    ...(primaryForeground ? { "--primary-foreground": primaryForeground, "--sidebar-primary-foreground": primaryForeground } : {}),
  } as React.CSSProperties;
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning style={brandStyle()}>
        <body className={`${inter.className} antialiased`}>{children}</body>
      </html>
    </ClerkProvider>
  );
}
