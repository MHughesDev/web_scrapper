/**
 * Structured metadata extraction.
 *
 * Pulls the signals agents most often want before deciding whether to ingest a
 * page in full: title, description, language, authorship, Open Graph / Twitter
 * cards, and any JSON-LD structured data.
 */
import * as cheerio from "cheerio";
import { URL } from "node:url";
import type { PageLink, PageMetadata } from "./types.js";

/** Registrable-ish domain comparison (handles www. and subdomains loosely). */
export function sameRegistrableDomain(a: string, b: string): boolean {
  try {
    const ha = new URL(a).hostname.replace(/^www\./, "");
    const hb = new URL(b).hostname.replace(/^www\./, "");
    if (ha === hb) return true;
    const pa = ha.split(".").slice(-2).join(".");
    const pb = hb.split(".").slice(-2).join(".");
    return pa === pb;
  } catch {
    return false;
  }
}

export function extractMetadata(
  $: cheerio.CheerioAPI,
  baseUrl: string,
): PageMetadata {
  const openGraph: Record<string, string> = {};
  const twitter: Record<string, string> = {};
  const jsonLd: unknown[] = [];

  $("meta").each((_, el) => {
    const property = $(el).attr("property") || $(el).attr("name");
    const content = $(el).attr("content");
    if (!property || content == null) return;
    if (property.startsWith("og:")) openGraph[property.slice(3)] = content;
    else if (property.startsWith("twitter:")) twitter[property.slice(8)] = content;
  });

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    try {
      jsonLd.push(JSON.parse(raw));
    } catch {
      // Ignore malformed JSON-LD rather than failing the whole fetch.
    }
  });

  const metaName = (name: string) =>
    $(`meta[name="${name}"]`).attr("content") ||
    $(`meta[property="${name}"]`).attr("content");

  const resolve = (href?: string): string | undefined => {
    if (!href) return undefined;
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return undefined;
    }
  };

  const favicon =
    resolve($('link[rel="icon"]').attr("href")) ||
    resolve($('link[rel="shortcut icon"]').attr("href")) ||
    resolve($('link[rel="apple-touch-icon"]').attr("href"));

  return {
    title:
      $("title").first().text().trim() ||
      openGraph["title"] ||
      undefined,
    description:
      metaName("description") || openGraph["description"] || twitter["description"],
    language: $("html").attr("lang") || undefined,
    author: metaName("author") || metaName("article:author"),
    publishedTime: metaName("article:published_time") || openGraph["updated_time"],
    modifiedTime: metaName("article:modified_time"),
    siteName: openGraph["site_name"],
    canonical: resolve($('link[rel="canonical"]').attr("href")),
    openGraph,
    twitter,
    jsonLd,
    favicon,
  };
}

/** Collect, de-duplicate and absolutise all hyperlinks on a page. */
export function extractLinks(
  $: cheerio.CheerioAPI,
  baseUrl: string,
): PageLink[] {
  const seen = new Set<string>();
  const links: PageLink[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) return;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    // Drop the fragment for de-duplication purposes.
    const normalized = abs.split("#")[0];
    if (seen.has(normalized)) return;
    seen.add(normalized);
    links.push({
      url: normalized,
      text: $(el).text().replace(/\s+/g, " ").trim(),
      internal: sameRegistrableDomain(normalized, baseUrl),
    });
  });

  return links;
}
