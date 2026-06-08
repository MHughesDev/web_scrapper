/**
 * In-page text search.
 *
 * Lets an agent locate specific information on a page without ingesting the
 * whole document: returns matching snippets with surrounding context, ranked by
 * order of appearance. The query may be plain text or a regular expression.
 */
import { scrapePage } from "./scrape.js";
import type { FetchOptions, SearchMatch } from "./types.js";

export interface SearchOptions extends FetchOptions {
  /** Treat the query as a regular expression. */
  regex?: boolean;
  /** Case-insensitive matching (default true). */
  ignoreCase?: boolean;
  /** Characters of context to include on each side of a match. */
  contextChars?: number;
  /** Maximum number of matches to return. */
  maxMatches?: number;
}

export async function searchPage(
  url: string,
  query: string,
  options: SearchOptions = {},
): Promise<{ url: string; matches: SearchMatch[]; totalMatches: number }> {
  const {
    regex = false,
    ignoreCase = true,
    contextChars = 160,
    maxMatches = 20,
    ...fetchOpts
  } = options;

  // Search against clean text by default for the most relevant hits.
  const page = await scrapePage(url, { ...fetchOpts, format: fetchOpts.format ?? "text" });
  const text = page.content;

  const flags = `g${ignoreCase ? "i" : ""}`;
  const pattern = regex
    ? new RegExp(query, flags)
    : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);

  const matches: SearchMatch[] = [];
  let m: RegExpExecArray | null;
  let total = 0;
  while ((m = pattern.exec(text)) !== null) {
    total++;
    if (matches.length < maxMatches) {
      const start = Math.max(0, m.index - contextChars);
      const end = Math.min(text.length, m.index + m[0].length + contextChars);
      let snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
      if (start > 0) snippet = "…" + snippet;
      if (end < text.length) snippet = snippet + "…";
      matches.push({ url: page.finalUrl, snippet, index: m.index });
    }
    // Guard against zero-width matches looping forever.
    if (m.index === pattern.lastIndex) pattern.lastIndex++;
  }

  return { url: page.finalUrl, matches, totalMatches: total };
}
