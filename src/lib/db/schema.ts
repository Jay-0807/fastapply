// Dexie database schema for ApplyForge.
// All data lives in IndexedDB. No backend involved.
// See ADR-003 for rationale on this storage choice.

import Dexie, { type Table } from 'dexie';
import type {
  Project,
  DocumentRecord,
  Chunk,
  EventContext,
  QARecord,
  AppSettings,
  ProjectAsset,
} from './types';

export class ApplyForgeDB extends Dexie {
  projects!: Table<Project, string>;
  documents!: Table<DocumentRecord, string>;
  chunks!: Table<Chunk, string>;
  eventContexts!: Table<EventContext, string>;
  qaRecords!: Table<QARecord, string>;
  appSettings!: Table<AppSettings, 'singleton'>;
  projectAssets!: Table<ProjectAsset, string>;

  constructor() {
    super('applyforge_v1');
    // v1 — original schema shipped in 0.1.0. Kept so existing installs migrate.
    this.version(1).stores({
      projects: 'id, name, createdAt',
      documents: 'id, projectId, parseStatus, createdAt',
      // Compound index speeds up the most common RAG query.
      // NB: boolean is NOT a valid IDB key, so excludedFromRag is excluded
      // from indexes and applied as an in-memory filter instead.
      chunks: 'id, projectId, sourceType, sourceId, [projectId+sourceType]',
      eventContexts: 'id, name, createdAt',
      qaRecords: 'id, projectId, eventContextId, status, submittedAt, createdAt',
      appSettings: 'id',
    });
    // v2 — popup sorts projects by updatedAt; that field needs an index.
    // Dexie merges the new index into the existing 'projects' store without
    // touching any other table.
    this.version(2).stores({
      projects: 'id, name, createdAt, updatedAt',
    });
    // v3 — auto-fill file fields. New table holds binary assets (project
    // photos, logos, pitch decks) that the matcher routes into <input
    // type=file> fields at fill time.
    this.version(3).stores({
      projectAssets: 'id, projectId, tag, [projectId+tag], createdAt',
    });
    // v4 — multi-provider support (V2.1 UX iteration).
    // Adds OpenAI-compatible protocol fields to appSettings so users can run
    // DeepSeek / Moonshot / GLM / Doubao / Qwen / OpenAI without forking the
    // codebase. Schema indices unchanged (appSettings is a singleton row);
    // the upgrade() backfills the new fields with sensible defaults so
    // existing Anthropic users continue working without re-onboarding.
    this.version(4).upgrade(async (tx) => {
      const settings = await tx.table('appSettings').get('singleton');
      if (!settings) return; // fresh install; the onboarding flow will populate everything
      await tx.table('appSettings').update('singleton', {
        encryptedOpenAICompatKey: settings.encryptedOpenAICompatKey ?? '',
        openaiCompatBaseUrl: settings.openaiCompatBaseUrl ?? '',
        // Existing users were all Anthropic — preserve that as default provider.
        defaultModelProvider: settings.defaultModelProvider ?? 'anthropic',
      });
    });
    // v5 — LLM configuration library (V2.2 UX iteration).
    // Folds the V2.1 "two key slots" model into a flexible llmConfigs[] array
    // where each entry is a complete bundle of (provider, model, key, baseURL).
    // Migration converts existing Anthropic + OpenAI-compat configs into list
    // entries automatically; the previously-active provider becomes isDefault.
    this.version(5).upgrade(async (tx) => {
      const settings = await tx.table('appSettings').get('singleton');
      if (!settings) return; // fresh install
      // Already migrated (e.g. clean install on v5) — skip
      if (Array.isArray(settings.llmConfigs)) return;

      const configs: {
        id: string;
        displayName: string;
        provider: 'anthropic' | 'openai-compatible';
        modelId: string;
        baseURL?: string;
        encryptedKey: string;
        isDefault: boolean;
        createdAt: number;
      }[] = [];
      const now = Date.now();
      const activeProvider = settings.defaultModelProvider ?? 'anthropic';
      const defaultModel = settings.defaultModel ?? 'claude-sonnet-4-6';

      if (settings.encryptedAnthropicKey) {
        configs.push({
          id: `cfg-anthropic-${now}`,
          displayName: 'Anthropic Claude',
          provider: 'anthropic',
          modelId: activeProvider === 'anthropic' ? defaultModel : 'claude-sonnet-4-6',
          encryptedKey: settings.encryptedAnthropicKey,
          isDefault: activeProvider === 'anthropic',
          createdAt: now,
        });
      }
      if (settings.encryptedOpenAICompatKey) {
        configs.push({
          id: `cfg-openai-compat-${now + 1}`,
          displayName: 'OpenAI-Compatible',
          provider: 'openai-compatible',
          modelId: activeProvider === 'openai-compatible' ? defaultModel : 'deepseek-chat',
          baseURL: settings.openaiCompatBaseUrl ?? '',
          encryptedKey: settings.encryptedOpenAICompatKey,
          isDefault: activeProvider === 'openai-compatible',
          createdAt: now + 1,
        });
      }
      // If neither was set (shouldn't happen for an existing install but
      // handle gracefully), we leave llmConfigs as an empty array — the
      // Settings UI will show the "add your first config" state.
      // Ensure exactly one config is default (or zero in the empty case).
      if (configs.length > 0 && !configs.some((c) => c.isDefault)) {
        configs[0]!.isDefault = true;
      }

      await tx.table('appSettings').update('singleton', { llmConfigs: configs });
    });
    // v6 — LLM semantic field extraction (V0.3.0, PRD §10).
    // Adds AppSettings.scanMode (the field-scan strategy switch). Backfills 'heuristic' so
    // existing installs keep their exact current behaviour — landing-path step 1 ships the new
    // path behind a default-off flag (BR1). appSettings is a singleton row, so no index change.
    this.version(6).upgrade(async (tx) => {
      const settings = await tx.table('appSettings').get('singleton');
      if (!settings) return; // fresh install — onboarding populates everything
      if (settings.scanMode) return; // already set (clean v6 install) — don't override
      await tx.table('appSettings').update('singleton', { scanMode: 'heuristic' });
    });
  }
}

// Singleton — import this everywhere instead of `new ApplyForgeDB()`.
export const db = new ApplyForgeDB();
