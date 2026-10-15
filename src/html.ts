const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

export interface HtmlText {
  /** Plain text, paragraphs separated by blank lines. */
  text: string;
  /** Absolute http(s) links found in anchors, in order, de-duplicated. */
  links: string[];
}

/**
 * Converts the small HTML subset HN uses in comments (<p>, <a>, <i>, <pre><code>)
 * into plain text. Anchor text is replaced by its href, which HN shows verbatim anyway.
 */
export function htmlToText(html: string): HtmlText {
  const links: string[] = [];
  let s = html.replace(/<a\s[^>]*?href="([^"]*)"[^>]*>[\s\S]*?<\/a>/gi, (_m, href: string) => {
    const url = decodeEntities(href);
    if (/^https?:\/\//i.test(url) && !links.includes(url)) links.push(url);
    return url;
  });
  s = s.replace(/<p>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
  s = decodeEntities(s)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: s, links };
}
