// Project-level data operations that must touch several tables atomically.
// Kept here (not inline in the background router) so the cascade is unit-testable
// in isolation — deleting a project is irreversible, so "leaves no orphans" is a
// load-bearing invariant worth a regression test.

import { db } from '@/lib/db/schema';

export interface ProjectDeletionImpact {
  documents: number;
  chunks: number;
  qaRecords: number;
  assets: number;
}

/** How much a cascade delete will remove — drives the informed confirm dialog. */
export async function projectDeletionImpact(projectId: string): Promise<ProjectDeletionImpact> {
  const [documents, chunks, qaRecords, assets] = await Promise.all([
    db.documents.where('projectId').equals(projectId).count(),
    db.chunks.where('projectId').equals(projectId).count(),
    db.qaRecords.where('projectId').equals(projectId).count(),
    db.projectAssets.where('projectId').equals(projectId).count(),
  ]);
  return { documents, chunks, qaRecords, assets };
}

/**
 * Delete a project and EVERYTHING it owns, atomically (one rw transaction):
 * its chunks (document + qa), documents, qaRecords, and projectAssets.
 *
 * Persons are deliberately NOT deleted — V0.4.0 they're shared across projects,
 * so a person stays in the graph and simply loses this project from membership
 * (membership lives on the now-deleted Project.memberIds, so nothing to clean).
 * Other projects are untouched.
 */
export async function deleteProjectCascade(projectId: string): Promise<void> {
  await db.transaction('rw', [db.projects, db.documents, db.chunks, db.qaRecords, db.projectAssets], async () => {
    await db.chunks.where('projectId').equals(projectId).delete();
    await db.documents.where('projectId').equals(projectId).delete();
    await db.qaRecords.where('projectId').equals(projectId).delete();
    await db.projectAssets.where('projectId').equals(projectId).delete();
    await db.projects.delete(projectId);
  });
}
