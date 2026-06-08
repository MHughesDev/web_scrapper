import { test } from "node:test";
import assert from "node:assert/strict";
import { countTokens, chunkByTokens, truncateToTokens } from "./tokens.js";

test("countTokens: empty string is zero tokens", () => {
  assert.equal(countTokens(""), 0);
});

test("countTokens: longer text yields more tokens than shorter text", () => {
  const short = countTokens("hello world");
  const long = countTokens("hello world ".repeat(50));
  assert.ok(long > short);
});

test("truncateToTokens: no-op when under the limit", () => {
  const text = "A short sentence.";
  assert.equal(truncateToTokens(text, 1000), text);
});

test("truncateToTokens: shortens long text and marks truncation", () => {
  const text = "This is a sentence. ".repeat(500);
  const truncated = truncateToTokens(text, 20);
  assert.ok(truncated.length < text.length);
  assert.match(truncated, /truncated/);
});

test("truncateToTokens: maxTokens <= 0 returns original text", () => {
  const text = "Some content here.";
  assert.equal(truncateToTokens(text, 0), text);
});

test("chunkByTokens: chunkTokens <= 0 returns the whole text as one chunk", () => {
  const text = "Paragraph one.\n\nParagraph two.";
  assert.deepEqual(chunkByTokens(text, 0), [text]);
});

test("chunkByTokens: splits long text into multiple chunks near the target size", () => {
  const paragraphs = Array.from({ length: 20 }, (_, i) => `Paragraph number ${i} with some extra words to add length.`);
  const text = paragraphs.join("\n\n");
  const chunks = chunkByTokens(text, 30);
  assert.ok(chunks.length > 1, "expected more than one chunk");
  for (const chunk of chunks) {
    assert.ok(countTokens(chunk) <= 60, `chunk too large: ${countTokens(chunk)} tokens`);
  }
  // No content should be lost across chunk boundaries.
  assert.equal(chunks.join(" ").includes("Paragraph number 0"), true);
  assert.equal(chunks.join(" ").includes("Paragraph number 19"), true);
});

test("chunkByTokens: hard-splits a single oversized paragraph on sentence boundaries", () => {
  const sentences = Array.from({ length: 30 }, (_, i) => `This is sentence number ${i} in one giant paragraph.`);
  const text = sentences.join(" ");
  const chunks = chunkByTokens(text, 25);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.join(" ").includes("sentence number 0"));
  assert.ok(chunks.join(" ").includes("sentence number 29"));
});
