/**
 * Request validation schemas shared by the REST engine.
 *
 * Centralised so the REST routes and the MCP tool layer agree on exactly what
 * a valid request looks like.
 */
import { z } from "zod";

const formatEnum = z.enum(["markdown", "text", "html", "json"]);
const renderEnum = z.enum(["http", "browser"]);

export const fetchSchema = z.object({
  url: z.string().url(),
  format: formatEnum.optional(),
  render: renderEnum.optional(),
  extractMain: z.boolean().optional(),
  includeLinks: z.boolean().optional(),
  chunkTokens: z.number().int().min(0).max(100_000).optional(),
  maxTokens: z.number().int().min(0).max(1_000_000).optional(),
  timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
  userAgent: z.string().optional(),
  headers: z.record(z.string()).optional(),
  waitForSelector: z.string().optional(),
});

export const crawlSchema = fetchSchema.extend({
  maxDepth: z.number().int().min(0).max(10).optional(),
  maxPages: z.number().int().min(1).max(500).optional(),
  sameDomain: z.boolean().optional(),
  concurrency: z.number().int().min(1).max(20).optional(),
  includePatterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
  respectRobots: z.boolean().optional(),
  delayMs: z.number().int().min(0).max(10_000).optional(),
});

export const extractSchema = z.object({
  url: z.string().url(),
  selectors: z.record(z.string()).optional(),
  tables: z.boolean().optional(),
  render: renderEnum.optional(),
  timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
});

export const searchSchema = z.object({
  url: z.string().url(),
  query: z.string().min(1),
  regex: z.boolean().optional(),
  ignoreCase: z.boolean().optional(),
  contextChars: z.number().int().min(0).max(2_000).optional(),
  maxMatches: z.number().int().min(1).max(200).optional(),
  render: renderEnum.optional(),
});

export type FetchBody = z.infer<typeof fetchSchema>;
export type CrawlBody = z.infer<typeof crawlSchema>;
export type ExtractBody = z.infer<typeof extractSchema>;
export type SearchBody = z.infer<typeof searchSchema>;
