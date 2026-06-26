import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './schema';
import { deleteProjectCascade, projectDeletionImpact } from './project-ops';
import type { Chunk, DocumentRecord, ProjectAsset, QARecord } from './types';

function doc(id: string, projectId: string): DocumentRecord {
  return { id, projectId, filename: id, mimeType: 'text/plain', sizeBytes: 1, rawText: '', parseStatus: 'parsed', parseError: null, createdAt: 0 };
}
function chunk(id: string, projectId: string, sourceType: 'document' | 'qa'): Chunk {
  return { id, sourceType, sourceId: 's', projectId, text: '', embedding: new Float32Array(0), embeddingModel: '', tokenCount: 0, excludedFromRag: false, createdAt: 0, metadata: {} };
}
function rec(id: string, projectId: string): QARecord {
  return { id, projectId, eventContextId: 'e', personIds: [], status: 'submitted', qaPairs: [], markdownPath: null, submittedAt: 0, pageUrl: '', pageTitle: '', stats: { accepted: 0, edited_minor: 0, edited_major: 0, rewritten: 0, skipped: 0 }, createdAt: 0 };
}
function asset(id: string, projectId: string): ProjectAsset {
  return { id, projectId, filename: id, mimeType: 'image/png', sizeBytes: 1, blob: new Blob([]), tag: 'photo', createdAt: 0 };
}

describe('deleteProjectCascade — leaves no orphans, spares other projects', () => {
  beforeEach(async () => {
    await db.open();
    await Promise.all([db.projects.clear(), db.documents.clear(), db.chunks.clear(), db.qaRecords.clear(), db.projectAssets.clear(), db.persons.clear()]);
    // Project A (to delete) — fully populated.
    await db.projects.add({ id: 'A', name: 'A', description: '', tags: [], createdAt: 0, updatedAt: 0, applicationCount: 0, memberIds: ['per1'] });
    await db.documents.bulkAdd([doc('dA', 'A')]);
    await db.chunks.bulkAdd([chunk('cA1', 'A', 'document'), chunk('cA2', 'A', 'qa')]);
    await db.qaRecords.bulkAdd([rec('rA', 'A')]);
    await db.projectAssets.bulkAdd([asset('aA', 'A')]);
    // Project B (must survive untouched).
    await db.projects.add({ id: 'B', name: 'B', description: '', tags: [], createdAt: 0, updatedAt: 0, applicationCount: 0 });
    await db.documents.bulkAdd([doc('dB', 'B')]);
    await db.chunks.bulkAdd([chunk('cB', 'B', 'document')]);
    await db.projectAssets.bulkAdd([asset('aB', 'B')]);
    // A shared person — must NOT be deleted.
    await db.persons.add({ id: 'per1', displayName: 'X', role: '', fields: {}, notes: '', createdAt: 0, updatedAt: 0 });
  });

  it('reports the correct deletion impact', async () => {
    expect(await projectDeletionImpact('A')).toEqual({ documents: 1, chunks: 2, qaRecords: 1, assets: 1 });
  });

  it('removes the project + ALL its owned rows including assets (the old orphan bug)', async () => {
    await deleteProjectCascade('A');
    expect(await db.projects.get('A')).toBeUndefined();
    expect(await db.documents.where('projectId').equals('A').count()).toBe(0);
    expect(await db.chunks.where('projectId').equals('A').count()).toBe(0);
    expect(await db.qaRecords.where('projectId').equals('A').count()).toBe(0);
    expect(await db.projectAssets.where('projectId').equals('A').count()).toBe(0); // regression: was orphaned
  });

  it('does not touch other projects or shared persons', async () => {
    await deleteProjectCascade('A');
    expect(await db.projects.get('B')).toBeDefined();
    expect(await db.documents.where('projectId').equals('B').count()).toBe(1);
    expect(await db.chunks.where('projectId').equals('B').count()).toBe(1);
    expect(await db.projectAssets.where('projectId').equals('B').count()).toBe(1);
    expect(await db.persons.get('per1')).toBeDefined(); // shared person survives
  });
});
