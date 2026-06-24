import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/lib/db/schema';
import { importGraphSeed } from './seed-import';
import type { GraphSeed } from '@/lib/db/types';

describe('importGraphSeed — non-destructive bulk seed', () => {
  beforeEach(async () => {
    await db.open();
    await Promise.all([db.projects.clear(), db.persons.clear()]);
  });

  const seed: GraphSeed = {
    project: { name: '萤火虫 Firefly', description: '电商多人多Agent企业AI转型', facts: { sector: 'AI Agent', stage: '种子轮' } },
    persons: [
      { displayName: '杨绍杰', role: '团队成员', fields: { name: '杨绍杰', email: 'y@x.com' } },
      { displayName: '黄文轩', role: 'CTO', fields: { name: '黄文轩' } },
    ],
  };

  it('creates the project + persons on first import and links members', async () => {
    const r = await importGraphSeed(seed, 1000);
    expect(r).toMatchObject({ projectCreated: true, personsCreated: 2, personsUpdated: 0 });
    const projects = await db.projects.toArray();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.facts?.sector).toBe('AI Agent');
    expect(projects[0]?.memberIds).toHaveLength(2);
    expect(await db.persons.count()).toBe(2);
  });

  it('is non-destructive + idempotent: re-import dedupes (no duplicate rows)', async () => {
    await importGraphSeed(seed, 1000);
    const r2 = await importGraphSeed(seed, 2000);
    expect(r2).toMatchObject({ projectUpdated: true, personsCreated: 0, personsUpdated: 2 });
    expect(await db.projects.count()).toBe(1);
    expect(await db.persons.count()).toBe(2);
    // memberIds must not accumulate duplicates.
    const proj = (await db.projects.toArray())[0];
    expect(proj?.memberIds).toHaveLength(2);
  });

  it('merges person fields (incoming wins, existing kept) instead of overwriting', async () => {
    await importGraphSeed(seed, 1000);
    await importGraphSeed({
      persons: [{ displayName: '杨绍杰', fields: { phone: '13800000000', email: 'new@x.com' } }],
    }, 2000);
    const yang = (await db.persons.toArray()).find((p) => p.displayName === '杨绍杰');
    expect(yang?.fields.name).toBe('杨绍杰');        // kept
    expect(yang?.fields.phone).toBe('13800000000');  // added
    expect(yang?.fields.email).toBe('new@x.com');    // overwritten
  });

  it('merges project facts per-key without dropping prior facts/extra', async () => {
    await importGraphSeed({ project: { name: '萤火虫 Firefly', facts: { sector: 'AI', extra: { 获奖: 'AttraX 二等奖' } } } }, 1000);
    await importGraphSeed({ project: { name: '萤火虫 Firefly', facts: { stage: 'Pre-A', extra: { 团队: '4人' } } } }, 2000);
    const proj = (await db.projects.toArray())[0];
    expect(proj?.facts?.sector).toBe('AI');   // kept
    expect(proj?.facts?.stage).toBe('Pre-A'); // added
    expect(proj?.facts?.extra).toEqual({ 获奖: 'AttraX 二等奖', 团队: '4人' }); // deep-merged
  });

  it('matches an existing project by name (trim + case-insensitive), not duplicate', async () => {
    await db.projects.add({ id: 'pp', name: '萤火虫 Firefly', description: '', tags: [], createdAt: 1, updatedAt: 1, applicationCount: 0 });
    const r = await importGraphSeed({ project: { name: '  萤火虫 firefly  ', facts: { sector: 'AI' } } }, 1000);
    expect(r.projectCreated).toBe(false);
    expect(r.projectUpdated).toBe(true);
    expect(await db.projects.count()).toBe(1);
  });
});
