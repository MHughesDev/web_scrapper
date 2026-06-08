/**
 * robots.txt awareness for polite crawling.
 *
 * Fetches and caches robots.txt per host so the crawler can avoid disallowed
 * paths. Failures are treated as "allowed" (fail-open) to match common crawler
 * behaviour, but network errors are never fatal to a crawl.
 */
import robotsParserImport from "robots-parser";
import { fetchHttp, DEFAULT_USER_AGENT } from "./fetcher.js";
import { URL } from "node:url";

// robots-parser is a CJS module whose callable default isn't reflected in its
// types; normalise it to a callable factory.
const robotsParser = robotsParserImport as unknown as (
  url: string,
  contents: string,
) => { isAllowed(url: string, ua?: string): boolean | undefined };

type RobotsRecord = ReturnType<typeof robotsParser>;

const cache = new Map<string, RobotsRecord | null>();

async function getRobots(origin: string): Promise<RobotsRecord | null> {
  if (cache.has(origin)) return cache.get(origin)!;
  const robotsUrl = `${origin}/robots.txt`;
  try {
    const res = await fetchHttp(robotsUrl, { timeoutMs: 10_000 });
    if (res.status >= 200 && res.status < 300 && res.body) {
      const parsed = robotsParser(robotsUrl, res.body);
      cache.set(origin, parsed);
      return parsed;
    }
  } catch {
    /* fall through to fail-open */
  }
  cache.set(origin, null);
  return null;
}

/** Whether `url` may be fetched per the host's robots.txt. Fails open. */
export async function isAllowed(
  url: string,
  userAgent: string = DEFAULT_USER_AGENT,
): Promise<boolean> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  const robots = await getRobots(origin);
  if (!robots) return true;
  const allowed = robots.isAllowed(url, userAgent);
  return allowed !== false; // undefined => allowed
}

/** Clear the robots cache (useful for tests / long-running processes). */
export function clearRobotsCache(): void {
  cache.clear();
}
