// Typed message bus between UI surfaces (popup / sidepanel / options / content)
// and the background service worker. All cross-context calls go through this.

import type { DetectedField, EventContext, Project, QARecord, AppSettings, LLMProviderType, ScanMode } from '@/lib/db/types';

export type Message =
  | { type: 'projects.list' }
  | { type: 'projects.create'; payload: { name: string; description: string; tags: string[] } }
  | { type: 'projects.update'; payload: { id: string; patch: Partial<Project> } }
  | { type: 'projects.delete'; payload: { id: string } }
  // Parsing happens in the UI context (options/popup) — see ADR note in
  // background.ts uploadDocument. We only ship plain text + size to the worker
  // because chrome.runtime.sendMessage drops typed-array payloads.
  | { type: 'documents.upload'; payload: { projectId: string; filename: string; mimeType: string; sizeBytes: number; text: string } }
  | { type: 'documents.list'; payload: { projectId: string } }
  | { type: 'documents.delete'; payload: { id: string } }
  | { type: 'documents.reindex'; payload: { id: string } }
  | { type: 'assets.upload'; payload: { projectId: string; filename: string; mimeType: string; sizeBytes: number; tag: 'photo' | 'logo' | 'pitch'; notes?: string; bytes: ArrayBuffer } }
  | { type: 'assets.list'; payload: { projectId: string } }
  | { type: 'assets.delete'; payload: { id: string } }
  | { type: 'assets.matchToFields'; payload: { projectId: string; fields: { fieldId: string; label: string; accept: string }[] } }
  | { type: 'assets.getBinary'; payload: { id: string } }
  | { type: 'events.detectFromPage'; payload: { tabId: number } }
  | { type: 'events.save'; payload: { eventContext: EventContext } }
  // V0.3.0 (PRD §10): `mode` selects the scan strategy. Omitted → background reads
  // AppSettings.scanMode (defaults 'heuristic'). Response is a ScanResult (fields + meta).
  | { type: 'fields.scan'; payload: { tabId: number; mode?: ScanMode } }
  | {
      type: 'draft.generateOne';
      payload: {
        projectId: string;
        eventContextId: string;
        field: DetectedField;
        /**
         * V2.2: which LLM config to use. Required from V2.2 onwards. The
         * legacy `model` + `provider` fields below are kept for back-compat
         * with messages already in flight from older sidepanel builds.
         */
        configId?: string;
        /** @deprecated V2.2: use configId instead. */
        model?: string;
        /** @deprecated V2.2: use configId instead. */
        provider?: LLMProviderType;
        /** UX iteration 2026-06-01: optional user steering for a regenerate ("更简短" / "make it punchier"). */
        refinement?: string;
        streamId: string;
      };
    }
  | {
      // UX iteration 2026-05-24 (D): Batch generation.
      type: 'draft.generateBatch';
      payload: {
        projectId: string;
        eventContextId: string;
        fields: DetectedField[];
        /** V2.2: which LLM config to use. Required from V2.2 onwards. */
        configId?: string;
        /** @deprecated V2.2: use configId instead. */
        model?: string;
        /** @deprecated V2.2: use configId instead. */
        provider?: LLMProviderType;
        /** Batch-level streamId for tracking the call itself; per-field events use field.fieldId. */
        streamId: string;
      };
    }
  // ===== V2.2: LLM configuration library CRUD =====
  | {
      /** Add a new LLM config. Server encrypts the plainKey, assigns a uuid, optionally marks as default. */
      type: 'llmConfig.add';
      payload: {
        displayName: string;
        provider: LLMProviderType;
        modelId: string;
        baseURL?: string;
        /** Plaintext API key — encrypted server-side. */
        plainKey: string;
        /** Required to derive the encryption key (or to verify if session is already unlocked). */
        masterPassword: string;
        /** If true (default), make this the active config after adding. */
        setAsDefault?: boolean;
      };
    }
  | {
      /** Delete a config by id. If it was the default, promotes another (or none if list empty). */
      type: 'llmConfig.delete';
      payload: { id: string };
    }
  | {
      /** Switch which config is the active default. */
      type: 'llmConfig.setActive';
      payload: { id: string };
    }
  | { type: 'fields.fillPage'; payload: { tabId: number; fillMap: Record<string, string>; fileMap?: Record<string, string> } }
  | {
      type: 'qaRecord.upsertDraft';
      payload: { qaRecord: QARecord };
    }
  | { type: 'qaRecord.markSubmitted'; payload: { qaRecordId: string } }
  | { type: 'qa.toggleExclusion'; payload: { qaRecordId: string; fieldId: string; excluded: boolean } }
  | { type: 'settings.get' }
  | { type: 'settings.unlock'; payload: { masterPassword: string } }
  | { type: 'settings.lock' }
  | { type: 'settings.save'; payload: { patch: Partial<AppSettings>; plainKeys?: { anthropic?: string; openai?: string; openaiCompat?: string; masterPassword?: string } } }
  | { type: 'backup.export' }
  | { type: 'backup.import'; payload: { jsonText: string } }
  | { type: 'qaRecord.delete'; payload: { id: string } };

export type MessageType = Message['type'];

// Streaming events flow background → UI via chrome.runtime.sendMessage with a streamId.
export type StreamingEvent =
  | { kind: 'draft.token'; streamId: string; token: string }
  | { kind: 'draft.done'; streamId: string; text: string; modelUsed: string; retried: boolean; ragRefs: { chunkIds: string[]; similarities: number[] } }
  | { kind: 'draft.error'; streamId: string; message: string }
  | { kind: 'documents.parseProgress'; documentId: string; progress: number };
