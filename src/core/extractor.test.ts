import { test } from "node:test";
import assert from "node:assert/strict";
import { extractContent, extractBySelectors, extractTables } from "./extractor.js";

const ARTICLE_HTML = `<!doctype html><html><head><title>Article Title</title></head><body>
  <nav><a href="/a">Nav A</a><a href="/b">Nav B</a></nav>
  <article>
    <h1>Article Title</h1>
    <p>This is the <strong>main</strong> body of the article with enough text that
    Readability should confidently identify it as the primary content block on the page,
    rather than the surrounding navigation or footer chrome.</p>
    <p>A second paragraph adds more substance so the extraction has real content to find
    and convert into clean markdown for downstream consumption by an agent.</p>
    <ul><li>One</li><li>Two</li></ul>
    <pre><code>const x = 1;</code></pre>
  </article>
  <footer>Copyright 2024 - unrelated footer noise that should not appear in the extracted content</footer>
</body></html>`;

test("extractContent: html format returns the raw HTML untouched", () => {
  const result = extractContent(ARTICLE_HTML, "https://example.com", "html", false);
  assert.equal(result.format, "html");
  assert.equal(result.content, ARTICLE_HTML);
  assert.ok(result.wordCount > 0);
});

test("extractContent: markdown format converts and strips boilerplate when extractMain is true", () => {
  const result = extractContent(ARTICLE_HTML, "https://example.com", "markdown", true);
  assert.equal(result.format, "markdown");
  assert.match(result.content, /main.*body of the article/i);
  assert.match(result.content, /```/); // fenced code block
  assert.doesNotMatch(result.content, /footer noise/i);
  assert.ok(result.wordCount > 0);
});

test("extractContent: text format flattens to plain text with block separation", () => {
  const result = extractContent(ARTICLE_HTML, "https://example.com", "text", true);
  assert.equal(result.format, "text");
  assert.doesNotMatch(result.content, /<[a-z][\s\S]*>/i); // no HTML tags remain
  assert.match(result.content, /main body of the article/i);
});

test("extractContent: markdown without extractMain keeps the full document", () => {
  const result = extractContent(ARTICLE_HTML, "https://example.com", "markdown", false);
  // Without main-content extraction, nav links should still be present.
  assert.match(result.content, /Nav A/);
});

const TABLE_HTML = `<table>
  <tr><th>Name</th><th>Type</th></tr>
  <tr><td>foo</td><td>string</td></tr>
  <tr><td>bar</td><td>number</td></tr>
</table>
<table><tr><td>solo</td></tr></table>`;

test("extractTables: extracts each table as an array of row arrays", () => {
  const tables = extractTables(TABLE_HTML);
  assert.equal(tables.length, 2);
  assert.deepEqual(tables[0], [
    ["Name", "Type"],
    ["foo", "string"],
    ["bar", "number"],
  ]);
  assert.deepEqual(tables[1], [["solo"]]);
});

const SELECTOR_HTML = `<div>
  <h2 class="title">First</h2>
  <h2 class="title">Second</h2>
  <a class="link" href="/relative/path">Link text</a>
  <a class="link" href="https://other.com/x">External</a>
</div>`;

test("extractBySelectors: collects text content per selector", () => {
  const result = extractBySelectors(SELECTOR_HTML, { titles: "h2.title" }, "https://example.com/page");
  assert.deepEqual(result.titles, ["First", "Second"]);
});

test("extractBySelectors: '@attr' syntax pulls and resolves attribute values", () => {
  const result = extractBySelectors(SELECTOR_HTML, { hrefs: "a.link@href" }, "https://example.com/page");
  assert.deepEqual(result.hrefs, [
    "https://example.com/relative/path",
    "https://other.com/x",
  ]);
});

test("extractBySelectors: returns an empty array for selectors with no matches", () => {
  const result = extractBySelectors(SELECTOR_HTML, { missing: ".does-not-exist" }, "https://example.com");
  assert.deepEqual(result.missing, []);
});
