/**
 * Token accounting for context-window-aware output.
 *
 * Uses gpt-tokenizer (cl100k_base) for a fast, dependency-free estimate that
 * is a good proxy across modern LLMs. Agents use this to budget context and
 * to request page content pre-split into digestible chunks.
 */
import { encode } from "gpt-tokenizer";

/** Estimate the number of tokens in a string. */
export function countTokens(text: string): number {
  if (!text) return 0;
  try {
    return encode(text).length;
  } catch {
    // Fallback heuristic: ~4 characters per token.
    return Math.ceil(text.length / 4);
  }
}

/** Truncate text to at most `maxTokens` tokens (no-op when maxTokens <= 0). */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return text;
  const tokens = encode(text);
  if (tokens.length <= maxTokens) return text;
  // Re-slice on a paragraph/whitespace boundary near the token limit.
  const ratio = maxTokens / tokens.length;
  const approxChars = Math.floor(text.length * ratio);
  let cut = text.slice(0, approxChars);
  const lastBreak = Math.max(cut.lastIndexOf("\n\n"), cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
  if (lastBreak > approxChars * 0.6) cut = cut.slice(0, lastBreak);
  return cut.trimEnd() + "\n\n…[truncated]";
}

/**
 * Split text into chunks of roughly `chunkTokens` tokens, breaking on
 * paragraph boundaries where possible so each chunk stays coherent.
 */
export function chunkByTokens(text: string, chunkTokens: number): string[] {
  if (chunkTokens <= 0) return [text];
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  let currentTokens = 0;

  for (const para of paragraphs) {
    const paraTokens = countTokens(para);

    // A single oversized paragraph: hard-split it on sentence boundaries.
    if (paraTokens > chunkTokens) {
      if (current) {
        chunks.push(current.trim());
        current = "";
        currentTokens = 0;
      }
      const sentences = para.split(/(?<=[.!?])\s+/);
      let buf = "";
      let bufTokens = 0;
      for (const s of sentences) {
        const st = countTokens(s);
        if (bufTokens + st > chunkTokens && buf) {
          chunks.push(buf.trim());
          buf = "";
          bufTokens = 0;
        }
        buf += (buf ? " " : "") + s;
        bufTokens += st;
      }
      if (buf) chunks.push(buf.trim());
      continue;
    }

    if (currentTokens + paraTokens > chunkTokens && current) {
      chunks.push(current.trim());
      current = "";
      currentTokens = 0;
    }
    current += (current ? "\n\n" : "") + para;
    currentTokens += paraTokens;
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}
