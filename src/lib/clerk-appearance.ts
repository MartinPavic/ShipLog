import type { ComponentProps } from "react";
import type { ClerkProvider } from "@clerk/nextjs";

type Appearance = NonNullable<ComponentProps<typeof ClerkProvider>["appearance"]>;

// CSS variables keep Clerk widgets in sync with the light/dark theme.
export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: "var(--primary)",
    colorPrimaryForeground: "var(--primary-foreground)",
    colorBackground: "var(--card)",
    colorForeground: "var(--foreground)",
    colorMutedForeground: "var(--muted-foreground)",
    colorInput: "var(--background)",
    colorInputForeground: "var(--foreground)",
    colorNeutral: "var(--foreground)",
    colorDanger: "var(--danger)",
    colorSuccess: "var(--success)",
    colorRing: "var(--ring)",
    colorBorder: "var(--border)",
    borderRadius: "0.375rem",
    fontFamily: "var(--font-inter), system-ui, sans-serif",
  },
  elements: {
    card: "border border-border shadow-sm",
    headerTitle: "font-heading",
  },
};
