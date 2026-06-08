/**
 * Concurrent, breadth-first site crawler.
 *
 * Built for agents that need to ingest a whole section of a site (docs, blogs,
 * knowledge bases) in one call: depth- and page-bounded, same-domain by
 * default, robots-aware, with include/exclude path filters, a politeness
 * delay, and bounded concurrency.
 */
import pLimit from "p-limit";
import { URL } from "node:url";
import { scrapePage } from "./scrape.js";
import { sameRegistrableDomain } from "./metadata.js";
import { isAllowed } from "./robots.js";
import { DEFAULT_USER_AGENT } from "./fetcher.js";
import type { CrawlOptions, CrawlPage, CrawlResult } from "./types.js";

interface QueueItem {
  url: string;
  depth: number;
}

function compilePatterns(patterns?: string[]): RegExp[] {
  if (!patterns) return [];
  return patterns
    .map((p) => {
      try {
        return new RegExp(p);
      } catch {
        return null;
      }
    })
    .filter((r): r is RegExp => r !== null);
}

/** Normalise a URL for visited-set comparison (drop fragment + trailing slash). */
function normalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return url;
  }
}

export async function crawlSite(
  seed: string,
  options: CrawlOptions = {},
): Promise<CrawlResult> {
  const {
    maxDepth = 2,
    maxPages = 25,
    sameDomain = true,
    concurrency = 5,
    includePatterns,
    excludePatterns,
    respectRobots = true,
    delayMs = 0,
    userAgent = DEFAULT_USER_AGENT,
    ...fetchOpts
  } = options;

  const started = Date.now();
  const includeRe = compilePatterns(includePatterns);
  const excludeRe = compilePatterns(excludePatterns);

  const visited = new Set<string>();
  const pages: CrawlPage[] = [];
  const skipped: { url: string; reason: string }[] = [];
  const limit = pLimit(Math.max(1, concurrency));

  let frontier: QueueItem[] = [{ url: normalize(seed), depth: 0 }];
  visited.add(normalize(seed));

  const shouldFollow = (url: string): string | null => {
    if (sameDomain && !sameRegistrableDomain(url, seed)) return "off-domain";
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      return "invalid-url";
    }
    if (includeRe.length && !includeRe.some((r) => r.test(path) || r.test(url)))
      return "no-include-match";
    if (excludeRe.length && excludeRe.some((r) => r.test(path) || r.test(url)))
      return "exclude-match";
    return null;
  };

  // Process the frontier level by level so depth limits are exact.
  while (frontier.length > 0 && pages.length < maxPages) {
    const currentLevel = frontier;
    frontier = [];

    const tasks = currentLevel.map((item) =>
      limit(async (): Promise<void> => {
        if (pages.length >= maxPages) return;

        if (respectRobots && !(await isAllowed(item.url, userAgent))) {
          skipped.push({ url: item.url, reason: "robots-disallow" });
          return;
        }

        if (delayMs > 0) await sleep(delayMs);

        const page = await scrapePage(item.url, { ...fetchOpts, userAgent });
        if (pages.length >= maxPages) return;
        pages.push({ ...page, depth: item.depth });

        // Enqueue children if we still have depth and page budget.
        if (item.depth < maxDepth && page.ok) {
          for (const link of page.links) {
            const norm = normalize(link.url);
            if (visited.has(norm)) continue;
            const reason = shouldFollow(norm);
            if (reason) {
              // Only record the first time we reject a given URL.
              if (!visited.has(norm)) skipped.push({ url: norm, reason });
              visited.add(norm);
              continue;
            }
            visited.add(norm);
            frontier.push({ url: norm, depth: item.depth + 1 });
          }
        }
      }),
    );

    await Promise.all(tasks);
  }

  // Respect the page cap exactly even if concurrency overshot.
  const trimmed = pages.slice(0, maxPages);

  return {
    seed,
    pages: trimmed,
    pagesCrawled: trimmed.length,
    totalTokens: trimmed.reduce((sum, p) => sum + p.tokenCount, 0),
    elapsedMs: Date.now() - started,
    skipped,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
