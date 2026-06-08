# agent-scraper

A web scraping engine built for **AI agents**. It ships as two cooperating
pieces:

- **A REST scraping engine** (Fastify) that does the work — fetch, extract,
  convert, crawl, search.
- **An MCP server** (Model Context Protocol) — the agent-facing interface. Any
  MCP-capable agent (Claude, etc.) connects over stdio and calls scraping as
  native tools. The MCP server talks to the REST engine over HTTP.

It turns messy HTML into the clean, structured, token-budgeted content LLMs
actually consume well:

- **Clean Markdown** (or text / HTML / JSON) via Mozilla Readability + Turndown,
  with nav/ads/boilerplate stripped.
- **Structured metadata**: title, description, language, author, Open Graph,
  Twitter cards, JSON-LD, canonical URL, favicon.
- **Token awareness**: every result carries an estimated token count, and long
  pages can be truncated (`maxTokens`) or split into chunks (`chunkTokens`).
- **Concurrent crawling**: breadth-first, depth/page-bounded, same-domain by
  default, robots.txt-aware, with include/exclude path filters and a politeness
  delay.
- **Precise extraction**: CSS selectors (`selector@attr`), table extraction, and
  in-page text/regex search with context.
- **Optional JS rendering**: fast HTTP by default; opt into headless-browser
  rendering with `render: "browser"` (Playwright, an optional dependency).

> Note: This project was rewritten from an earlier Python prototype into a
> TypeScript/Node engine to support a REST engine, an MCP interface, and
> Playwright rendering.

## Requirements

- Node.js >= 20

## Install & build

```bash
npm install
npm run build
```

Optional — enable browser rendering:

```bash
npm install playwright
npx playwright install chromium
```

## Test

The suite covers the core pipeline (fetch → extract → metadata → tokens),
the crawler (depth/page bounds, domain & path filtering), search, and the
REST engine's HTTP surface (using Fastify's `inject`, against local fixture
servers — no network access required).

```bash
npm run build
npm test
```

CI (`.github/workflows/ci.yml`) runs `typecheck`, `build` and `test` on
Node 20 and 22 for every push and pull request.

## Run the MCP server (for agents)

The MCP server is the primary, agent-facing interface. It speaks MCP over
stdio. If `ENGINE_URL` is not set, it **starts the REST engine in-process**, so
a single command is fully self-contained:

```bash
npm run mcp          # build first, or: npm run mcp:dev
```

Point it at a separately running engine instead:

```bash
ENGINE_URL=http://localhost:8080 npm run mcp
```

### Register it with an MCP client

Claude Code:

```bash
claude mcp add agent-scraper -- node /absolute/path/to/dist/mcp/server.js
```

Or in a client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "agent-scraper": {
      "command": "node",
      "args": ["/absolute/path/to/dist/mcp/server.js"]
    }
  }
}
```

### Tools exposed to the agent

| Tool | What it does |
| --- | --- |
| `fetch_page` | Fetch one page as clean Markdown (+ metadata, links, token count). |
| `crawl_site` | Breadth-first crawl of a site section, bounded by depth/pages. |
| `extract_data` | CSS-selector / table extraction, or a link+metadata map. |
| `search_page` | Find text/regex on a page and return matching snippets with context. |

## Run the REST engine standalone

```bash
npm run engine          # listens on PORT (default 8080)
# or for development:
npm run engine:dev
```

### Endpoints

| Method & path | Body | Returns |
| --- | --- | --- |
| `GET /health` | — | Status + capabilities (incl. whether browser rendering is available). |
| `POST /fetch` | `{ url, format?, render?, extractMain?, includeLinks?, chunkTokens?, maxTokens?, ... }` | A single `PageResult`. |
| `POST /crawl` | `{ url, maxDepth?, maxPages?, sameDomain?, concurrency?, includePatterns?, excludePatterns?, respectRobots?, delayMs?, ... }` | A `CrawlResult`. |
| `POST /extract` | `{ url, selectors?, tables?, render? }` | Structured data / tables / link map + metadata. |
| `POST /search` | `{ url, query, regex?, ignoreCase?, contextChars?, maxMatches? }` | Matching snippets with context. |

### Examples

Fetch a page as Markdown, chunked to ~800 tokens:

```bash
curl -s localhost:8080/fetch -H 'content-type: application/json' \
  -d '{"url":"https://example.com","format":"markdown","chunkTokens":800}'
```

Crawl just the docs section of a site:

```bash
curl -s localhost:8080/crawl -H 'content-type: application/json' \
  -d '{"url":"https://example.com/docs","maxDepth":3,"maxPages":50,"includePatterns":["^/docs"]}'
```

Extract structured data via CSS selectors (`@attr` pulls an attribute):

```bash
curl -s localhost:8080/extract -H 'content-type: application/json' \
  -d '{"url":"https://news.example.com","selectors":{"headlines":"h2.title","links":"h2.title a@href"}}'
```

Search a page:

```bash
curl -s localhost:8080/search -H 'content-type: application/json' \
  -d '{"url":"https://example.com/pricing","query":"enterprise","contextChars":120}'
```

## Deploy with Docker

The included `Dockerfile` builds a small, production-only image that runs the
REST engine (the MCP server can run anywhere and point `ENGINE_URL` at it).

```bash
docker build -t agent-scraper .
docker run -p 8080:8080 agent-scraper
curl localhost:8080/health
```

A variant with Playwright/Chromium baked in (for `render: "browser"`) is
available as the `engine-browser` build target — it's based on the official
Playwright image and is significantly larger:

```bash
docker build --target engine-browser -t agent-scraper:browser .
```

`docker-compose.yml` wires up an `engine` service plus an `mcp` service that
talks to it over `ENGINE_URL` (most agents instead launch the MCP server
directly via stdio — see [Run the MCP server](#run-the-mcp-server-for-agents)):

```bash
docker compose up --build
```

## Use as a library

The core is also importable directly:

```ts
import { scrapePage, crawlSite, searchPage } from "agent-scraper/dist/core/index.js";

const page = await scrapePage("https://example.com", { format: "markdown", chunkTokens: 800 });
console.log(page.content, page.tokenCount);
```

## Architecture

```
            ┌──────────────┐   stdio (MCP)   ┌─────────────────────┐
  AI agent ─┤  MCP server  ├────────────────►│  (you / your agent) │
            └──────┬───────┘                 └─────────────────────┘
                   │ HTTP
                   ▼
            ┌──────────────┐
            │ REST engine  │  Fastify  (/fetch /crawl /extract /search)
            └──────┬───────┘
                   ▼
            ┌──────────────┐
            │     core     │  fetcher · extractor · metadata · crawler ·
            └──────────────┘  search · tokens · robots
```

- `src/core` — the scraping engine: fetching (HTTP via global fetch, optional
  Playwright), Readability extraction, Markdown conversion, metadata, crawler,
  search, token accounting, robots.txt.
- `src/engine` — the Fastify REST API wrapping the core, with Zod-validated
  requests.
- `src/mcp` — the MCP server exposing the four tools, calling the REST engine
  (embedded by default).

## Configuration

| Variable | Default | Used by |
| --- | --- | --- |
| `PORT` | `8080` | REST engine |
| `HOST` | `0.0.0.0` | REST engine |
| `LOG_LEVEL` | `info` | REST engine |
| `ENGINE_URL` | _(embedded)_ | MCP server — point at an external engine |

## License

MIT
