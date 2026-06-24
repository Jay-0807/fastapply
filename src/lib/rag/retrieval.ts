// V1 retrieval — no embedding. We just pull every chunk for the project and
// rank by keyword overlap. Sonnet 4.5's 200K context window is large enough
// that a typical user's project corpus + Q&A history fits without needing a
// vector index. See ADR note on uploadDocument for the full rationale.
//
// The function signature still returns a `similarity` field so downstream
// callers don't need to change — for V1 it's a keyword-overlap score in [0,1]
// rather than cosine similarity.

import { db } from '@/lib/db/schema';
import type { Chunk, ChunkSourceType, EventContext } from '@/lib/db/types';
import { scoreEventSimilarity } from '@/lib/graph/event-similarity';

export interface RetrievalResult {
  chunk: Chunk;
  similarity: number;
}

export interface RetrieveArgs {
  projectId: string;
  query: string;
  topK?: number;
  sourceType?: ChunkSourceType;
}

export async function retrieve(args: RetrieveArgs): Promise<RetrievalResult[]> {
  const { projectId, query, topK, sourceType } = args;

  // IDB doesn't index booleans → filter excludedFromRag in memory.
  const baseQuery = sourceType
    ? db.chunks.where('[projectId+sourceType]').equals([projectId, sourceType])
    : db.chunks.where('projectId').equals(projectId);

  const candidates = (await baseQuery.toArray()).filter((c) => !c.excludedFromRag);
  if (!candidates.length) return [];

  const queryTokens = tokenize(query);
  const scored: RetrievalResult[] = candidates.map((c) => ({
    chunk: c,
    similarity: keywordOverlap(queryTokens, tokenize(c.text)),
  }));

  scored.sort((a, b) => b.similarity - a.similarity);
  return topK ? scored.slice(0, topK) : scored;
}

/**
 * Default chunk caps + per-chunk truncation.
 *
 * Evolution:
 *   - V1 initial: returned ALL chunks, banking on Sonnet's 200K context.
 *     Result: 5 parallel fields × ~15K chunks each = ~75K tokens burst → 429.
 *   - V1 fix: capped to 12 docs + 5 QA, made generation sequential.
 *     Result: 23-field forms still hit 429 sustained over 4-5 minutes
 *     (~10K/req × 6 reqs/min = 60K/min, over the 30K tier-1 limit).
 *   - V2 (this iteration 2026-05-24): capped to 5 docs + 2 QA, plus per-chunk
 *     character truncation in prompts.ts. Brings each request to ~1500 input
 *     tokens, easily sustainable at 30K/min.
 *
 * Caller can pass explicit `topKDocs` / `topKQA` to override (e.g. one-off
 * Opus 4.7 1M-context run with rich context).
 */
const DEFAULT_TOPK_DOCS = 5;
const DEFAULT_TOPK_QA = 2;

/**
 * Max characters per chunk when formatted into a prompt. Long chunks get
 * truncated with an ellipsis marker. The retrieval ranker has already
 * surfaced the most relevant N — within those N, the first 400 chars
 * usually contain the highest-density keyword evidence (intro sentences,
 * not appendix lists). Used by buildUserPrompt / buildChoicePrompt.
 */
export const MAX_CHUNK_CHARS_FOR_PROMPT = 400;

export async function retrieveHybrid(args: {
  projectId: string;
  query: string;
  topKDocs?: number;
  topKQA?: number;
}): Promise<{ documentResults: RetrievalResult[]; qaResults: RetrievalResult[] }> {
  const documentResults = await retrieve({
    projectId: args.projectId,
    query: args.query,
    sourceType: 'document',
    topK: args.topKDocs ?? DEFAULT_TOPK_DOCS,
  });
  const qaResults = await retrieve({
    projectId: args.projectId,
    query: args.query,
    topK: args.topKQA ?? DEFAULT_TOPK_QA,
    sourceType: 'qa',
  });
  return { documentResults, qaResults };
}

