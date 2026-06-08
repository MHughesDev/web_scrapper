/**
 * The REST scraping engine.
 *
 * A small Fastify service that exposes the core scraping pipeline over HTTP.
 * This is the "engine" the MCP server (and any other client) talks to.
 *
 * Endpoints:
 *   GET  /health           -> liveness + capability probe
 *   POST /fetch            -> scrape one page (markdown / text / html / json)
 *   POST /crawl            -> breadth-first crawl of a site section
 *   POST /extract          -> CSS-selector / table extraction
 *   POST /search           -> in-page text/regex search with context
 *
 * Configuration via env:
 *   PORT (default 8080), HOST (default 0.0.0.0)
 */
import Fastify from "fastify";
import { ZodError, type ZodSchema } from "zod";
import { scrapePage } from "../core/scrape.js";
import { crawlSite } from "../core/crawler.js";
import { searchPage } from "../core/search.js";
import { extractBySelectors, extractTables } from "../core/extractor.js";
import { extractLinks, extractMetadata } from "../core/metadata.js";
import { fetchRaw } from "../core/fetcher.js";
import * as cheerio from "cheerio";
import {
  crawlSchema,
  extractSchema,
  fetchSchema,
  searchSchema,
} from "./schemas.js";

export function buildServer() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    bodyLimit: 5 * 1024 * 1024,
  });

  /** Parse a body against a schema, throwing a 400-friendly error. */
  function parse<T>(schema: ZodSchema<T>, body: unknown): T {
    return schema.parse(body);
  }

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({
        error: "invalid_request",
        details: err.errors.map((e) => ({ path: e.path.join("."), message: e.message })),
      });
      return;
    }
    app.log.error(err);
    reply.status(500).send({ error: "internal_error", message: (err as Error).message });
  });

  app.get("/health", async () => {
    let browserAvailable = false;
    try {
      await import("playwright");
      browserAvailable = true;
    } catch {
      browserAvailable = false;
    }
    return {
      status: "ok",
      service: "agent-scraper-engine",
      version: "1.0.0",
      capabilities: {
        formats: ["markdown", "text", "html", "json"],
        render: browserAvailable ? ["http", "browser"] : ["http"],
        browserAvailable,
      },
    };
  });

  app.post("/fetch", async (req) => {
    const body = parse(fetchSchema, req.body);
    const { url, ...opts } = body;
    return scrapePage(url, opts);
  });

  app.post("/crawl", async (req) => {
    const body = parse(crawlSchema, req.body);
    const { url, ...opts } = body;
    return crawlSite(url, opts);
  });

  app.post("/search", async (req) => {
    const body = parse(searchSchema, req.body);
    const { url, query, ...opts } = body;
    return searchPage(url, query, opts);
  });

  app.post("/extract", async (req) => {
    const body = parse(extractSchema, req.body);
    const { url, selectors, tables, render = "http", timeoutMs } = body;
    const raw = await fetchRaw(url, render, { timeoutMs });
    const $ = cheerio.load(raw.body);
    const result: Record<string, unknown> = {
      url,
      finalUrl: raw.finalUrl,
      status: raw.status,
      metadata: extractMetadata($, raw.finalUrl),
    };
    if (selectors && Object.keys(selectors).length) {
      result.data = extractBySelectors(raw.body, selectors, raw.finalUrl);
    }
    if (tables) {
      result.tables = extractTables(raw.body);
    }
    if (!selectors && !tables) {
      // Default: links + metadata, a useful "map this page" primitive.
      result.links = extractLinks($, raw.finalUrl);
    }
    return result;
  });

  return app;
}

async function main() {
  const app = buildServer();
  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? "0.0.0.0";
  try {
    await app.listen({ port, host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Run when invoked directly (not when imported, e.g. by tests).
import { fileURLToPath } from "node:url";
import { argv } from "node:process";
if (process.argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  main();
}
