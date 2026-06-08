// LLM client with streaming + length-constraint retry + 429 backoff.
// Implements ADR-008: 3-layer fallback (primary → fallback → manual).
//
// UX iteration V2.1 (2026-05-24): added provider routing. Despite the
// "claude" path name, this module now dispatches to either Anthropic SDK
// or OpenAI-compatible SDK based on the `provider` arg. File location
// kept stable to avoid import churn — a follow-up rename to `lib/llm/`
// is a tidy task for V2.2.

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { DetectedField, EventContext, Chunk, LLMProviderType } from '@/lib/db/types';
import { SYSTEM_PROMPT, buildUserPrompt, buildRetryPrompt, buildBatchPrompt, parseBatchResponse } from './prompts';

/**
 * `ClaudeModel` is just a string — the wire-level Anthropic model ID, e.g.
 * "claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5". We deliberately
 * do NOT constrain this to a union: the user picks their model in Settings
 * (curated list + free-form custom field), so the set of valid values has to
 * include anything their API key can call — including models released after
 * this build was compiled.
 *
 * Legacy values from earlier builds ("sonnet-4.5", "haiku-3.5") are silently
 * translated by `normalizeModelId()` before hitting the API.
 */
export type ClaudeModel = string;

/** Default fallback model used by the retry path when the primary fails. */
export const DEFAULT_FALLBACK_MODEL = 'claude-haiku-4-5';

/**
 * Translate legacy internal model keys to their current wire-level Anthropic
 * IDs. Anything else passes through unchanged.
 *
 * Old persisted settings (created before the model picker existed) stored
 * 'sonnet-4.5' / 'haiku-3.5' as the model. The Haiku one points at a model
 * that was retired on 2026-02-19 and now 404s, so we must rewrite both.
 */
export function normalizeModelId(model: string): string {
  if (model === 'sonnet-4.5') return 'claude-sonnet-4-5';
  if (model === 'haiku-3.5') return 'claude-haiku-4-5';
  return model;
}

// 30s was too tight: a single field can need 15-25s for streaming + a retry
// path doubles that, plus Anthropic's auto-retry on 429 burns wall-clock too.
// 60s gives headroom without making genuine hangs feel forever.
const TIMEOUT_MS = 60_000;
const MAX_TOKENS = 2048;

export interface GenerateDraftArgs {
  apiKey: string;
  /**
   * V2.1: which LLM protocol to use. Optional for back-compat; defaults to
   * 'anthropic'. When 'openai-compatible', `baseURL` MUST be provided.
   */
  provider?: LLMProviderType;
  /**
   * Required when provider='openai-compatible' (e.g. "https://api.deepseek.com/v1").
   * Ignored when provider='anthropic'.
   */
  baseURL?: string;
  field: DetectedField;
  event: EventContext;
  projectChunks: Chunk[];
  qaChunks: Chunk[];
  model: ClaudeModel;
  /** UX iteration 2026-06-01: optional user steering for a regenerate; threaded into the prompt. */
  refinement?: string;
  /**
   * Model to fall back to on primary failure. Defaults to
   * `DEFAULT_FALLBACK_MODEL` (only used when provider='anthropic'; for
   * openai-compatible we don't fall back since there's no universally
   * available "smaller cheaper" model — user picks one model and we use it).
   * Pass the same string as `model` (or undefined) to disable fallback.
   */
  fallbackModel?: string | null;
  onToken?: (chunk: string) => void;
}

export interface GenerateDraftResult {
  text: string;
  modelUsed: ClaudeModel;
  retried: boolean;
  fallbackUsed: boolean;
  tokenUsage: { input: number; output: number };
}

/**
 * Generate a draft for a single field with constraint enforcement.
 *
 * Flow:
 *   1. Call requested model with full prompt (streaming).
 *   2. If output > maxLength, retry with explicit "shorten" prompt.
 *   3. If retry still violates, hard-truncate (callers must mark as 'failed_constraint').
 *   4. If primary model fails entirely AND provider=anthropic, fall back to Haiku.
 *      (For openai-compatible, fallback is disabled — there's no single
 *      "smaller cheaper" model that works for every OpenAI-compat provider.)
 */
