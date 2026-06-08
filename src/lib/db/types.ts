// Domain types — mirrors the schema in 05-schema-and-api.md
// Keep this file framework-agnostic so any UI or worker module can import it.

export interface Project {
  id: string;
  name: string;
  description: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  applicationCount: number;
}

export type ParseStatus = 'pending' | 'parsed' | 'failed';

export interface DocumentRecord {
  id: string;
  projectId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  rawText: string;
  parseStatus: ParseStatus;
  parseError: string | null;
  createdAt: number;
}

export type ChunkSourceType = 'document' | 'qa';

export interface Chunk {
  id: string;
  sourceType: ChunkSourceType;
  sourceId: string;
  projectId: string;
  text: string;
  embedding: Float32Array;
  embeddingModel: string;
  tokenCount: number;
  excludedFromRag: boolean;
  createdAt: number;
  metadata: Record<string, unknown>;
}

export interface EventContext {
  id: string;
  name: string;
  theme: string;
  organizer: string;
  location: string;
  url: string;
  deadline: string | null;
  extraNotes: string;
  pageMetaJson: Record<string, unknown>;
  createdAt: number;
}

export type FieldType = 'text' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'number' | 'email' | 'url' | 'tel' | 'date' | 'file' | 'unknown';

/**
 * V0.3.0 (2026-06-08, PRD §10): how the field scanner identifies fields.
 *   - 'heuristic' — the original hand-written CSS/DOM rules (default; ships unchanged behaviour)
 *   - 'hybrid'    — heuristic fast path + LLM semantic completeness pass, merged (the new recommended path)
 *   - 'llm'       — pure LLM semantic extraction (landing-path step 3 "main path", architecture-ready)
 * Stored on AppSettings.scanMode; missing reads as 'heuristic' (BR1).
 */
export type ScanMode = 'heuristic' | 'hybrid' | 'llm';

export interface FieldConstraints {
  maxLength?: number;
  minLength?: number;
  required?: boolean;
  pattern?: string;
  helperText?: string;
  placeholder?: string;
  options?: string[]; // for select/radio
  /**
   * UX iteration 2026-05-30: marks a `type:'file'` field as a CUSTOM JS
   * uploader with NO underlying <input type=file> — e.g. an <a>上传</a> that
   * opens the OS file dialog on click. These CANNOT be auto-filled (browser
   * security forbids programmatic OS-dialog file selection, and there's no
   * input to inject into). The sidepanel shows them as a "manual upload"
   * card with a matched-asset download button instead of auto-filling.
   */
  manualUploadOnly?: boolean;
  /**
   * UX iteration 2026-06-06 (HiCool dogfood): the field asks for something the
   * AI must NOT invent — a one-time SMS / verification code, or the user's own
   * personal-contact identity (name, phone, email, WeChat, ID number). The
   * generator SKIPS these (no draft, like file fields), and the sidepanel shows
   * a "fill this yourself" note. `sensitiveKind` drives the wording.
   */
  noAiFill?: boolean;
  sensitiveKind?: 'otp' | 'personal';
}

/**
 * Provenance — explains WHY a field was detected, so the user can debug
 * "why is this field here / why is that one missing" without remote debugging.
 *
 * Every DetectedField from the scanner should have one (added in UX
 * iteration 2026-05-23). Older QARecords saved before that change may have
 * `provenance: undefined`, which is fine — the UI gracefully hides the
 * explainer in that case.
 */
export interface DetectedFieldProvenance {
  /**
   * Where in the DOM model the field was found.
   * V0.3.0: 'llm-semantic' = identified by the LLM semantic pass; 'heuristic+llm' = both
   * heuristic and LLM detected it (consensus).
   */
  source: 'html-input' | 'aria-group' | 'shadow-dom' | 'drop-zone' | 'llm-semantic' | 'heuristic+llm';
  /** The selector we'll use to write back. Duplicated from DetectedField for self-containment. */
  selector: string;
  /** Visibility check result at scan time. `layout-zero-but-include` means we included it despite 0×0 bbox (file inputs etc.). */
  visibilityState: 'visible' | 'layout-zero-but-include' | 'hidden-skipped';
  /** Which DOM hook supplied the label string. V0.3.0: 'llm-semantic' = the LLM named the field. */
  labelSource: 'aria-label' | 'aria-labelledby' | 'parent-heading' | 'placeholder' | 'inferred' | 'label-tag' | 'sibling-text' | 'llm-semantic';
  /** How sure we are the label is right. `exact` = direct DOM attribute; `inferred` = heuristic; `fallback` = no good source, made one up. */
  labelConfidence: 'exact' | 'inferred' | 'fallback';
  /** If we detected a max-length constraint, which regex pattern caught it (for debugging missing/wrong limits). */
  maxLength?: { value: number; matchedPattern: string } | undefined;
  /** If we detected helper / hint text, where it came from (for debugging missed hints). */
  helperText?: { value: string; source: 'aria-describedby' | 'sibling-help' | 'small-tag' | 'muted-class' } | undefined;
}

