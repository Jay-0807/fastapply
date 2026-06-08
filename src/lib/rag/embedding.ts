// Embedding service — wraps OpenAI's text-embedding-3-small.
// Returns Float32Array to keep IndexedDB storage compact.
// See ADR-002 for rationale on choosing this over local transformers.js.

import OpenAI from 'openai';

const MODEL = 'text-embedding-3-small';
const DEFAULT_DIM = 1536;
const BATCH_LIMIT = 100; // OpenAI accepts up to 2048, but batch of 100 is faster to retry

export async function embedTexts(
  apiKey: string,
  texts: string[],
  dimensions: number = DEFAULT_DIM,
): Promise<Float32Array[]> {
  if (!texts.length) return [];
  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });

  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += BATCH_LIMIT) {
    const batch = texts.slice(i, i + BATCH_LIMIT);
    const res = await client.embeddings.create({
      model: MODEL,
      input: batch,
      dimensions,
    });
    for (const item of res.data) {
      out.push(new Float32Array(item.embedding));
    }
  }
  return out;
}

export async function embedOne(apiKey: string, text: string, dimensions: number = DEFAULT_DIM): Promise<Float32Array> {
  const [emb] = await embedTexts(apiKey, [text], dimensions);
  if (!emb) throw new Error('Embedding returned empty result');
  return emb;
}

// ---- Text chunking ----

const CHUNK_SIZE_TOKENS = 800;
const CHUNK_OVERLAP_TOKENS = 100;
// Rough heuristic: 1 token ≈ 4 chars (English) ≈ 1.5 chars (Chinese). We use 3 as middle ground.
const CHARS_PER_TOKEN = 3;
const CHUNK_SIZE_CHARS = CHUNK_SIZE_TOKENS * CHARS_PER_TOKEN;
const CHUNK_OVERLAP_CHARS = CHUNK_OVERLAP_TOKENS * CHARS_PER_TOKEN;

/**
 * Split text into overlapping chunks at paragraph boundaries where possible.
 * Returns array of strings; callers add embeddings + metadata.
 */
export function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (normalized.length <= CHUNK_SIZE_CHARS) return [normalized];

  const chunks: string[] = [];
  const paragraphs = normalized.split(/\n\s*\n/);
  let buf = '';

  for (const p of paragraphs) {
    if ((buf + '\n\n' + p).length <= CHUNK_SIZE_CHARS) {
      buf = buf ? buf + '\n\n' + p : p;
    } else {
      if (buf) chunks.push(buf);
      // If a single paragraph exceeds chunk size, hard-split it
      if (p.length > CHUNK_SIZE_CHARS) {
        for (let i = 0; i < p.length; i += CHUNK_SIZE_CHARS - CHUNK_OVERLAP_CHARS) {
          chunks.push(p.slice(i, i + CHUNK_SIZE_CHARS));
        }
        buf = '';
      } else {
        buf = p;
      }
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

export function approxTokenCount(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
