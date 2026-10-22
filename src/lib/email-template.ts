import { siteConfig } from "@/config/site";

// Email clients ignore external CSS and web fonts, so everything is inline with web-safe stacks.
export function emailLayout(bodyHtml: string): string {
  const name = siteConfig.name.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<div style="background:#f3ead6;padding:24px 12px;font-family:Georgia,'Times New Roman',serif;color:#1c2a44;">
<div style="max-width:640px;margin:0 auto;background:#fbf5e6;border:1px solid #d9c9a3;border-top:4px double #a07a2a;padding:24px 28px;line-height:1.55;">
<p style="margin:0 0 16px;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#7a5a1a;">${name} &middot; Ship&rsquo;s log</p>
${bodyHtml}
</div>
</div>`;
}
