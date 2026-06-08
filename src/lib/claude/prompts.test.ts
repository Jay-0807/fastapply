// Tests for batch-prompt JSON parser tolerance.
// Claude sometimes wraps output in ```json``` blocks or adds preambles —
// parseBatchResponse must absorb those quirks so the per-field dispatch
// doesn't silently lose drafts.

import { describe, expect, it } from 'vitest';
import { parseBatchResponse, buildBatchPrompt, buildUserPrompt } from './prompts';
import type { DetectedField, EventContext, Chunk } from '@/lib/db/types';

const stubEvent: EventContext = {
  id: 'evt-1',
  name: 'Test Event',
  theme: '',
  organizer: '',
  location: '',
  url: '',
  deadline: null,
  extraNotes: '',
  pageMetaJson: {},
  createdAt: 0,
};

function field(id: string, label: string): DetectedField {
  return {
    fieldId: id,
    domSelector: `#${id}`,
    label,
    type: 'textarea',
    constraints: {},
    rawElementInfo: { tagName: 'textarea', classes: [] },
  };
}

describe('buildUserPrompt — language + refinement (2026-06-01)', () => {
  it('forces English output on an English-language form', () => {
    const p = buildUserPrompt({ field: field('f', 'Tagline'), event: stubEvent, projectChunks: [], qaChunks: [] });
    expect(p).toContain('English');
    expect(p).not.toContain('本表单为中文表单');
  });

  it('keeps Chinese on a Chinese-language form', () => {
    const p = buildUserPrompt({ field: field('f', '项目一句话简介'), event: stubEvent, projectChunks: [], qaChunks: [] });
    expect(p).toContain('中文表单');
  });

  it('injects a regenerate refinement as a high-priority instruction', () => {
    const p = buildUserPrompt({ field: field('f', 'Tagline'), event: stubEvent, projectChunks: [], qaChunks: [], refinement: '更简短，突出落地' });
    expect(p).toContain('更简短，突出落地');
    expect(p).toContain('修改要求');
  });

  it('decides language from the FIELD, not the event context (English field on a Chinese-event form → English)', () => {
    // The exact bug: an English form field whose detected event context is
    // Chinese was forced to Chinese, overriding the field's own language.
    const zhEvent: EventContext = { ...stubEvent, name: '上海创业大赛', theme: '人工智能黑客松' };
    const p = buildUserPrompt({ field: field('f', 'Tagline'), event: zhEvent, projectChunks: [], qaChunks: [] });
    expect(p).toContain('English');
    expect(p).not.toContain('中文表单字段');
  });

  it('puts the refinement ABOVE the language directive so an explicit language request wins', () => {
    const p = buildUserPrompt({ field: field('f', '项目简介'), event: stubEvent, projectChunks: [], qaChunks: [], refinement: '用英文写' });
    expect(p.indexOf('修改要求')).toBeGreaterThanOrEqual(0);
    expect(p.indexOf('修改要求')).toBeLessThan(p.indexOf('语言要求'));
  });
});

