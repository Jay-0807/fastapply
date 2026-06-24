// V0.4.0 knowledge graph — non-destructive seed import.
//
// Bulk-load a GraphSeed (project facts + person profiles, typically extracted
// from local files) into the graph WITHOUT clearing anything — unlike the full
// backup restore which is destructive. Safe to re-run:
//   - Project: matched by name (trimmed, case-insensitive). Existing → merge
//     facts (incoming wins per-key) + fill empty description. Absent → created.
//   - Persons: deduped by displayName (trimmed). Existing → merge fields
//     (incoming wins per-key), fill role/notes if empty. Absent → created.
//   - Seed persons are linked to the seed project (memberIds union).

import { db } from '@/lib/db/schema';
import type { GraphSeed, Project, Person, ProjectFacts } from '@/lib/db/types';
import { v4 as uuid } from 'uuid';

export interface SeedImportResult {
  projectCreated: boolean;
  projectUpdated: boolean;
  personsCreated: number;
  personsUpdated: number;
}

export async function importGraphSeed(seed: GraphSeed, now: number = Date.now()): Promise<SeedImportResult> {
  let projectId: string | undefined;
  let projectCreated = false;
  let projectUpdated = false;

  const seedProject = seed.project;
  if (seedProject && seedProject.name.trim()) {
    const name = seedProject.name.trim();
    const existing = (await db.projects.toArray()).find(
      (p) => p.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      projectId = existing.id;
      const patch: Partial<Project> = { updatedAt: now };
      if (seedProject.facts) {
        patch.facts = mergeFacts(existing.facts, seedProject.facts);
      }
      if (seedProject.description && !existing.description.trim()) {
        patch.description = seedProject.description;
      }
      await db.projects.update(existing.id, patch);
      projectUpdated = true;
    } else {
      projectId = uuid();
      const proj: Project = {
        id: projectId,
        name,
        description: seedProject.description ?? '',
        tags: [],
        createdAt: now,
        updatedAt: now,
        applicationCount: 0,
        facts: seedProject.facts ?? {},
        memberIds: [],
      };
      await db.projects.add(proj);
      projectCreated = true;
    }
  }

  let personsCreated = 0;
  let personsUpdated = 0;
  const touchedPersonIds: string[] = [];
  const existingPersons = await db.persons.toArray();

  for (const sp of seed.persons ?? []) {
    const displayName = sp.displayName.trim();
    if (!displayName) continue;
    const match = existingPersons.find((p) => p.displayName.trim() === displayName);
    if (match) {
      await db.persons.update(match.id, {
        fields: { ...match.fields, ...(sp.fields ?? {}) },
        role: sp.role?.trim() || match.role,
        notes: sp.notes?.trim() || match.notes,
        updatedAt: now,
      });
      personsUpdated++;
      touchedPersonIds.push(match.id);
    } else {
      const person: Person = {
        id: uuid(),
        displayName,
        role: sp.role?.trim() ?? '',
        fields: sp.fields ?? {},
        notes: sp.notes?.trim() ?? '',
        createdAt: now,
        updatedAt: now,
      };
      await db.persons.add(person);
      existingPersons.push(person); // so duplicate displayNames within one seed dedupe too
      personsCreated++;
      touchedPersonIds.push(person.id);
    }
  }

  // Link the imported people to the project (union, no dupes).
  if (projectId && touchedPersonIds.length) {
    const proj = await db.projects.get(projectId);
    if (proj) {
      const memberIds = [...new Set([...(proj.memberIds ?? []), ...touchedPersonIds])];
      await db.projects.update(projectId, { memberIds });
    }
  }

  return { projectCreated, projectUpdated, personsCreated, personsUpdated };
}

function mergeFacts(existing: ProjectFacts | undefined, incoming: ProjectFacts): ProjectFacts {
  const base = existing ?? {};
  const merged: ProjectFacts = { ...base, ...incoming };
  // Deep-merge the free-form `extra` map so an import doesn't drop prior extras.
  if (base.extra || incoming.extra) {
    merged.extra = { ...(base.extra ?? {}), ...(incoming.extra ?? {}) };
  }
  return merged;
}
