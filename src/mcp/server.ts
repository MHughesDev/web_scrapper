/**
 * The MCP server: the agent-facing interface to the scraping engine.
 *
 * Per the project's architecture, scraping work is done by the REST engine;
 * this server is a thin Model Context Protocol layer that calls that engine
 * over HTTP and presents the results as well-described tools an AI agent can
 * invoke directly.
 *
 * Engine connection:
 *   - ENGINE_URL set        -> talk to that already-running REST engine.
 *   - ENGINE_URL unset      -> start the REST engine in-process on a local
 *                              port and talk to it (turnkey single-command use).
 *
 * Transport: stdio (the standard way agents launch and speak to MCP servers).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildServer } from "../engine/server.js";

/** Resolve the engine base URL, starting an embedded engine if needed. */
async function resolveEngine(): Promise<string> {
  if (process.env.ENGINE_URL) return process.env.ENGINE_URL.replace(/\/$/, "");
  // Start the REST engine in-process on an ephemeral local port.
  const app = buildServer();
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  // address is like "http://127.0.0.1:54321"
  process.on("exit", () => app.close());
  return address.replace(/\/$/, "");
}

async function callEngine(base: string, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `Engine error (${res.status}): ${JSON.stringify(json)}`,
    );
  }
  return json;
}

/** Wrap a JSON value as MCP text content. */
function jsonContent(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorContent(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  };
}

async function main() {
  const engine = await resolveEngine();

  const server = new McpServer({
    name: "agent-scraper",
    version: "1.0.0",
  });

  server.registerTool(
    "fetch_page",
    {
      title: "Fetch a web page",
      description:
        "Fetch a single web page and return clean, LLM-ready content. Strips " +
        "navigation/ads/boilerplate and returns Markdown by default, plus page " +
        "metadata (title, description, Open Graph, JSON-LD), discovered links, " +
        "and an estimated token count. Use render='browser' for JavaScript-heavy " +
        "pages, format='text' for plain text, or chunkTokens to split long pages.",
      inputSchema: {
        url: z.string().url().describe("The URL to fetch."),
        format: z
          .enum(["markdown", "text", "html", "json"])
          .optional()
          .describe("Output format. Default: markdown."),
        render: z
          .enum(["http", "browser"])
          .optional()
          .describe("'http' (fast, default) or 'browser' (renders JS via Playwright)."),
        extractMain: z
          .boolean()
          .optional()
          .describe("Isolate the main article content (default true for markdown/text)."),
        includeLinks: z.boolean().optional().describe("Include discovered links. Default true."),
        chunkTokens: z
          .number()
          .int()
          .optional()
          .describe("If set, also split content into chunks of ~this many tokens."),
        maxTokens: z
          .number()
          .int()
          .optional()
          .describe("Truncate content to at most this many tokens."),
        waitForSelector: z
          .string()
          .optional()
          .describe("Browser mode: wait for this CSS selector before reading the page."),
      },
    },
    async (args) => {
      try {
        const result = await callEngine(engine, "/fetch", args);
        return jsonContent(result);
      } catch (err) {
        return errorContent((err as Error).message);
      }
    },
  );

  server.registerTool(
    "crawl_site",
    {
      title: "Crawl a website section",
      description:
        "Breadth-first crawl of a site starting from a seed URL, returning clean " +
        "content for every page. Bounded by maxDepth and maxPages, same-domain by " +
        "default, robots.txt-aware. Use includePatterns/excludePatterns (regex on " +
        "the path) to focus the crawl, e.g. include '^/docs' to crawl just docs. " +
        "Ideal for ingesting documentation sites or knowledge bases.",
      inputSchema: {
        url: z.string().url().describe("Seed URL to start crawling from."),
        maxDepth: z.number().int().optional().describe("Link-hops from the seed. Default 2."),
        maxPages: z.number().int().optional().describe("Hard cap on pages fetched. Default 25."),
        sameDomain: z
          .boolean()
          .optional()
          .describe("Only follow same-domain links. Default true."),
        concurrency: z.number().int().optional().describe("Parallel fetches. Default 5."),
        includePatterns: z
          .array(z.string())
          .optional()
          .describe("Only crawl URLs whose path/URL matches one of these regexes."),
        excludePatterns: z
          .array(z.string())
          .optional()
          .describe("Skip URLs whose path/URL matches one of these regexes."),
        format: z.enum(["markdown", "text", "html", "json"]).optional(),
        render: z.enum(["http", "browser"]).optional(),
        respectRobots: z.boolean().optional().describe("Honour robots.txt. Default true."),
        delayMs: z.number().int().optional().describe("Politeness delay between requests (ms)."),
        maxTokens: z.number().int().optional().describe("Truncate each page to this many tokens."),
      },
    },
    async (args) => {
      try {
        const result = await callEngine(engine, "/crawl", args);
        return jsonContent(result);
      } catch (err) {
        return errorContent((err as Error).message);
      }
    },
  );

  server.registerTool(
    "extract_data",
    {
      title: "Extract structured data from a page",
      description:
        "Precisely extract data from a page without ingesting the whole thing. " +
        "Provide CSS selectors (use 'selector@attr' to pull an attribute, e.g. " +
        "'a.title@href'), set tables=true to extract all HTML tables as rows, or " +
        "omit both to get a link map + metadata. Returns structured JSON.",
      inputSchema: {
        url: z.string().url().describe("The URL to extract from."),
        selectors: z
          .record(z.string())
          .optional()
          .describe("Map of name -> CSS selector (append '@attr' for attributes)."),
        tables: z.boolean().optional().describe("Extract all tables as arrays of rows."),
        render: z.enum(["http", "browser"]).optional(),
      },
    },
    async (args) => {
      try {
        const result = await callEngine(engine, "/extract", args);
        return jsonContent(result);
      } catch (err) {
        return errorContent((err as Error).message);
      }
    },
  );

  server.registerTool(
    "search_page",
    {
      title: "Search within a web page",
      description:
        "Find specific information on a page without reading all of it. Returns " +
        "matching snippets with surrounding context. The query can be plain text " +
        "or a regular expression (set regex=true). Great for checking whether a " +
        "page mentions something and pulling just the relevant passages.",
      inputSchema: {
        url: z.string().url().describe("The URL to search."),
        query: z.string().describe("Text or regex to search for."),
        regex: z.boolean().optional().describe("Treat query as a regular expression."),
        ignoreCase: z.boolean().optional().describe("Case-insensitive. Default true."),
        contextChars: z
          .number()
          .int()
          .optional()
          .describe("Context characters around each match. Default 160."),
        maxMatches: z.number().int().optional().describe("Max matches to return. Default 20."),
        render: z.enum(["http", "browser"]).optional(),
      },
    },
    async (args) => {
      try {
        const result = await callEngine(engine, "/search", args);
        return jsonContent(result);
      } catch (err) {
        return errorContent((err as Error).message);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so we don't corrupt the stdio JSON-RPC stream.
  console.error(`agent-scraper MCP server ready (engine: ${engine})`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