// ===========================================================================
// V0.4.0 — graph-aware retrieval
// ---------------------------------------------------------------------------
// The fix for "调取类似赛事的历史答案 doesn't work". `retrieveHybrid` ranks QA
// purely by keyword overlap with the field label, blind to WHICH event each
// past answer came from. This re-ranks the QA candidates by blending that
// keyword score with how SIMILAR the past answer's event is to the event the
// user is applying to now (theme / organizer / type / location).
//
// Non-regression guarantee (load-bearing invariant #3): keyword stays the
// dominant term (0.7 vs 0.3), so this can only re-order — never demote a
// keyword-relevant answer below an irrelevant one — and when the current event
// has no usable metadata, sim≈0 and the ordering collapses back to the keyword
// baseline. Document retrieval is byte-for-byte the same as retrieveHybrid.
// ===========================================================================

/** QA re-rank weights. Keyword dominates; event similarity breaks ties + lifts same-kind events. */
export const QA_KEYWORD_WEIGHT = 0.7;
export const QA_EVENT_WEIGHT = 0.3;

export async function retrieveGraphAware(args: {
  projectId: string;
  currentEvent: EventContext;
  query: string;
  topKDocs?: number;
  topKQA?: number;
}): Promise<{ documentResults: RetrievalResult[]; qaResults: RetrievalResult[] }> {
  // Documents: identical to the keyword baseline — facts injection happens at
  // prompt-build time, not here.
  const documentResults = await retrieve({
    projectId: args.projectId,
    query: args.query,
    sourceType: 'document',
    topK: args.topKDocs ?? DEFAULT_TOPK_DOCS,
  });

  // QA: score ALL candidates by keyword first (no topK cap yet), then re-rank by
  // event similarity, THEN cap.
  const qaScored = await retrieve({
    projectId: args.projectId,
    query: args.query,
    sourceType: 'qa',
  });

  const qaResults = await rerankByEventSimilarity(qaScored, args.currentEvent);
  return { documentResults, qaResults: qaResults.slice(0, args.topKQA ?? DEFAULT_TOPK_QA) };
}

/**
 * Re-rank keyword-scored QA chunks by event similarity. Resolves each chunk's
 * source event via its qaRecord (sourceId → qaRecord.eventContextId), so it
 * works for chunks seeded before V0.4.0 too (they just resolve via the record).
 * A chunk whose event can't be resolved keeps sim=0 (pure keyword fallback).
 */
async function rerankByEventSimilarity(
  candidates: RetrievalResult[],
  currentEvent: EventContext,
): Promise<RetrievalResult[]> {
  if (!candidates.length) return candidates;

  // sourceId of a QA chunk is the qaRecord id. Batch-resolve record → eventId → event.
  const recordIds = [...new Set(candidates.map((r) => r.chunk.sourceId))];
  const records = await db.qaRecords.bulkGet(recordIds);
  const recordToEventId = new Map<string, string>();
  for (const rec of records) {
    if (rec) recordToEventId.set(rec.id, rec.eventContextId);
  }
  const eventIds = [...new Set([...recordToEventId.values()])];
  const events = await db.eventContexts.bulkGet(eventIds);
  const eventById = new Map<string, EventContext>();
  for (const e of events) {
    if (e) eventById.set(e.id, e);
  }

  const reranked = candidates.map((r) => {
    const eventId = recordToEventId.get(r.chunk.sourceId);
    const pastEvent = eventId ? eventById.get(eventId) : undefined;
    const sim = pastEvent ? scoreEventSimilarity(currentEvent, pastEvent).score : 0;
    const combined = QA_KEYWORD_WEIGHT * r.similarity + QA_EVENT_WEIGHT * sim;
    return { chunk: r.chunk, similarity: combined };
  });

  reranked.sort((a, b) => b.similarity - a.similarity);
  return reranked;
}

// ----- helpers -----

function tokenize(s: string): Set<string> {
  // Lowercase + split on whitespace and common punctuation. For CJK we also
  // split per character so each Chinese character becomes its own token —
  // it's lossy but enough for "did this chunk mention 黑客松 / 路演 / 主办方"
  // style ranking. V2 may swap this for embeddings.
  const lower = s.toLowerCase();
  const tokens = new Set<string>();
  for (const w of lower.split(/[\s,.;:!?()\[\]{}<>'"，。；：！？（）【】「」、\-_/\\]+/)) {
    if (!w) continue;
    if (/^[一-鿿]+$/.test(w)) {
      // pure CJK string — add each character
      for (const ch of w) tokens.add(ch);
    } else {
      tokens.add(w);
    }
  }
  return tokens;
}

function keywordOverlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits++;
  return hits / Math.max(a.size, b.size);
}

/** Kept for backwards compat with any older import sites — V1 doesn't call this. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
