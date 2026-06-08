// R2 — control-list distillation (PRD §10 pipeline part 2).
// Turns each `data-af-id`-tagged control into a slim ControlManifestEntry. This is what
// gets sent to the LLM — NOT raw HTML (BR9) and NEVER the user's already-typed input value
// (BR12, privacy / failure mode F7). DOM-derived hard constraints (maxLength/options/accept/
// required/pattern) are captured here and are the authoritative truth downstream (BR3).

import { AF_ID_ATTR } from './tagger';
import type { ControlManifestEntry } from './types';

const NEARBY_MAX = 120;

function clip(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, NEARBY_MAX);
}

function cssEscapeId(id: string): string {
  // Minimal escape for use inside an attribute selector value.
  return id.replace(/["\\]/g, '\\$&');
}

/**
 * Pure label text of `container`: clone it, strip EVERY interactive descendant (inputs, buttons,
 * selects, contenteditable, already-tagged controls), then read what's left. This guarantees we
 * never echo ANY control's user-typed content into nearbyText — not just the current control's but
 * adjacent contenteditable siblings too (Code-GAN BUG 4 / BR12 privacy). `<input>`/`<textarea>`
 * `.value` is already absent from textContent; this also closes the contenteditable hole.
 */
function isInteractive(el: Element): boolean {
  return (
    /^(input|textarea|select|button)$/i.test(el.tagName) ||
    el.hasAttribute('contenteditable') ||
    el.hasAttribute(AF_ID_ATTR)
  );
}

function pureLabelText(container: Element): string {
  // Walk text nodes but DO NOT descend into interactive controls — collects only label text,
  // never any control's value/typed content (no cloning/removing → avoids happy-dom select quirks).
  let out = '';
  const walk = (node: Node): void => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        out += child.textContent ?? '';
      } else if (child.nodeType === 1 && !isInteractive(child as Element)) {
        walk(child);
      }
    });
  };
  walk(container);
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Best-effort visible label text near a control. Tries declarative hooks first
 * (aria-label / aria-labelledby / <label for> / ancestor <label>), then the nearest
 * container's text. NEVER reads input/textarea `.value` — input values aren't part of
 * textContent, so this is inherently free of already-filled PII (BR12).
 */
export function extractNearbyText(el: Element): string {
  const h = el as HTMLElement;

  const aria = h.getAttribute?.('aria-label');
  if (aria && aria.trim()) return clip(aria);

  const labelledby = h.getAttribute?.('aria-labelledby');
  if (labelledby && el.ownerDocument) {
    const txt = labelledby
      .split(/\s+/)
      .map((id) => el.ownerDocument!.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (txt) return clip(txt);
  }

  const id = (h as HTMLInputElement).id;
  if (id && el.ownerDocument) {
    const lbl = el.ownerDocument.querySelector(`label[for="${cssEscapeId(id)}"]`);
    if (lbl?.textContent?.trim()) return clip(lbl.textContent);
  }

  const closestLabel = h.closest?.('label');
  if (closestLabel) {
    const t = pureLabelText(closestLabel);
    if (t) return clip(t);
  }

  // Nearest ancestor (≤3 hops) carrying meaningful label text.
  let node: HTMLElement | null = h.parentElement;
  let depth = 0;
  while (node && depth < 3) {
    const t = pureLabelText(node);
    if (t.length >= 2) return clip(t);
    node = node.parentElement;
    depth += 1;
  }
  return '';
}

/** A short signature of the nearest grouping container — a hint for the LLM to merge controls. */
function groupHintFor(el: Element): string {
  const container = (el as HTMLElement).closest?.(
    'fieldset, [role="group"], [role="radiogroup"], li, tr, .form-row, .form-group, .t-row, .t-col',
  );
  if (!container) return '';
  const c = container as HTMLElement;
  const cls = (c.className && typeof c.className === 'string' ? c.className : '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
  return clip(`${c.tagName.toLowerCase()}${cls ? '.' + cls : ''}`);
}

function selectOptions(el: HTMLSelectElement): string[] {
  return Array.from(el.options)
    .map((o) => (o.textContent ?? '').trim())
    .filter((t) => t.length > 0);
}

function buildConstraints(el: HTMLElement): ControlManifestEntry['domConstraints'] {
  const dc: ControlManifestEntry['domConstraints'] = {};
  const input = el as HTMLInputElement & HTMLTextAreaElement;

  // maxLength: native attr is -1 when unset.
  if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && input.maxLength > 0) {
    dc.maxLength = input.maxLength;
  }
  // required
  if ((input.required ?? false) || el.getAttribute('aria-required') === 'true') {
    dc.required = true;
  }
  // options — only <select> here; radio/checkbox group options are reconstructed in R4 from the merged afIds.
  if (el instanceof HTMLSelectElement) {
    const opts = selectOptions(el);
    if (opts.length) dc.options = opts;
  }
  // accept (file)
  const accept = el.getAttribute('accept');
  if (accept) dc.accept = accept;
  // pattern
  const pattern = el.getAttribute('pattern');
  if (pattern) dc.pattern = pattern;

  return dc;
}

/** Produce the slim manifest for every tagged control under `root` (recurses shadow roots). */
export function distillManifest(root: Document | ShadowRoot = document): ControlManifestEntry[] {
  const out: ControlManifestEntry[] = [];

  const collect = (r: Document | ShadowRoot): void => {
    r.querySelectorAll<HTMLElement>(`[${AF_ID_ATTR}]`).forEach((el) => {
      const afId = el.getAttribute(AF_ID_ATTR);
      if (!afId) return;
      const tag = el.tagName.toLowerCase();
      const entry: ControlManifestEntry = {
        afId,
        tag,
        nearbyText: extractNearbyText(el),
        domConstraints: buildConstraints(el),
      };
      if (el instanceof HTMLInputElement && el.type) entry.inputType = el.type.toLowerCase();
      const role = el.getAttribute('role');
      if (role) entry.role = role;
      const ph = (el as HTMLInputElement).placeholder;
      if (ph) entry.placeholder = ph; // placeholder, NOT value (BR12)
      const gh = groupHintFor(el);
      if (gh) entry.groupHint = gh;
      out.push(entry);
    });
    r.querySelectorAll<HTMLElement>('*').forEach((host) => {
      const sr = (host as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      if (sr) collect(sr);
    });
  };

  collect(root);
  return out;
}
