// R1 — DOM tagging engine (PRD §10 pipeline part 1).
// Walks the DOM (incl. shadow roots) and attaches a stable `data-af-id` to every
// candidate interactive control. This is the linchpin: the LLM only ever returns afIds,
// which map back to exact DOM nodes — solving "LLM describes a visual control but can't
// produce a writable selector" (failure mode F4).
//
// Idempotent / re-entrant (BR10): an element that already has a data-af-id is left alone,
// and new ids continue from the current max — so re-running on an unchanged DOM is a no-op.
//
// Visibility gate is DELIBERATELY lenient (tolerates opacity:0 and 0-size): the HiCool
// dogfood proved custom forms transparent-ize native radios (opacity:0) as the mainstream
// style, and the AX-tree / strict gates drop them (F10). We reject only truly-hidden
// (display:none / visibility:hidden / aria-hidden / disabled).

export const AF_ID_ATTR = 'data-af-id';

const CANDIDATE_SELECTOR = [
  'input',
  'select',
  'textarea',
  'button',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="button"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="combobox"]',
  '[role="textbox"]',
  '[role="switch"]',
  '[role="spinbutton"]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(',');

/** Lenient visibility: only reject definitively-hidden. Tolerates opacity:0 / 0-size (HiCool, F10). */
function isTaggable(el: HTMLElement): boolean {
  if ((el as HTMLInputElement).disabled) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    const body = el.ownerDocument?.body ?? null;
    let node: HTMLElement | null = el;
    let hops = 0;
    while (node && node !== body && hops < 12) {
      const st = window.getComputedStyle(node);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      node = node.parentElement;
      hops++;
    }
  }
  return true;
}

/**
 * Highest existing af-N index across the root INCLUDING shadow roots (so re-entry continues,
 * never renumbers, never collides). querySelectorAll does NOT pierce shadow DOM, so we must
 * recurse the same way `walk` does — otherwise a re-scan assigns a new light-DOM control an
 * index that already exists inside a shadow root (Code-GAN BUG 3).
 */
function nextIndex(root: Document | ShadowRoot): number {
  let max = -1;
  const scan = (r: Document | ShadowRoot): void => {
    r.querySelectorAll(`[${AF_ID_ATTR}]`).forEach((el) => {
      const m = /^af-(\d+)$/.exec(el.getAttribute(AF_ID_ATTR) ?? '');
      if (m?.[1]) max = Math.max(max, Number.parseInt(m[1], 10));
    });
    r.querySelectorAll<HTMLElement>('*').forEach((host) => {
      const sr = (host as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      if (sr) scan(sr);
    });
  };
  scan(root);
  return max + 1;
}

/**
 * Tag every visible candidate control under `root` with a `data-af-id`. Recurses open
 * shadow roots. Returns the number of NEW tags added (0 on an idempotent re-run).
 */
export function tagInteractiveControls(root: Document | ShadowRoot = document): number {
  let idx = nextIndex(root);
  let added = 0;

  const walk = (r: Document | ShadowRoot): void => {
    r.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR).forEach((el) => {
      if (el.hasAttribute(AF_ID_ATTR)) return;
      if (!isTaggable(el)) return;
      el.setAttribute(AF_ID_ATTR, `af-${idx}`);
      idx += 1;
      added += 1;
    });
    // Recurse into open shadow roots.
    r.querySelectorAll<HTMLElement>('*').forEach((host) => {
      const sr = (host as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      if (sr) walk(sr);
    });
  };

  walk(root);
  return added;
}
