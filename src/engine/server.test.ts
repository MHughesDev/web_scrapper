import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { buildServer } from "./server.js";

/** Spin up a tiny HTML fixture site for the engine to scrape. */
async function withFixtureSite(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = http.createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(
      `<!doctype html><html><head><title>Fixture</title><meta name="description" content="A fixture page"></head>` +
        `<body><article><h1>Fixture</h1><p>Hello from the fixture page used in engine tests.</p>` +
        `<a href="/other">Other</a></article></body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withApp(fn: (app: ReturnType<typeof buildServer>) => Promise<void>): Promise<void> {
  const app = buildServer();
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

test("GET /health reports status and capabilities", async () => {
  await withApp(async (app) => {
    const res = await app.inject({ method: "GET", url: "/health" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, "ok");
    assert.ok(Array.isArray(body.capabilities.formats));
    assert.ok(body.capabilities.formats.includes("markdown"));
  });
});

test("POST /fetch returns a structured page result for a valid URL", async () => {
  await withFixtureSite(async (base) => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/fetch",
        payload: { url: `${base}/`, format: "markdown" },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.status, 200);
      assert.equal(body.ok, true);
      assert.match(body.content, /Hello from the fixture page/);
      assert.equal(body.metadata.title, "Fixture");
      assert.ok(body.tokenCount > 0);
    });
  });
});

test("POST /fetch rejects an invalid request body with 400", async () => {
  await withApp(async (app) => {
    const res = await app.inject({
      method: "POST",
      url: "/fetch",
      payload: { url: "not-a-valid-url" },
    });
    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.error, "invalid_request");
    assert.ok(Array.isArray(body.details));
  });
});

test("POST /crawl returns an aggregate result bounded by maxPages", async () => {
  await withFixtureSite(async (base) => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/crawl",
        payload: { url: `${base}/`, maxDepth: 1, maxPages: 1, respectRobots: false },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.pagesCrawled, 1);
      assert.equal(body.pages.length, 1);
    });
  });
});

test("POST /search returns matches with snippets", async () => {
  await withFixtureSite(async (base) => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/search",
        payload: { url: `${base}/`, query: "fixture page" },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.ok(body.totalMatches >= 1);
      assert.match(body.matches[0].snippet, /fixture page/i);
    });
  });
});

test("POST /extract without selectors returns a link map and metadata", async () => {
  await withFixtureSite(async (base) => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/extract",
        payload: { url: `${base}/` },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.metadata.title, "Fixture");
      assert.ok(Array.isArray(body.links));
      assert.ok(body.links.some((l: { url: string }) => l.url.endsWith("/other")));
    });
  });
});

test("POST /extract with selectors returns structured data", async () => {
  await withFixtureSite(async (base) => {
    await withApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/extract",
        payload: { url: `${base}/`, selectors: { heading: "h1", links: "a@href" } },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.deepEqual(body.data.heading, ["Fixture"]);
      assert.ok(body.data.links[0].endsWith("/other"));
    });
  });
});