export interface DetectedField {
  fieldId: string;
  domSelector: string; // unique CSS selector to write back
  label: string;
  type: FieldType;
  constraints: FieldConstraints;
  rawElementInfo: {
    tagName: string;
    id?: string | undefined;
    name?: string | undefined;
    classes: string[];
  };
  /** Audit trail for the UX FieldExplainer; optional for back-compat with older QARecords. */
  provenance?: DetectedFieldProvenance | undefined;
}

/**
 * Page extraction result — used by detectEventFromPage to surface "we're not
 * sure about this" to the UI so the user doesn't blindly trust hallucinations.
 * Added in UX iteration 2026-05-23 (see 05a-ux-design.md §A.2).
 */
export interface EventExtractionMeta {
  /** How confident Claude (or the meta-tag fallback) is in the extracted fields. */
  confidence: 'high' | 'medium' | 'low' | 'failed';
  /** Where the data came from — `claude` = Claude parsed the body text; `meta` = OG/title fallback; `title` = just the page title. */
  source: 'claude' | 'meta' | 'title';
  /** Per-field origin: 'extracted' (came from source), 'empty' (source didn't have it), 'guess' (source gave low-confidence). */
  fieldOrigins: Record<string, 'extracted' | 'empty' | 'guess'>;
}

export type UserAction = 'accepted' | 'edited_minor' | 'edited_major' | 'rewritten' | 'skipped';

export interface QAPair {
  fieldId: string;
  fieldLabel: string;
  fieldType: FieldType;
  fieldConstraints: FieldConstraints;
  aiDraft: string;
  /**
   * Wire-level Anthropic model ID actually used to generate this draft
   * (e.g. "claude-sonnet-4-5", "claude-opus-4-7"). Kept as a free-form string
   * so future model releases don't break our schema.
   */
  aiModel: string;
  finalValue: string;
  userAction: UserAction;
  ragReferences: {
    chunkIds: string[];
    similarities: number[];
  };
  generatedAt: number;
  retryCount: number;
}

export type QARecordStatus = 'in_progress' | 'submitted' | 'abandoned';

export interface QARecord {
  id: string;
  projectId: string;
  eventContextId: string;
  status: QARecordStatus;
  qaPairs: QAPair[];
  markdownPath: string | null;
  submittedAt: number | null;
  pageUrl: string;
  pageTitle: string;
  stats: {
    accepted: number;
    edited_minor: number;
    edited_major: number;
    rewritten: number;
    skipped: number;
  };
  createdAt: number;
}

/**
 * Tag categories for project assets. Picked by the user at upload time and
 * used by the asset-to-field matcher to find the right file for a given
 * upload field on a form. V1 supports just these three; we can extend to
 * video / resume / business-license in V1.1.
 */
export type AssetTag = 'photo' | 'logo' | 'pitch';

/**
 * A binary file the user uploads ONCE per project so the extension can later
 * auto-fill <input type="file"> fields with it. Stored in Dexie as a Blob —
 * IndexedDB handles binary natively, no base64 round-trips needed.
 *
 * Distinct from DocumentRecord (which stores text-extracted content for RAG):
 * an Asset keeps the original binary because we need to feed it back into
 * the form via DataTransfer at fill time.
 */
export interface ProjectAsset {
  id: string;
  projectId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** The actual file bytes. Stored as Blob — Dexie persists Blobs in IDB directly. */
  blob: Blob;
  /** Category for matching. */
  tag: AssetTag;
  /** Optional free-form note from the user (e.g. "v3 - 用于硬件加速器场景"). */
  notes?: string | undefined;
  createdAt: number;
}