export async function generateDraft(args: GenerateDraftArgs): Promise<GenerateDraftResult> {
  const provider: LLMProviderType = args.provider ?? 'anthropic';
  // Pre-flight: openai-compatible needs a baseURL.
  if (provider === 'openai-compatible' && !args.baseURL) {
    throw new Error('OpenAI-Compatible Provider 缺少 Base URL，请去设置里填好（如 https://api.deepseek.com/v1）');
  }

  const userPrompt = buildUserPrompt({
    field: args.field,
    event: args.event,
    projectChunks: args.projectChunks,
    qaChunks: args.qaChunks,
    ...(args.refinement ? { refinement: args.refinement } : {}),
  });

  const primary = provider === 'anthropic' ? normalizeModelId(args.model) : args.model;
  // Resolve fallback: only meaningful for Anthropic (where DEFAULT_FALLBACK_MODEL
  // = claude-haiku-4-5 is a known-good cheap model). For OpenAI-compat we'd need
  // the user to specify a fallback explicitly per provider — disabled by default
  // since the user already chose their model.
  const fallback = (() => {
    if (provider !== 'anthropic') return null;
    if (args.fallbackModel === null) return null;
    const explicit = args.fallbackModel ? normalizeModelId(args.fallbackModel) : DEFAULT_FALLBACK_MODEL;
    return explicit === primary ? null : explicit;
  })();

  const callArgs = (model: string) => ({
    apiKey: args.apiKey,
    provider,
    baseURL: args.baseURL ?? '',
    model,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    onToken: args.onToken,
  });

  // Generate, then up to 2 shorten-retries if over the cap — each feeds the
  // over-length draft back so the model COMPRESSES to a COMPLETE answer that
  // fits (drop less-important points, keep each complete), rather than us
  // truncating and dropping information. hardTruncate is only a last-resort net
  // for the rare case the model still won't fit after 3 attempts.
  try {
    const cap = args.field.constraints.maxLength;
    let result = await callLLM(callArgs(primary));
    let usageIn = result.usage.input;
    let usageOut = result.usage.output;
    let retried = false;
    const MAX_SHORTEN_RETRIES = 2;
    for (let attempt = 0; attempt < MAX_SHORTEN_RETRIES && violatesLength(result.text, cap); attempt++) {
      retried = true;
      const retryPrompt = buildRetryPrompt(result.text, args.field);
      result = await callLLM({
        ...callArgs(primary),
        userPrompt: `${userPrompt}\n\n${retryPrompt}`,
      });
      usageIn += result.usage.input;
      usageOut += result.usage.output;
    }

    // Last-resort net: still over after the retries → truncate at a complete
    // sentence so we never exceed the form's own server-side cap. Rare.
    const finalText = violatesLength(result.text, cap) ? hardTruncate(result.text, cap!) : result.text;

    return {
      text: finalText,
      modelUsed: primary,
      retried,
      fallbackUsed: false,
      tokenUsage: { input: usageIn, output: usageOut },
    };
  } catch (primaryErr) {
    // Primary model failed entirely. Try the fallback once if one is configured.
    if (fallback) {
      console.warn(`[llm] ${primary} failed, falling back to ${fallback}:`, primaryErr);
      try {
        const fb = await callLLM(callArgs(fallback));
        const finalText = violatesLength(fb.text, args.field.constraints.maxLength)
          ? hardTruncate(fb.text, args.field.constraints.maxLength!)
          : fb.text;
        return {
          text: finalText,
          modelUsed: fallback,
          retried: false,
          fallbackUsed: true,
          tokenUsage: fb.usage,
        };
      } catch (fallbackErr) {
        // Both failed — surface the original error so users see the most
        // actionable message (usually a key/model problem, not a Haiku
        // problem).
        throw primaryErr;
      }
    }
    // No fallback configured (or it equals primary) → propagate.
    throw primaryErr;
  }
}

