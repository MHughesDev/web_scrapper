/**
 * Content extraction and format conversion.
 *
 * Turns raw HTML into the clean, agent-friendly representations LLMs consume
 * best:
 *   - main-content extraction (Mozilla Readability) to strip nav/ads/footers,
 *   - HTML → Markdown (Turndown + GFM) preserving headings, lists, tables, code,
 *   - plain text, or raw HTML, on request.
 */
import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import type { OutputFormat } from "./types.js";

function makeTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "_",
  });
  td.use(gfm);
  // Drop elements that never carry useful content for an agent.
  td.remove(["script", "style", "noscript", "iframe"]);
  return td;
}

const turndown = makeTurndown();

export interface ExtractedContent {
  content: string;
  format: OutputFormat;
  /** Title recovered by the readability pass, if any. */
  articleTitle?: string;
  wordCount: number;
}

/**
 * Produce the requested representation of a page.
 *
 * @param html        Raw HTML.
 * @param baseUrl     Used to resolve relative URLs in links/images.
 * @param format      Desired output format.
 * @param extractMain When true (default for markdown/text), isolate the main
 *                    article content before converting.
 */
export function extractContent(
  html: string,
  baseUrl: string,
  format: OutputFormat,
  extractMain: boolean,
): ExtractedContent {
  if (format === "html") {
    return { content: html, format, wordCount: countWords(stripTags(html)) };
  }

  let workingHtml = html;
  let articleTitle: string | undefined;

  if (extractMain) {
    try {
      const dom = new JSDOM(html, { url: baseUrl });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      if (article?.content && article.content.length > 0) {
        workingHtml = article.content;
        articleTitle = article.title ?? undefined;
      }
    } catch {
      // Readability can throw on malformed documents; fall back to full HTML.
    }
  }

  if (format === "text") {
    const $ = cheerio.load(workingHtml);
    $("script, style, noscript").remove();
    // Insert line breaks around block-level elements so adjacent blocks don't
    // run together (e.g. "Great.OneTwo") in the flattened text.
    $("p, br, hr, li, tr, h1, h2, h3, h4, h5, h6, section, article, div, blockquote, pre").each(
      (_, el) => {
        $(el).append("\n");
      },
    );
    const text = $.root()
      .text()
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { content: text, format, articleTitle, wordCount: countWords(text) };
  }

  // Markdown (and the body used for json content).
  const markdown = turndown.turndown(workingHtml).replace(/\n{3,}/g, "\n\n").trim();
  return {
    content: markdown,
    format: format === "json" ? "markdown" : format,
    articleTitle,
    wordCount: countWords(markdown),
  };
}

function stripTags(html: string): string {
  return cheerio.load(html).root().text();
}

function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/**
 * Extract data for a set of CSS selectors. Each selector maps to an array of
 * matched text/attribute values, giving agents a precise scraping primitive
 * without ingesting the whole page.
 */
export function extractBySelectors(
  html: string,
  selectors: Record<string, string>,
  baseUrl: string,
): Record<string, string[]> {
  const $ = cheerio.load(html);
  const out: Record<string, string[]> = {};
  for (const [key, selector] of Object.entries(selectors)) {
    // Support a "selector@attr" syntax to pull an attribute instead of text.
    const [sel, attr] = selector.split("@");
    const values: string[] = [];
    $(sel.trim()).each((_, el) => {
      if (attr) {
        let v = $(el).attr(attr.trim()) ?? "";
        if (v && /^(href|src)$/i.test(attr.trim())) {
          try {
            v = new URL(v, baseUrl).toString();
          } catch {
            /* leave as-is */
          }
        }
        if (v) values.push(v);
      } else {
        const t = $(el).text().replace(/\s+/g, " ").trim();
        if (t) values.push(t);
      }
    });
    out[key] = values;
  }
  return out;
}

/** Extract all tables on a page as arrays of row objects (or row arrays). */
export function extractTables(html: string): string[][][] {
  const $ = cheerio.load(html);
  const tables: string[][][] = [];
  $("table").each((_, table) => {
    const rows: string[][] = [];
    $(table)
      .find("tr")
      .each((_, tr) => {
        const cells: string[] = [];
        $(tr)
          .find("th, td")
          .each((_, cell) => {
            cells.push($(cell).text().replace(/\s+/g, " ").trim());
          });
        if (cells.length) rows.push(cells);
      });
    if (rows.length) tables.push(rows);
  });
  return tables;
}
