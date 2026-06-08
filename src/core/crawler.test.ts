import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { crawlSite } from "./crawler.js";

/** A tiny three-page site: / links to /a and /b; /a links back to / and to an external host. */
function makeSite(): http.Server {
  const page = (title: string, links: string) =>
    `<!doctype html><html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>Body of ${title}.</p>${links}</article></body></html>`;

  return http.createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    if (req.url === "/a") {
      res.end(page("Page A", `<a href="/">Home</a> <a href="https://external.example/x">External</a>`));
    } else if (req.url === "/b") {
      res.end(page("Page B", `<a href="/a">To A</a>`));
    } else if (req.url === "/excluded") {
      res.end(page("Excluded", ""));
    } else {
      res.end(page("Home", `<a href="/a">A</a> <a href="/b">B</a> <a href="/excluded">Excluded</a>`));
    }
  });
}

async function withSite(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = makeSite();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("crawlSite: respects maxDepth and tracks depth per page", async () => {
  await withSite(async (base) => {
    const result = await crawlSite(`${base}/`, {
      maxDepth: 1,
      maxPages: 50,
      respectRobots: false,
    });
    const byUrl = new Map(result.pages.map((p) => [new URL(p.url).pathname, p.depth]));
    assert.equal(byUrl.get("/"), 0);
    // /a, /b, /excluded are depth 1 (linked from home); none at depth 2 should appear.
    assert.equal(byUrl.get("/a"), 1);
    assert.equal(byUrl.get("/b"), 1);
    assert.equal([...byUrl.values()].every((d) => d <= 1), true);
  });
});

test("crawlSite: respects maxPages as a hard cap", async () => {
  await withSite(async (base) => {
    const result = await crawlSite(`${base}/`, {
      maxDepth: 5,
      maxPages: 2,
      respectRobots: false,
    });
    assert.equal(result.pagesCrawled, 2);
    assert.ok(result.pages.length <= 2);
  });
});

test("crawlSite: sameDomain (default) excludes off-domain links", async () => {
  await withSite(async (base) => {
    const result = await crawlSite(`${base}/`, {
      maxDepth: 5,
      maxPages: 50,
      respectRobots: false,
    });
    assert.equal(result.pages.some((p) => p.url.includes("external.example")), false);
  });
});

test("crawlSite: excludePatterns skips matching paths", async () => {
  await withSite(async (base) => {
    const result = await crawlSite(`${base}/`, {
      maxDepth: 5,
      maxPages: 50,
      respectRobots: false,
      excludePatterns: ["^/excluded"],
    });
    assert.equal(result.pages.some((p) => p.url.includes("/excluded")), false);
    assert.ok(result.skipped.some((s) => s.url.includes("/excluded") && s.reason === "exclude-match"));
  });
});

test("crawlSite: includePatterns restricts the crawl to matching paths", async () => {
  await withSite(async (base) => {
    const result = await crawlSite(`${base}/`, {
      maxDepth: 5,
      maxPages: 50,
      respectRobots: false,
      includePatterns: ["^/a$"],
    });
    // The seed is always crawled; only /a should additionally appear.
    const paths = result.pages.map((p) => new URL(p.url).pathname);
    assert.ok(paths.includes("/"));
    assert.ok(paths.includes("/a"));
    assert.equal(paths.includes("/b"), false);
    assert.equal(paths.includes("/excluded"), false);
  });
});

test("crawlSite: aggregates token totals across pages", async () => {
  await withSite(async (base) => {
    const result = await crawlSite(`${base}/`, { maxDepth: 1, maxPages: 50, respectRobots: false });
    const sum = result.pages.reduce((acc, p) => acc + p.tokenCount, 0);
    assert.equal(result.totalTokens, sum);
    assert.ok(result.totalTokens > 0);
  });
});
