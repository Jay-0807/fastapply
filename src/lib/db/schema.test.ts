// Minimal smoke test — verifies that the Dexie schema initializes and
// CRUD operations succeed in the test environment (fake-indexeddb).
//
// More thorough coverage lives in 07-test.md / Playwright E2E.

import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { ApplyForgeDB } from './schema';

describe('ApplyForgeDB', () => {
  let db: ApplyForgeDB;

  beforeEach(async () => {
    db = new ApplyForgeDB();
    await db.delete();
    db = new ApplyForgeDB();
    await db.open();
  });

  it('creates a project and retrieves it', async () => {
    await db.projects.add({
      id: 'p1',
      name: 'Firefly OS',
      description: 'AI agents for e-commerce',
      tags: ['ai', 'agent'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      applicationCount: 0,
    });
    const found = await db.projects.get('p1');
    expect(found?.name).toBe('Firefly OS');
  });

  it('filters chunks by compound index + in-memory excludedFromRag', async () => {
    await db.chunks.bulkAdd([
      {
        id: 'c1', sourceType: 'document', sourceId: 's1', projectId: 'p1',
        text: 'doc chunk', embedding: new Float32Array(3),
        embeddingModel: 'test', tokenCount: 1, excludedFromRag: false,
        createdAt: Date.now(), metadata: {},
      },
      {
        id: 'c2', sourceType: 'document', sourceId: 's1', projectId: 'p1',
        text: 'excluded', embedding: new Float32Array(3),
        embeddingModel: 'test', tokenCount: 1, excludedFromRag: true,
        createdAt: Date.now(), metadata: {},
      },
    ]);
    // IDB can't index booleans — query the compound (projectId+sourceType)
    // and filter excludedFromRag in JS afterward.
    const result = (
      await db.chunks
        .where('[projectId+sourceType]')
        .equals(['p1', 'document'])
        .toArray()
    ).filter((c) => !c.excludedFromRag);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('c1');
  });
});

// T8 — V0.3.0 scanMode migration (v5 → v6). The upgrade only fires on a real version bump, so we
// seed a v5-shaped DB, then open the real ApplyForgeDB (v6) on the same name to trigger it.
describe('ApplyForgeDB v6 scanMode migration (T8 / BR1)', () => {
  beforeEach(async () => {
    await Dexie.delete('applyforge_v1');
  });

  async function seedV5(singletonExtra: Record<string, unknown>): Promise<void> {
    const v5 = new Dexie('applyforge_v1');
    v5.version(5).stores({
      projects: 'id, name, createdAt, updatedAt',
      documents: 'id, projectId, parseStatus, createdAt',
      chunks: 'id, projectId, sourceType, sourceId, [projectId+sourceType]',
      eventContexts: 'id, name, createdAt',
      qaRecords: 'id, projectId, eventContextId, status, submittedAt, createdAt',
      appSettings: 'id',
      projectAssets: 'id, projectId, tag, [projectId+tag], createdAt',
    });
    await v5.open();
    await v5.table('appSettings').put({ id: 'singleton', llmConfigs: [], ...singletonExtra });
    v5.close();
  }

  it('backfills scanMode=heuristic for an existing install that lacks it', async () => {
    await seedV5({});
    const db = new ApplyForgeDB();
    await db.open();
    const s = await db.appSettings.get('singleton');
    expect(s?.scanMode).toBe('heuristic');
    db.close();
  });

  it('does NOT override an already-set scanMode', async () => {
    await seedV5({ scanMode: 'hybrid' });
    const db = new ApplyForgeDB();
    await db.open();
    const s = await db.appSettings.get('singleton');
    expect(s?.scanMode).toBe('hybrid');
    db.close();
  });

  it('is a no-op on a fresh install (does not fabricate a singleton)', async () => {
    const db = new ApplyForgeDB();
    await db.open();
    const s = await db.appSettings.get('singleton');
    expect(s).toBeUndefined();
    db.close();
  });
});

// T-KG — V0.4.0 knowledge graph migration (v6 → v7). Seed a v6-shaped DB with
// pre-existing rows that LACK the new graph fields, open the real ApplyForgeDB
// (v7) to fire the upgrade, then assert: (a) no data loss, (b) graph fields
// backfilled, (c) the new persons table works.
describe('ApplyForgeDB v7 knowledge-graph migration (zero data loss)', () => {
  beforeEach(async () => {
    await Dexie.delete('applyforge_v1');
  });

  // v6 store strings == v5 (v6 only added an upgrade, not an index change).
  async function seedV6(): Promise<void> {
    const v6 = new Dexie('applyforge_v1');
    v6.version(6).stores({
      projects: 'id, name, createdAt, updatedAt',
      documents: 'id, projectId, parseStatus, createdAt',
      chunks: 'id, projectId, sourceType, sourceId, [projectId+sourceType]',
      eventContexts: 'id, name, createdAt',
      qaRecords: 'id, projectId, eventContextId, status, submittedAt, createdAt',
      appSettings: 'id',
      projectAssets: 'id, projectId, tag, [projectId+tag], createdAt',
    });
    await v6.open();
    await v6.table('projects').put({
      id: 'p1', name: 'Firefly OS', description: 'AI agents', tags: ['ai'],
      createdAt: 1, updatedAt: 2, applicationCount: 3,
    });
    await v6.table('eventContexts').put({
      id: 'e1', name: '2026 黑客松大赛', theme: 'AI Agent 黑客松', organizer: '某加速器',
      location: '上海', url: 'https://x', deadline: null, extraNotes: '', pageMetaJson: {}, createdAt: 5,
    });
    await v6.table('qaRecords').put({
      id: 'q1', projectId: 'p1', eventContextId: 'e1', status: 'submitted',
      qaPairs: [{ fieldId: 'f1', fieldLabel: '项目简介', fieldType: 'textarea', fieldConstraints: {}, aiDraft: 'd', aiModel: 'm', finalValue: 'v', userAction: 'accepted', ragReferences: { chunkIds: [], similarities: [] }, generatedAt: 9, retryCount: 0 }],
      markdownPath: null, submittedAt: 10, pageUrl: 'u', pageTitle: 't',
      stats: { accepted: 1, edited_minor: 0, edited_major: 0, rewritten: 0, skipped: 0 }, createdAt: 8,
    });
    v6.close();
  }

  it('backfills project.facts={} and memberIds=[] without touching existing data', async () => {
    await seedV6();
    const db = new ApplyForgeDB();
    await db.open();
    const p = await db.projects.get('p1');
    expect(p?.name).toBe('Firefly OS');      // untouched
    expect(p?.applicationCount).toBe(3);     // untouched
    expect(p?.facts).toEqual({});            // backfilled
    expect(p?.memberIds).toEqual([]);        // backfilled
    db.close();
  });

  it('backfills eventType / topicTags (best-effort) on existing events', async () => {
    await seedV6();
    const db = new ApplyForgeDB();
    await db.open();
    const e = await db.eventContexts.get('e1');
    expect(e?.theme).toBe('AI Agent 黑客松');  // untouched
    expect(e?.eventType).toBe('hackathon');    // derived from theme
    expect(Array.isArray(e?.topicTags)).toBe(true);
    expect(e?.topicTags?.length).toBeGreaterThan(0);
    db.close();
  });

  it('backfills qaRecord.personIds=[] and preserves qaPairs', async () => {
    await seedV6();
    const db = new ApplyForgeDB();
    await db.open();
    const q = await db.qaRecords.get('q1');
    expect(q?.personIds).toEqual([]);
    expect(q?.qaPairs).toHaveLength(1);
    expect(q?.qaPairs[0]?.finalValue).toBe('v');
    db.close();
  });

  it('exposes a working persons table + *personIds multiEntry query', async () => {
    await seedV6();
    const db = new ApplyForgeDB();
    await db.open();
    await db.persons.add({
      id: 'per1', displayName: '张三 (创始人)', role: '创始人',
      fields: { name: '张三', phone: '13800000000' }, notes: '', createdAt: 1, updatedAt: 1,
    });
    expect((await db.persons.get('per1'))?.fields.phone).toBe('13800000000');

    // Associate the person with the existing record and query by the multiEntry index.
    await db.qaRecords.update('q1', { personIds: ['per1'] });
    const records = await db.qaRecords.where('personIds').equals('per1').toArray();
    expect(records.map((r) => r.id)).toEqual(['q1']);
    db.close();
  });
});
