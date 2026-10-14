import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { slugify } from "@/lib/slug";

export const EXPORT_FORMATS = ["markdown", "html", "slack"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

// Raw HTML in the Markdown is dropped and the result sanitised, so unsafe links and scripts can't survive.
export async function toHtml(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize)
    .use(rehypeStringify)
    .process(markdown);
  return String(file);
}

const MARK = {
  link: (i: number) => `\u0002${i}\u0002`,
  bold: "\u0001",
};

function convertInline(text: string): string {
  const links: string[] = [];
  let out = text.replace(/\[([^\]]+)\]\((\S+?)\)/g, (_m, label: string, url: string) => {
    links.push(`<${url}|${label.replace(/[*_`]/g, "")}>`);
    return MARK.link(links.length - 1);
  });
  out = out.replace(/(\*\*|__)(.+?)\1/g, `${MARK.bold}$2${MARK.bold}`);
  out = out.replace(/(?<![\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])/g, "_$1_");
  out = out.replace(/~~(.+?)~~/g, "~$1~");
  out = out.split(MARK.bold).join("*");
  return out.replace(/\u0002(\d+)\u0002/g, (_m, i: string) => links[Number(i)]);
}

// Slack's mrkdwn: *bold*, _italic_, <url|label>, bullets as "•". Tables are left as-is.
export function toSlackMrkdwn(markdown: string): string {
  let inFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;

      const heading = /^#{1,6}\s+(.*)$/.exec(line);
      if (heading) return `*${convertSegments(heading[1]).replace(/\*/g, "")}*`;

      const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
      if (bullet) return `${bullet[1]}• ${convertSegments(bullet[2])}`;

      return convertSegments(line);
    })
    .join("\n");
}

// Inline code spans pass through untouched.
function convertSegments(line: string): string {
  return line
    .split(/(`[^`]*`)/g)
    .map((part, i) => (i % 2 === 1 ? part : convertInline(part)))
    .join("");
}

export function exportFilename(title: string, extension = "md"): string {
  return `${slugify(title)}.${extension}`;
}
