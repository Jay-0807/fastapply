// Shared types for the LLM semantic field-extraction hybrid pipeline (PRD §10).
// See docs/plans/2026-06-08-llm-semantic-field-extraction-design.md §8 + api.md §1.
// Keep framework-agnostic so content-script, service-worker and tests can all import it.

import type { DetectedField, FieldType, ScanMode } from '@/lib/db/types';

export type { ScanMode };

/**
 * R2 distillation output: one slim record per tagged interactive control.
 * ONLY visible controls; NEVER includes raw HTML (BR9) or the user's already-filled
 * input value (BR12, privacy). `domConstraints` are read straight from the DOM and are
 * the authoritative truth for hard constraints (BR3) — the LLM's guesses never override them.
 */
export interface ControlManifestEntry {
  /** Stable id the tagger attached to the live element as `data-af-id`. e.g. 'af-0'. */
  afId: string;
  /** Lowercased tag name: 'input' | 'select' | 'textarea' | 'button' | 'div' | ... */
  tag: string;
  /** For <input>: its `type` attribute ('text' | 'radio' | 'checkbox' | 'file' | ...). */
  inputType?: string;
  /** ARIA role if present. */
  role?: string;
  /** placeholder attribute (NOT the filled value). */
  placeholder?: string;
  /** Visible label-ish text near the control. Truncated to ≤120 chars to bound payload size. */
  nearbyText: string;
  /** Signature of the nearest row/fieldset container — a grouping hint for the LLM. */
  groupHint?: string;
  /** DOM-derived hard constraints — authoritative (BR3). */
  domConstraints: {
    maxLength?: number;
    required?: boolean;
    options?: string[];
    accept?: string;
    pattern?: string;
  };
}

/**
 * R3 LLM extraction output: one human-perceived field. A field may merge MORE than one
 * control (e.g. phone = country-code select + number input → two afIds). The LLM supplies
 * label / type / sensitivity; DOM hard constraints come from the manifest, not from here.
 */
export interface LlmExtractedField {
  /** One or more control afIds composing this field. The first is the primary (write target). */
  afIds: string[];
  label: string;
  type: FieldType;
  /** 'otp' = one-time/verification code; 'personal' = the user's own identity; null/absent = neither. */
  sensitive?: 'otp' | 'personal' | null;
}

/** R5 orchestration output: the final fields plus recall / fallback metadata (drives the UI). */
export interface ScanResult {
  /** Same shape the heuristic scanner produces — downstream (draft/fill/UI) is unchanged. */
  fields: DetectedField[];
  meta: ScanResultMeta;
}

export interface ScanResultMeta {
  /** The mode actually executed (may differ from the requested mode after a fallback). */
  mode: ScanMode;
  heuristicCount: number;
  /** Present in hybrid/llm. */
  llmCount?: number;
  mergedCount: number;
  /** True when the LLM pass failed and we fell back to heuristic results (BR7) — never white-screens. */
  llmFallback?: boolean;
  /** Reason for the fallback (shown to the user + retry). */
  llmError?: string;
  /** True when the result came from the scan cache (no LLM call this time). */
  cacheHit?: boolean;
}

/**
 * Lightweight identity captured for each afId at scan time, stashed on the page window so the
 * fill pass can verify the `[data-af-id]` selector still points at the SAME control before
 * writing — guards against React re-rendering reassigning ids and a silent mis-fill (BR13).
 */
export interface AfIdMeta {
  tag: string;
  label: string;
}
