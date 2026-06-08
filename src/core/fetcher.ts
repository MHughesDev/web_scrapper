/**
 * Low-level page retrieval.
 *
 * Two backends:
 *   - `http`    : fast, dependency-light fetch via undici (the default).
 *   - `browser` : optional Playwright rendering for JS-heavy / SPA pages.
 *
 * Playwright is an optional dependency and is imported lazily, so the engine
 * runs perfectly well without it. Requesting browser mode when Playwright is
 * unavailable yields a clear, actionable error instead of a crash.
 */
import type { RenderMode } from "./types.js";

export const DEFAULT_USER_AGENT =
  "AgentScraper/1.0 (+https://github.com/mhughesdev/web_scrapper; AI-agent crawler)";

export interface RawPage {
  finalUrl: string;
  status: number;
  contentType?: string;
  body: string;
  renderMode: RenderMode;
}

export interface RawFetchOptions {
  timeoutMs?: number;
  userAgent?: string;
  headers?: Record<string, string>;
  waitForSelector?: string;
}

/**
 * Fetch a page over plain HTTP using Node's global fetch (undici-backed).
 * Follows redirects automatically and reports the final, post-redirect URL.
 */
export async function fetchHttp(
  url: string,
  opts: RawFetchOptions = {},
): Promise<RawPage> {
  const { timeoutMs = 30_000, userAgent = DEFAULT_USER_AGENT, headers = {} } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        ...headers,
      },
    });

    const body = await res.text();
    return {
      finalUrl: res.url || url,
      status: res.status,
      contentType: res.headers.get("content-type") ?? undefined,
      body,
      renderMode: "http",
    };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

let playwrightWarned = false;

/**
 * Render a page in a headless browser via Playwright (optional dependency).
 * Throws a descriptive error if Playwright or its browsers aren't installed.
 */
export async function fetchBrowser(
  url: string,
  opts: RawFetchOptions = {},
): Promise<RawPage> {
  const { timeoutMs = 30_000, userAgent = DEFAULT_USER_AGENT, waitForSelector } = opts;

  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error(
      "Browser rendering requested but Playwright is not installed. " +
        "Install it with `npm install playwright && npx playwright install chromium`, " +
        "or use render mode 'http'.",
    );
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    if (!playwrightWarned) playwrightWarned = true;
    throw new Error(
      "Failed to launch a Chromium browser. Run `npx playwright install chromium` " +
        `to download it. Original error: ${(err as Error).message}`,
    );
  }

  try {
    const context = await browser.newContext({ userAgent });
    const page = await context.newPage();
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: timeoutMs }).catch(() => {});
    }
    const body = await page.content();
    const finalUrl = page.url();
    const status = response?.status() ?? 200;
    const headerCt = response ? (await response.headerValue("content-type")) : null;
    return {
      finalUrl,
      status,
      contentType: headerCt ?? "text/html",
      body,
      renderMode: "browser",
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Retrieve a page with the requested render mode. */
export async function fetchRaw(
  url: string,
  mode: RenderMode,
  opts: RawFetchOptions = {},
): Promise<RawPage> {
  return mode === "browser" ? fetchBrowser(url, opts) : fetchHttp(url, opts);
}
