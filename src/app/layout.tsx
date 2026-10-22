import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "@/components/theme-provider";
import { siteConfig } from "@/config/site";
import { appUrl } from "@/lib/app-url";
import { clerkAppearance } from "@/lib/clerk-appearance";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-display" });

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
    <ClerkProvider appearance={clerkAppearance}>
      <html lang="en" suppressHydrationWarning className={`${inter.variable} ${fraunces.variable}`} style={brandStyle()}>
        <body className="antialiased">
          <ThemeProvider>{children}</ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