describe('parseBatchResponse', () => {
  const keyMap = { f1: 'field-A', f2: 'field-B', f3: 'field-C' };

  it('parses clean JSON', () => {
    const raw = '{"f1":"answer A","f2":"answer B","f3":"answer C"}';
    expect(parseBatchResponse(raw, keyMap)).toEqual({
      'field-A': 'answer A',
      'field-B': 'answer B',
      'field-C': 'answer C',
    });
  });

  it('recovers FULL values when an English answer has unescaped quotes (the mid-sentence cutoff bug)', () => {
    // JSON.parse fails on the embedded ASCII quotes; the old regex fallback
    // truncated field-A at the first quote ("Firefly uses a "). Structure-aware
    // recovery keeps the whole value, embedded quotes and all.
    const raw = '{"f1":"Firefly uses a "quorum gate" to reach consensus, unlike systems that self-iterate.","f2":"Short and complete."}';
    const got = parseBatchResponse(raw, { f1: 'field-A', f2: 'field-B' });
    expect(got).not.toBeNull();
    expect(got!['field-A']).toBe('Firefly uses a "quorum gate" to reach consensus, unlike systems that self-iterate.');
    expect(got!['field-B']).toBe('Short and complete.');
  });

  it('strips ```json wrapping', () => {
    const raw = '```json\n{"f1":"a","f2":"b","f3":"c"}\n```';
    expect(parseBatchResponse(raw, keyMap)).toEqual({
      'field-A': 'a',
      'field-B': 'b',
      'field-C': 'c',
    });
  });

  it('strips plain ``` wrapping (no language tag)', () => {
    const raw = '```\n{"f1":"x","f2":"y","f3":"z"}\n```';
    expect(parseBatchResponse(raw, keyMap)).toEqual({
      'field-A': 'x',
      'field-B': 'y',
      'field-C': 'z',
    });
  });

  it('absorbs preamble text before JSON', () => {
    const raw = 'Here are the drafts:\n\n{"f1":"a","f2":"b","f3":"c"}';
    expect(parseBatchResponse(raw, keyMap)).toEqual({
      'field-A': 'a',
      'field-B': 'b',
      'field-C': 'c',
    });
  });

  it('tolerates trailing commas', () => {
    const raw = '{"f1":"a","f2":"b","f3":"c",}';
    expect(parseBatchResponse(raw, keyMap)).toEqual({
      'field-A': 'a',
      'field-B': 'b',
      'field-C': 'c',
    });
  });

  it('returns partial map when some keys are missing — caller falls back per-field', () => {
    const raw = '{"f1":"only first","f3":"third only"}';
    expect(parseBatchResponse(raw, keyMap)).toEqual({
      'field-A': 'only first',
      'field-C': 'third only',
    });
  });

  it('returns null when no JSON object found', () => {
    expect(parseBatchResponse('no json here', keyMap)).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    expect(parseBatchResponse('{"f1": broken', keyMap)).toBeNull();
  });

  it('coerces primitive non-strings to string; drops null/objects', () => {
    // UX iteration 2026-05-30: numbers/booleans coerced (harmless, more robust);
    // null/objects still dropped.
    const raw = '{"f1":"valid","f2":123,"f3":null}';
    expect(parseBatchResponse(raw, keyMap)).toEqual({
      'field-A': 'valid',
      'field-B': '123',
    });
  });

  // UX iteration 2026-05-30 — the real-form failure: raw newlines inside a
  // multi-line value break JSON.parse. The repair pass must recover it.
  it('recovers JSON with RAW newlines inside a string value (the real bug)', () => {
    const raw = '{"f1":"第一段。\n\n第二段，含真实换行。","f2":"b","f3":"c"}';
    expect(parseBatchResponse(raw, keyMap)).toEqual({
      'field-A': '第一段。\n\n第二段，含真实换行。',
      'field-B': 'b',
      'field-C': 'c',
    });
  });

  it('recovers raw tabs/CR inside string values', () => {
    const raw = '{"f1":"line1\tcol2","f2":"b\r\nc","f3":"x"}';
    const got = parseBatchResponse(raw, keyMap);
    expect(got?.['field-A']).toContain('line1');
    expect(got?.['field-B']).toContain('b');
    expect(got?.['field-C']).toBe('x');
  });

  it('regex-extracts pairs when JSON is otherwise irreparable (prose around values)', () => {
    // No clean object braces / extra prose — Hail-Mary regex extraction.
    const raw = '这是回答：\n"f1": "答案一",\n"f2": "答案二"，剩下的省略';
    const got = parseBatchResponse(raw, keyMap);
    expect(got?.['field-A']).toBe('答案一');
    expect(got?.['field-B']).toBe('答案二');
  });
});

describe('buildBatchPrompt', () => {
  it('builds key map matching field count', () => {
    const fields = [field('a-1', '项目名'), field('b-2', '愿景'), field('c-3', '团队')];
    const result = buildBatchPrompt({
      fields,
      event: stubEvent,
      projectChunks: [],
      qaChunks: [],
    });
    expect(result.keyMap).toEqual({ f1: 'a-1', f2: 'b-2', f3: 'c-3' });
    // Prompt must contain the JSON skeleton with the synthetic keys so
    // Claude mimics the exact format.
    expect(result.prompt).toContain('"f1": "..."');
    expect(result.prompt).toContain('"f2": "..."');
    expect(result.prompt).toContain('"f3": "..."');
    // Per-field metadata must appear
    expect(result.prompt).toContain('项目名');
    expect(result.prompt).toContain('愿景');
    expect(result.prompt).toContain('团队');
  });

  it('truncates long RAG chunks in the prompt', () => {
    const longChunk: Chunk = {
      id: 'c1',
      sourceType: 'document',
      sourceId: 'd1',
      projectId: 'p1',
      text: 'x'.repeat(800),
      embedding: new Float32Array(0),
      embeddingModel: '',
      tokenCount: 0,
      excludedFromRag: false,
      createdAt: 0,
      metadata: {},
    };
    const result = buildBatchPrompt({
      fields: [field('a', 'L')],
      event: stubEvent,
      projectChunks: [longChunk],
      qaChunks: [],
    });
    // Truncation marker present (means 400-char cap applied)
    expect(result.prompt).toContain('…(已截断)');
    // The full 800 'x's should NOT be in the prompt
    expect(result.prompt).not.toContain('x'.repeat(800));
  });
});