// ===========================================================================
// UX iteration 2026-05-24 (D): Batch generation
// ---------------------------------------------------------------------------
// Single Claude call returning JSON for N fields at once. ~3x token reduction
// vs N separate calls because event/RAG context is shared.
// Quality trade-off: Claude has less per-field focus, drafts may be slightly
// more generic. We accept this for non-choice fields where output is
// free-form text; choice fields still go through generateDraft (per-field)
// for strict output-format enforcement.
// ===========================================================================

export interface GenerateBatchDraftsArgs {
  apiKey: string;
  /** V2.1: which protocol to use. Defaults to 'anthropic' for back-compat. */
  provider?: LLMProviderType;
  /** Required when provider='openai-compatible'. */
  baseURL?: string;
  fields: DetectedField[];
  event: EventContext;
  projectChunks: Chunk[];
  qaChunks: Chunk[];
  model: ClaudeModel;
  fallbackModel?: string | null;
}

export interface GenerateBatchDraftsResult {
  /** fieldId → draft text. May be missing entries if Claude omitted them — caller should fall back per-field. */
  drafts: Record<string, string>;
  modelUsed: ClaudeModel;
  fallbackUsed: boolean;
  tokenUsage: { input: number; output: number };
}

/**
 * Generate N drafts in one call. Returns drafts keyed by fieldId.
 *
 * Failure modes:
 *   - JSON parse error → throws (caller should fall back to per-field).
 *   - 429 → handled by callClaude's built-in 60s backoff retry.
 *   - 4xx/5xx → throws.
 *   - Missing field in JSON → returned drafts map will not contain that fieldId;
 *     caller can detect (Object.keys(drafts).length < fields.length) and retry.
 */
export async function generateBatchDrafts(args: GenerateBatchDraftsArgs): Promise<GenerateBatchDraftsResult> {
  const provider: LLMProviderType = args.provider ?? 'anthropic';
  if (provider === 'openai-compatible' && !args.baseURL) {
    throw new Error('OpenAI-Compatible Provider 缺少 Base URL，请去设置里填好');
  }

  const { prompt, keyMap } = buildBatchPrompt({
    fields: args.fields,
    event: args.event,
    projectChunks: args.projectChunks,
    qaChunks: args.qaChunks,
  });

  const primary = provider === 'anthropic' ? normalizeModelId(args.model) : args.model;
  const fallback = (() => {
    if (provider !== 'anthropic') return null;
    if (args.fallbackModel === null) return null;
    const explicit = args.fallbackModel ? normalizeModelId(args.fallbackModel) : DEFAULT_FALLBACK_MODEL;
    return explicit === primary ? null : explicit;
  })();

  // Bump max_tokens to accommodate N drafts. Heuristic: 600 tokens per field
  // (covers typical 200-char Chinese text + JSON overhead). Cap at 8K to be
  // safe with all current Anthropic + OpenAI-compat models.
  const batchMaxTokens = Math.min(8192, Math.max(MAX_TOKENS, args.fields.length * 600 + 256));

  const callArgs = (model: string) => ({
    apiKey: args.apiKey,
    provider,
    baseURL: args.baseURL ?? '',
    model,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: prompt,
    maxTokensOverride: batchMaxTokens,
  });

  try {
    const raw = await callLLM(callArgs(primary));
    const parsed = parseBatchResponse(raw.text, keyMap);
    if (!parsed) throw new Error('批量生成返回的 JSON 无法解析');
    return {
      drafts: parsed,
      modelUsed: primary,
      fallbackUsed: false,
      tokenUsage: raw.usage,
    };
  } catch (primaryErr) {
    if (fallback) {
      console.warn(`[llm.batch] ${primary} failed, falling back to ${fallback}:`, primaryErr);
      try {
        const raw = await callLLM(callArgs(fallback));
        const parsed = parseBatchResponse(raw.text, keyMap);
        if (!parsed) throw new Error('批量生成返回的 JSON 无法解析（fallback model 也失败）');
        return {
          drafts: parsed,
          modelUsed: fallback,
          fallbackUsed: true,
          tokenUsage: raw.usage,
        };
      } catch (fallbackErr) {
        // Propagate the primary error — usually more informative
        // (e.g. 429 on primary tells the user to switch tier, not "fallback failed").
        throw primaryErr;
      }
    }
    throw primaryErr;
  }
}

