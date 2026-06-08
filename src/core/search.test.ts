import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { searchPage } from "./search.js";

async function withServer(
  html: string,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const PAGE_HTML = `<!doctype html><html><body>
  <article>
    <h1>Widgets and Gadgets</h1>
    <p>Our widgets are the finest widgets in the widget industry.</p>
    <p>Gadgets, on the other hand, are a different product line entirely.</p>
    <p>Contact us at sales@example.com for pricing on widgets.</p>
  </article>
</body></html>`;

test("searchPage: plain-text search is case-insensitive by default and counts all matches", async () => {
  await withServer(PAGE_HTML, async (base) => {
    const result = await searchPage(`${base}/`, "widget");
    assert.ok(result.totalMatches >= 4, `expected at least 4 matches, got ${result.totalMatches}`);
    assert.ok(result.matches.length > 0);
    assert.match(result.matches[0].snippet, /widget/i);
  });
});

test("searchPage: case-sensitive search narrows results", async () => {
  await withServer(PAGE_HTML, async (base) => {
    const insensitive = await searchPage(`${base}/`, "Widgets", { ignoreCase: true });
    const sensitive = await searchPage(`${base}/`, "widgets", { ignoreCase: false });
    assert.ok(sensitive.totalMatches < insensitive.totalMatches);
  });
});

test("searchPage: regex mode matches patterns", async () => {
  await withServer(PAGE_HTML, async (base) => {
    const result = await searchPage(`${base}/`, "\\b\\w+@\\w+\\.\\w+\\b", { regex: true });
    assert.equal(result.totalMatches, 1);
    assert.match(result.matches[0].snippet, /sales@example\.com/);
  });
});

test("searchPage: literal query escapes regex special characters when regex is false", async () => {
  await withServer(PAGE_HTML, async (base) => {
    // A literal query containing regex metacharacters should not throw or be
    // interpreted as a pattern.
    const result = await searchPage(`${base}/`, "sales@example.com", { regex: false });
    assert.equal(result.totalMatches, 1);
  });
});

test("searchPage: maxMatches caps the returned matches but totalMatches reflects the true count", async () => {
  await withServer(PAGE_HTML, async (base) => {
    const result = await searchPage(`${base}/`, "widget", { maxMatches: 1 });
    assert.equal(result.matches.length, 1);
    assert.ok(result.totalMatches > 1);
  });
});

test("searchPage: no matches returns an empty result without error", async () => {
  await withServer(PAGE_HTML, async (base) => {
    const result = await searchPage(`${base}/`, "nonexistent-term-xyz");
    assert.equal(result.totalMatches, 0);
    assert.deepEqual(result.matches, []);
  });
});
