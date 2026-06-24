import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/lib/db/schema';
import { retrieveHybrid, retrieveGraphAware } from './retrieval';
import type { Chunk, EventContext, QARecord } from '@/lib/db/types';

function qaChunk(id: string, sourceId: string, text: string): Chunk {
  return {
    id, sourceType: 'qa', sourceId, projectId: 'p1', text,
    embedding: new Float32Array(0), embeddingModel: '', tokenCount: 0,
    excludedFromRag: false, createdAt: 0, metadata: {},
  };
}

function evt(id: string, p: Partial<EventContext>): EventContext {
  return {
    id, name: '', theme: '', organizer: '', location: '', url: '',
    deadline: null, extraNotes: '', pageMetaJson: {}, createdAt: 0, ...p,
  };
}

function rec(id: string, eventContextId: string): QARecord {
  return {
    id, projectId: 'p1', eventContextId, personIds: [], status: 'submitted',
    qaPairs: [], markdownPath: null, submittedAt: 0, pageUrl: '', pageTitle: '',
    stats: { accepted: 0, edited_minor: 0, edited_major: 0, rewritten: 0, skipped: 0 }, createdAt: 0,
  };
}

describe('retrieveGraphAware', () => {
  beforeEach(async () => {
    await db.open();
    await Promise.all([db.chunks.clear(), db.qaRecords.clear(), db.eventContexts.clear()]);
  });

  it('ranks the answer from a SIMILAR past event first when keyword overlap ties', async () => {
    // Two past answers with IDENTICAL text (so identical keyword score) but from
    // events of very different similarity to the current one.
    const sharedText = 'Q: 项目简介\nA: 我们做 AI Agent。';
    await db.eventContexts.bulkAdd([
      evt('e_sim', { theme: 'AI Agent 黑客松', organizer: 'MiroMind', location: '上海' }),
      evt('e_diff', { theme: '新能源储能政策', organizer: '某市政府', location: '深圳' }),
    ]);
    await db.qaRecords.bulkAdd([rec('r_sim', 'e_sim'), rec('r_diff', 'e_diff')]);
    await db.chunks.bulkAdd([
      qaChunk('c_diff', 'r_diff', sharedText),
      qaChunk('c_sim', 'r_sim', sharedText),
    ]);

    const current = evt('e_now', { theme: 'AI Agent', organizer: 'MiroMind', location: '上海' });
    const { qaResults } = await retrieveGraphAware({ projectId: 'p1', currentEvent: current, query: '项目简介' });

    expect(qaResults[0]?.chunk.sourceId).toBe('r_sim');
  });

  it('does not regress the keyword baseline ordering when the current event is blank', async () => {
    // Different keyword relevance; no event signal → must preserve keyword order.
    await db.eventContexts.bulkAdd([evt('e1', {}), evt('e2', {})]);
    await db.qaRecords.bulkAdd([rec('r1', 'e1'), rec('r2', 'e2')]);
    await db.chunks.bulkAdd([
      qaChunk('c1', 'r1', 'Q: 团队介绍\nA: 三人团队。'),       // no overlap with query
      qaChunk('c2', 'r2', 'Q: 项目简介 愿景 目标\nA: 简介。'), // overlaps query "项目简介"
    ]);

    const blank = evt('e_now', {});
    const graph = await retrieveGraphAware({ projectId: 'p1', currentEvent: blank, query: '项目简介' });
    const baseline = await retrieveHybrid({ projectId: 'p1', query: '项目简介' });

    // Same top candidate as the pure-keyword baseline.
    expect(graph.qaResults[0]?.chunk.id).toBe(baseline.qaResults[0]?.chunk.id);
    expect(graph.qaResults[0]?.chunk.id).toBe('c2');
  });

  it('keeps document retrieval identical to the keyword baseline', async () => {
    await db.chunks.bulkAdd([
      { id: 'd1', sourceType: 'document', sourceId: 's1', projectId: 'p1', text: '项目简介 文档', embedding: new Float32Array(0), embeddingModel: '', tokenCount: 0, excludedFromRag: false, createdAt: 0, metadata: {} },
    ]);
    const current = evt('e_now', { theme: 'AI' });
    const graph = await retrieveGraphAware({ projectId: 'p1', currentEvent: current, query: '项目简介' });
    const baseline = await retrieveHybrid({ projectId: 'p1', query: '项目简介' });
    expect(graph.documentResults.map((r) => r.chunk.id)).toEqual(baseline.documentResults.map((r) => r.chunk.id));
  });
});
