// R4 — afId backfill + hard-constraint validation (PRD §10 pipeline part 4).
// Maps each LLM-extracted field back to real DOM controls via afId and produces standard
// DetectedField[] (same shape the heuristic scanner emits → downstream draft/fill/UI unchanged).
//
// Guards (the reason the LLM path is trustworthy):
//   BR4  every afId must exist in the manifest, else the field is dropped (anti-hallucination, F1).
//   BR3  hard constraints (maxLength/options/required/pattern) come from the DOM manifest, NEVER the LLM (F5).
//   BR5  sensitive (otp/personal) → noAiFill so the AI never invents OTPs / personal identity.
//   BR11 domSelector is always `[data-af-id="…"]` (self-tagged, most stable).

import { detectSensitiveKind } from '@/lib/fields/field-scanner';
import type { DetectedField, FieldConstraints, FieldType } from '@/lib/db/types';
import type { ControlManifestEntry, LlmExtractedField } from './types';

const CHOICE_INPUT_TYPES = new Set(['radio', 'checkbox']);
const CHOICE_ROLES = new Set(['radio', 'checkbox', 'option']);

/** DOM-known control types win over the LLM's guess (BR3). */
function reconcileType(llmType: FieldType, primary: ControlManifestEntry): FieldType {
  if (primary.tag === 'select') return 'select';
  if (primary.tag === 'textarea') return 'textarea';
  const it = primary.inputType;
  if (it === 'file') return 'file';
  if (it === 'radio' || primary.role === 'radio') return 'radio';
  if (it === 'checkbox' || primary.role === 'checkbox') return 'checkbox';
  if (it === 'email') return 'email';
  if (it === 'tel') return 'tel';
  if (it === 'url') return 'url';
  if (it === 'number') return 'number';
  if (it === 'date') return 'date';
  return llmType || 'text';
}

/** Build constraints from DOM truth. Options for a select come from its <option>s; for a radio/
 * checkbox group they're reconstructed from the labels of the merged afIds (still DOM-derived). */
function buildConstraints(
  afIds: string[],
  byId: Map<string, ControlManifestEntry>,
  primary: ControlManifestEntry,
): FieldConstraints {
  const c: FieldConstraints = {};
  const dc = primary.domConstraints;
  if (dc.maxLength != null) c.maxLength = dc.maxLength;
  if (dc.required) c.required = true;
  if (dc.pattern) c.pattern = dc.pattern;
  if (primary.placeholder) c.placeholder = primary.placeholder;

  let options: string[] | undefined;
  if (dc.options?.length) {
    options = dc.options;
  } else if (
    (primary.inputType && CHOICE_INPUT_TYPES.has(primary.inputType)) ||
    (primary.role && CHOICE_ROLES.has(primary.role))
  ) {
    // Native radio/checkbox groups AND ARIA styled-div groups (role=radio/checkbox/option, no
    // native inputType) reconstruct their options from the merged afIds' labels (DOM-derived).
    const labels = afIds
      .map((id) => byId.get(id)?.nearbyText?.trim())
      .filter((t): t is string => !!t && t.length > 0);
    if (labels.length > 1) options = labels;
  }
  if (options?.length) c.options = options;
  return c;
}

/**
 * Convert validated LLM fields into DetectedField[]. Drops any field whose afIds are all absent
 * from the manifest (anti-hallucination). Pure function — no DOM / side effects (testable).
 */
export function backfillAndValidate(
  llmFields: LlmExtractedField[],
  manifest: ControlManifestEntry[],
): DetectedField[] {
  const byId = new Map(manifest.map((m) => [m.afId, m]));
  const out: DetectedField[] = [];

  for (const f of llmFields) {
    const validAfIds = f.afIds.filter((id) => byId.has(id)); // BR4
    if (validAfIds.length === 0) continue;
    const primaryId = validAfIds[0]!;
    const primary = byId.get(primaryId)!;

    const type = reconcileType(f.type, primary);
    const constraints = buildConstraints(validAfIds, byId, primary);

    // Sensitive: trust the LLM, but ALSO run the heuristic regex as belt-and-suspenders —
    // if either flags it, the AI must not fill it (BR5). detectSensitiveKind matches CJK by substring.
    const sensitive = f.sensitive ?? detectSensitiveKind(f.label, primary.placeholder ?? '');
    if (sensitive) {
      constraints.noAiFill = true;
      constraints.sensitiveKind = sensitive;
    }

    const domSelector = `[data-af-id="${primaryId}"]`; // BR11
    const field: DetectedField = {
      fieldId: `af-llm-${primaryId}`,
      domSelector,
      label: f.label || primary.nearbyText || primaryId,
      type,
      constraints,
      rawElementInfo: { tagName: primary.tag, classes: [] },
      provenance: {
        source: 'llm-semantic',
        selector: domSelector,
        visibilityState: 'visible',
        labelSource: 'llm-semantic',
        labelConfidence: 'inferred',
      },
    };
    out.push(field);
  }

  return out;
}