/**
 * Which LLM protocol a model uses.
 *
 * UX iteration 2026-05-24 (V2.1): added 'openai-compatible' to support
 * DeepSeek / Moonshot / GLM / Doubao / Qwen / OpenAI itself — all of these
 * speak the same OpenAI chat-completions wire format, distinguished only
 * by baseURL + key.
 */
export type LLMProviderType = 'anthropic' | 'openai-compatible';

/**
 * V2.2 (2026-05-24): one entry in the user's LLM configuration library.
 *
 * Replaces the V2.1 "two key slots" model with a flexible list where each
 * entry bundles {provider, model, key, baseURL, displayName}. User can have
 * multiple configurations (e.g. "OpenAI gpt-4o-mini", "DeepSeek deepseek-chat",
 * "Anthropic claude-sonnet-4-6", "Moonshot Kimi") and switch between them.
 *
 * Exactly ONE config has `isDefault: true` (enforced at write time).
 * The sidepanel can temporarily use a different config via tabSession state,
 * without changing the global default.
 */
export interface LLMConfig {
  /** Stable uuid. Referenced from messages and sidepanel state. */
  id: string;
  /** Friendly name for the picker / list, e.g. "OpenAI · gpt-4o-mini" or "我的 DeepSeek". User-editable at creation. */
  displayName: string;
  /** Which wire protocol to use. */
  provider: LLMProviderType;
  /** Wire-level model ID, e.g. "gpt-4o-mini" or "claude-sonnet-4-6". */
  modelId: string;
  /** Required when provider='openai-compatible'. Empty/undefined otherwise. */
  baseURL?: string;
  /** Encrypted API key: "ciphertext::iv" (same scheme as legacy encryptedAnthropicKey). */
  encryptedKey: string;
  /** True for the currently-active config. Exactly one config should have this true (or zero, on a brand-new install). */
  isDefault: boolean;
  /** Set at creation; used for stable ordering in the list. */
  createdAt: number;
}

export interface AppSettings {
  id: 'singleton';

  // ===== V2.2 (current): LLM configuration library =====
  /**
   * List of configured LLM providers. Each is a complete bundle
   * (provider/model/key/baseURL) that the user added via Settings.
   * On migration from V2.1, existing Anthropic + OpenAI-compat keys are
   * automatically converted into entries here.
   */
  llmConfigs: LLMConfig[];

  /**
   * V0.3.0 (2026-06-08, PRD §10): which field-scan strategy to use. Missing /
   * undefined reads as 'heuristic' (the original behaviour) — schema v6
   * migration backfills it so existing installs are unaffected (BR1).
   */
  scanMode?: ScanMode;

  // ===== V2.1 deprecated fields (kept for migration / back-compat) =====
  /** @deprecated V2.2: superseded by llmConfigs entries. */
  encryptedAnthropicKey: string;
  /** @deprecated V2.2: superseded by llmConfigs entries. */
  encryptedOpenAICompatKey: string;
  /** @deprecated V2.2: now lives on each LLMConfig entry. */
  openaiCompatBaseUrl: string;

  // ===== Key derivation =====
  keyDerivationSalt: string;
  keyDerivationIterations: number;

  // ===== Default model selection — V2.2 mostly obsolete, kept for migration =====
  /** @deprecated V2.2: replaced by llmConfigs entry with isDefault=true. */
  defaultModel: string;
  /** @deprecated V2.2: replaced by llmConfigs entry with isDefault=true. */
  defaultModelProvider: LLMProviderType;
  /** @deprecated never actively wired post-V2.1. */
  fallbackModel?: string | null;

  // ===== Deprecated (kept for back-compat — schema migration would be churnier than ignoring) =====
  /** @deprecated V2.1: split into provider-specific fields. Always empty going forward. */
  encryptedOpenAIKey: string;
  /** @deprecated V2.1: hidden in UI per PM request. Schema kept to avoid migration of every row. */
  language: 'zh-CN' | 'en-US';
  /** @deprecated V2.1: hidden in UI per PM request. */
  theme: 'light' | 'dark' | 'auto';
  /** @deprecated never wired up in UI. */
  vaultDirectory: string | null;
  /** @deprecated V1 uses keyword overlap, not embeddings. */
  embeddingProvider: 'openai' | 'local';
  /** @deprecated V1 uses keyword overlap, not embeddings. */
  embeddingDimension: 1536 | 512;
}
