/**
 * The single-page scraping pipeline.
 *
 * fetch -> parse -> extract main content -> convert format -> metadata + links
 * -> token accounting. This is the unit of work behind both the REST `/fetch`
 * endpoint and the MCP `fetch_page` tool.
 */
import * as cheerio from "cheerio";
import { fetchRaw } from "./fetcher.js";
import { extractContent } from "./extractor.js";
import { extractLinks, extractMetadata } from "./metadata.js";
import { chunkByTokens, countTokens, truncateToTokens } from "./tokens.js";
import type { FetchOptions, PageResult } from "./types.js";

function isHtml(contentType?: string): boolean {
  if (!contentType) return true; // assume HTML when unknown
  return /html|xml/i.test(contentType);
}

export async function scrapePage(
  url: string,
  options: FetchOptions = {},
): Promise<PageResult> {
  const {
    format = "markdown",
    render = "http",
    extractMain = format !== "html",
    includeLinks = true,
    chunkTokens = 0,
    maxTokens = 0,
    timeoutMs = 30_000,
    userAgent,
    headers,
    waitForSelector,
  } = options;

  const started = Date.now();

  let raw;
  try {
    raw = await fetchRaw(url, render, { timeoutMs, userAgent, headers, waitForSelector });
  } catch (err) {
    return errorResult(url, format, render, started, (err as Error).message);
  }

  const ok = raw.status >= 200 && raw.status < 300;

  // Non-HTML payloads (JSON/CSV/plain text) are passed through verbatim.
  if (!isHtml(raw.contentType)) {
    const content = maxTokens > 0 ? truncateToTokens(raw.body, maxTokens) : raw.body;
    return {
      url,
      finalUrl: raw.finalUrl,
      status: raw.status,
      ok,
      contentType: raw.contentType,
      renderMode: raw.renderMode,
      metadata: emptyMetadata(),
      content,
      format: "text",
      tokenCount: countTokens(content),
      links: [],
      wordCount: content.split(/\s+/).filter(Boolean).length,
      elapsedMs: Date.now() - started,
      ...(chunkTokens > 0 ? { chunks: chunkByTokens(content, chunkTokens) } : {}),
    };
  }

  const $ = cheerio.load(raw.body);
  const metadata = extractMetadata($, raw.finalUrl);
  const links = includeLinks ? extractLinks($, raw.finalUrl) : [];

  const extracted = extractContent(raw.body, raw.finalUrl, format, extractMain);
  if (!metadata.title && extracted.articleTitle) metadata.title = extracted.articleTitle;

  let content = extracted.content;
  if (maxTokens > 0) content = truncateToTokens(content, maxTokens);

  const result: PageResult = {
    url,
    finalUrl: raw.finalUrl,
    status: raw.status,
    ok,
    contentType: raw.contentType,
    renderMode: raw.renderMode,
    metadata,
    content,
    format: extracted.format,
    tokenCount: countTokens(content),
    links,
    wordCount: extracted.wordCount,
    elapsedMs: Date.now() - started,
  };

  if (chunkTokens > 0) result.chunks = chunkByTokens(content, chunkTokens);
  return result;
}

function emptyMetadata() {
  return { openGraph: {}, twitter: {}, jsonLd: [] };
}

function errorResult(
  url: string,
  format: FetchOptions["format"] = "markdown",
  render: FetchOptions["render"] = "http",
  started: number,
  error: string,
): PageResult {
  return {
    url,
    finalUrl: url,
    status: 0,
    ok: false,
    renderMode: render ?? "http",
    metadata: emptyMetadata(),
    content: "",
    format: format ?? "markdown",
    tokenCount: 0,
    links: [],
    wordCount: 0,
    elapsedMs: Date.now() - started,
    error,
  };
}
