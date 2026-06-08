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