export interface CallArgs {
  apiKey: string;
  /** V2.1: dispatch routing. */
  provider: LLMProviderType;
  /** Required when provider='openai-compatible'. Ignored otherwise. */
  baseURL: string;
  /** Wire-level model ID, already normalized for the relevant provider. */
  model: string;
  systemPrompt: string;
  userPrompt: string;
  onToken?: ((chunk: string) => void) | undefined;
  /** Override the default MAX_TOKENS. Used by batch generation. */
  maxTokensOverride?: number;
}

interface CallResult {
  text: string;
  usage: { input: number; output: number };
}

/**
 * Provider-aware dispatcher. Routes to the right SDK and wraps with 429
 * backoff (one retry after 60s). Backoff applies to BOTH providers — OpenAI
 * proxies also rate-limit, and the same 60s wait is reasonable for most
 * tier-1 quotas.
 */
// V0.3.0 (PRD §10): exported so the LLM semantic field-extraction pipeline
// (src/lib/fields/semantic/extract.ts) reuses the exact same provider dispatch
// + 429 backoff. Behaviour unchanged for existing internal callers.
export async function callLLM(args: CallArgs): Promise<CallResult> {
  const once = args.provider === 'openai-compatible' ? callOpenAICompatOnce : callAnthropicOnce;
  try {
    return await once(args);
  } catch (err) {
    if (is429RateLimit(err)) {
      args.onToken?.('\n[⏸ 触发 rate limit，等待 60 秒后自动重试…]\n');
      await sleep(60_000);
      return await once(args);
    }
    throw err;
  }
}

async function callAnthropicOnce(args: CallArgs): Promise<CallResult> {
  const client = new Anthropic({
    apiKey: args.apiKey,
    timeout: TIMEOUT_MS,
    dangerouslyAllowBrowser: true, // running inside a Chrome extension is OK
  });

  const stream = client.messages.stream({
    model: args.model,
    max_tokens: args.maxTokensOverride ?? MAX_TOKENS,
    system: args.systemPrompt,
    messages: [{ role: 'user', content: args.userPrompt }],
  });

  let acc = '';
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const ev of stream) {
    if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
      const tok = ev.delta.text;
      acc += tok;
      args.onToken?.(tok);
    }
    if (ev.type === 'message_start') {
      inputTokens = ev.message.usage.input_tokens;
    }
    if (ev.type === 'message_delta' && ev.usage) {
      outputTokens = ev.usage.output_tokens;
    }
  }

  return { text: acc.trim(), usage: { input: inputTokens, output: outputTokens } };
}

/**
 * V2.1: OpenAI-compatible streaming. Used for:
 *   - OpenAI itself
 *   - DeepSeek, Moonshot Kimi, Zhipu GLM, ByteDance Doubao, Aliyun Qwen
 *   - Self-hosted vLLM / Ollama / Llama.cpp (with OpenAI-compat endpoint)
 *   - Anything else exposing /v1/chat/completions
 *
 * Differences from Anthropic SDK:
 *   - System prompt lives as a message with role=system (not a top-level field).
 *   - Token usage may arrive as a single `chunk.usage` on the final SSE frame
 *     (OpenAI's `stream_options.include_usage`), or never (some forks). Both
 *     paths are handled with sensible fallbacks.
 *   - dangerouslyAllowBrowser=true is required because we're in an extension.
 */
