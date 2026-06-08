import { test } from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import { sameRegistrableDomain, extractMetadata, extractLinks } from "./metadata.js";

test("sameRegistrableDomain: matches identical hosts", () => {
  assert.equal(sameRegistrableDomain("https://example.com/a", "https://example.com/b"), true);
});

test("sameRegistrableDomain: matches with/without www", () => {
  assert.equal(sameRegistrableDomain("https://www.example.com/a", "https://example.com/b"), true);
});

test("sameRegistrableDomain: matches subdomains against the apex", () => {
  assert.equal(sameRegistrableDomain("https://docs.example.com/a", "https://example.com/b"), true);
});

test("sameRegistrableDomain: rejects different domains", () => {
  assert.equal(sameRegistrableDomain("https://example.com", "https://other.com"), false);
});

test("sameRegistrableDomain: invalid URLs are not equal", () => {
  assert.equal(sameRegistrableDomain("not-a-url", "https://example.com"), false);
});

const SAMPLE_HTML = `<!doctype html><html lang="en"><head>
  <title>Sample Page</title>
  <meta name="description" content="A sample description">
  <meta property="og:site_name" content="SampleSite">
  <meta property="og:title" content="OG Title">
  <meta name="twitter:description" content="Twitter description">
  <meta name="author" content="Jane Doe">
  <link rel="canonical" href="/canonical-path">
  <link rel="icon" href="/favicon.ico">
  <script type="application/ld+json">{"@type":"Article","headline":"Sample"}</script>
  <script type="application/ld+json">not valid json</script>
</head><body>
  <a href="/internal">Internal link</a>
  <a href="https://other.com/external">External link</a>
  <a href="mailto:test@example.com">Email</a>
  <a href="#section">Anchor</a>
  <a href="/internal#frag">Internal with fragment (dup)</a>
</body></html>`;

test("extractMetadata: pulls title, description, OG, twitter, JSON-LD, canonical, favicon", () => {
  const $ = cheerio.load(SAMPLE_HTML);
  const meta = extractMetadata($, "https://example.com/page");

  assert.equal(meta.title, "Sample Page");
  assert.equal(meta.description, "A sample description");
  assert.equal(meta.language, "en");
  assert.equal(meta.author, "Jane Doe");
  assert.equal(meta.openGraph.site_name, "SampleSite");
  assert.equal(meta.openGraph.title, "OG Title");
  assert.equal(meta.twitter.description, "Twitter description");
  assert.equal(meta.canonical, "https://example.com/canonical-path");
  assert.equal(meta.favicon, "https://example.com/favicon.ico");

  // Valid JSON-LD is parsed; malformed JSON-LD is skipped without throwing.
  assert.equal(meta.jsonLd.length, 1);
  assert.deepEqual(meta.jsonLd[0], { "@type": "Article", headline: "Sample" });
});

test("extractLinks: resolves, classifies, dedupes and filters non-navigable links", () => {
  const $ = cheerio.load(SAMPLE_HTML);
  const links = extractLinks($, "https://example.com/page");

  // mailto:, javascript:, and pure-fragment links are excluded.
  assert.equal(links.some((l) => l.url.startsWith("mailto:")), false);
  assert.equal(links.some((l) => l.url.includes("#section")), false);

  const internal = links.find((l) => l.url === "https://example.com/internal");
  assert.ok(internal, "expected the internal link to be present");
  assert.equal(internal!.internal, true);
  assert.equal(internal!.text, "Internal link");

  const external = links.find((l) => l.url === "https://other.com/external");
  assert.ok(external, "expected the external link to be present");
  assert.equal(external!.internal, false);

  // The fragment-only variant of /internal should be de-duplicated against it.
  assert.equal(links.filter((l) => l.url === "https://example.com/internal").length, 1);
});
