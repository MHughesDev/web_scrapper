/**
 * Shared types for the scraping engine.
 *
 * These describe the structured, agent-friendly shapes returned by the
 * fetcher, extractor and crawler. Everything is JSON-serialisable so it can
 * flow straight through the REST engine and out to an MCP client.
 */

/** Output formats an agent can request for page content. */
export type OutputFormat = "markdown" | "text" | "html" | "json";

/** How a page should be retrieved. */
export type RenderMode = "http" | "browser";

/** A single hyperlink discovered on a page. */
export interface PageLink {
  url: string;
  text: string;
  /** True when the link points at the same registrable domain. */
  internal: boolean;
}

/** Structured metadata distilled from a page's <head> and JSON-LD. */
export interface PageMetadata {
  title?: string;
  description?: string;
  language?: string;
  author?: string;
  publishedTime?: string;
  modifiedTime?: string;
  siteName?: string;
  /** Canonical URL if declared. */
  canonical?: string;
  /** Open Graph properties (og:*). */
  openGraph: Record<string, string>;
  /** Twitter card properties (twitter:*). */
  twitter: Record<string, string>;
  /** Parsed JSON-LD blocks. */
  jsonLd: unknown[];
  /** Favicon URL if discoverable. */
  favicon?: string;
}

/** The result of fetching and processing a single page. */
export interface PageResult {
  url: string;
  /** The final URL after redirects. */
  finalUrl: string;
  status: number;
  ok: boolean;
  contentType?: string;
  /** How the page was retrieved. */
  renderMode: RenderMode;
  metadata: PageMetadata;
  /** Primary content rendered in the requested format. */
  content: string;
  format: OutputFormat;
  /** Estimated token count of `content` (cl100k_base / GPT-style). */
  tokenCount: number;
  /** Content split into context-window-sized chunks, when requested. */
  chunks?: string[];
  links: PageLink[];
  /** Word count of the extracted main content. */
  wordCount: number;
  /** Milliseconds spent fetching + processing. */
  elapsedMs: number;
  /** Populated when the fetch failed. */
  error?: string;
}

/** Options controlling a single page fetch. */
export interface FetchOptions {
  format?: OutputFormat;
  render?: RenderMode;
  /** Strip nav/boilerplate and keep only the main article content. */
  extractMain?: boolean;
  /** Include the list of links in the result. */
  includeLinks?: boolean;
  /** Split content into chunks of roughly this many tokens. */
  chunkTokens?: number;
  /** Truncate content to at most this many tokens (0 = no limit). */
  maxTokens?: number;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Custom User-Agent. */
  userAgent?: string;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Wait for this CSS selector before reading the DOM (browser mode). */
  waitForSelector?: string;
}

/** Options controlling a crawl. */
export interface CrawlOptions extends FetchOptions {
  /** How many link-hops to follow from the seed (0 = only the seed). */
  maxDepth?: number;
  /** Hard cap on the number of pages fetched. */
  maxPages?: number;
  /** Only follow links on the same registrable domain as the seed. */
  sameDomain?: boolean;
  /** Number of pages fetched concurrently. */
  concurrency?: number;
  /** Only crawl URLs whose path matches one of these regexes. */
  includePatterns?: string[];
  /** Skip URLs whose path matches one of these regexes. */
  excludePatterns?: string[];
  /** Respect robots.txt (default true). */
  respectRobots?: boolean;
  /** Politeness delay between requests to the same host, in ms. */
  delayMs?: number;
}

/** A page within a crawl, with the depth at which it was found. */
export interface CrawlPage extends PageResult {
  depth: number;
}

/** The aggregate result of a crawl. */
export interface CrawlResult {
  seed: string;
  pages: CrawlPage[];
  pagesCrawled: number;
  totalTokens: number;
  elapsedMs: number;
  /** URLs that were discovered but skipped (with reasons). */
  skipped: { url: string; reason: string }[];
}

/** A text match found while searching a page. */
export interface SearchMatch {
  url: string;
  /** The line/snippet containing the match. */
  snippet: string;
  /** Index of the match within the document. */
  index: number;
}