async function callOpenAICompatOnce(args: CallArgs): Promise<CallResult> {
  const client = new OpenAI({
    apiKey: args.apiKey,
    baseURL: args.baseURL,
    timeout: TIMEOUT_MS,
    dangerouslyAllowBrowser: true,
  });

  // Many OpenAI-compatible providers (DeepSeek, Moonshot, GLM) honor
  // stream_options.include_usage; some don't. Request it but don't depend on it.
  const stream = await client.chat.completions.create({
    model: args.model,
    max_tokens: args.maxTokensOverride ?? MAX_TOKENS,
    messages: [
      { role: 'system', content: args.systemPrompt },
      { role: 'user', content: args.userPrompt },
    ],
    stream: true,
    stream_options: { include_usage: true },
  });

  let acc = '';
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      acc += delta;
      args.onToken?.(delta);
    }
    // Final usage frame on supporting providers.
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
      outputTokens = chunk.usage.completion_tokens ?? outputTokens;
    }
  }

  return { text: acc.trim(), usage: { input: inputTokens, output: outputTokens } };
}

/**
 * Sniff whether an error is a 429 rate-limit response. Anthropic SDK throws
 * APIError instances with a `.status` field; some intermediate proxies may
 * wrap it differently. We try the structured signal first then fall back
 * to message regex.
 */
function is429RateLimit(err: unknown): boolean {
  if (!err) return false;
  // Anthropic SDK APIError shape
  const e = err as { status?: number; error?: { type?: string }; message?: string };
  if (e.status === 429) return true;
  if (e.error?.type === 'rate_limit_error') return true;
  if (typeof e.message === 'string' && /rate.?limit|429|rate_limit_error/i.test(e.message)) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Length check that handles both Chinese chars and English words/chars.
 * Chinese chars are 1 unit; ASCII is counted as a char.
 */
function violatesLength(text: string, maxLength: number | undefined): boolean {
  if (!maxLength) return false;
  return countChars(text) > maxLength;
}

function countChars(text: string): number {
  // Each grapheme = 1 unit. For most platforms this is what they actually count.
  return Array.from(text).length;
}

// Last-resort truncation when the model twice ignored the length cap. A blind
// slice cuts mid-sentence ("...在 200 字停在半句话") — instead we walk back from
// the limit to the last sentence-ending punctuation and end there, so the user
// gets a complete thought. Falls back to a clause break, then a hard clip if a
// single sentence is longer than the whole budget.
export function hardTruncate(text: string, maxLength: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  const limit = Math.min(maxLength, chars.length);
  // Completeness FIRST: cut at the LAST sentence boundary within the budget, no
  // matter how much overflow we drop. The model routinely overshoots the cap
  // (observed 2026-06-02: 533 chars for a 200-char Tagline, 3496 for a 2000
  // Description), so everything past the last full sentence is overflow anyway.
  //
  // A sentence boundary is a CJK ender (。！？…) OR an ASCII . ! ? FOLLOWED by
  // whitespace/end. Recognising the ASCII PERIOD is the core fix: the old set
  // had only 。 ! ? so ENGLISH answers (which end on ".") never matched a
  // sentence end and ALWAYS fell to a comma → half sentence. The whitespace
  // guard avoids cutting inside "epicconnector.ai", "3.5", or "U.S.".
  const isSentenceEnd = (i: number): boolean => {
    const c = chars[i]!;
    if ('。！？…'.includes(c)) return true;
    if (c === '.' || c === '!' || c === '?') {
      const next = chars[i + 1];
      return next === undefined || /\s/.test(next);
    }
    return false;
  };
  for (let i = limit - 1; i >= 0; i--) {
    if (isSentenceEnd(i)) return chars.slice(0, i + 1).join('');
  }
  // No sentence boundary at all in range — fall back to a clause break, then a
  // hard clip (only reached by content with zero sentence punctuation).
  const CLAUSE_END = '，,；;、）)';
  for (let i = limit - 1; i >= 0; i--) {
    if (CLAUSE_END.includes(chars[i]!)) return chars.slice(0, i + 1).join('');
  }
  return chars.slice(0, maxLength).join('');
}
