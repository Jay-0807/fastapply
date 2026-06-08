// Content script — injected into the report page.
// Exposes scanFields() and fillField() via a global, then returns the field list
// when invoked by chrome.scripting.executeScript.
//
// V0.3.0 (PRD §10): also exposes __applyforge_tag_distill__ for the hybrid/llm scan path
// (tags controls with data-af-id + distills a manifest), and records an afId→{tag,label}
// registry so the fill pass can verify a [data-af-id] selector still points at the same
// control before writing (BR13, guards React-rerender mis-fill).
//
// NB: only DOM-side semantic modules (tagger/distill/consistency) are imported here so the
// LLM SDKs never get bundled into the content script — the LLM call lives in the worker.

import { defineContentScript } from 'wxt/sandbox';
import { scanFields, fillField, fillFileField } from '@/lib/fields/field-scanner';
import { tagInteractiveControls } from '@/lib/fields/semantic/tagger';
import { distillManifest } from '@/lib/fields/semantic/distill';
import { isAfIdConsistent } from '@/lib/fields/semantic/consistency';
import type { ControlManifestEntry, AfIdMeta } from '@/lib/fields/semantic/types';
import type { DetectedField } from '@/lib/db/types';

const AF_ID_SELECTOR_RE = /\[data-af-id="(af-\d+)"\]/;

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    // Background calls executeScript({files: ['/content-scripts/content.js']})
    // and reads the return value of the LAST expression. We expose helpers on
    // window so that subsequent executeScript({func}) calls can target them.
    const win = window as unknown as {
      __applyforge_scan__: () => DetectedField[];
      __applyforge_tag_distill__: () => { manifest: ControlManifestEntry[]; heuristicFields: DetectedField[]; url: string };
      __applyforge_afid_meta__?: Record<string, AfIdMeta>;
      __applyforge_fill__: (map: Record<string, string>) => { filledCount: number; failedFields: string[] };
      __applyforge_fill_file__: (selector: string, bytes: ArrayBuffer, mimeType: string, filename: string) => boolean;
    };

    win.__applyforge_scan__ = () => scanFields();

    // V0.3.0: tag + distill for the hybrid/llm path. Also returns a fresh heuristic scan so the
    // orchestrator merges against the SAME DOM state the manifest was taken from.
    win.__applyforge_tag_distill__ = () => {
      tagInteractiveControls(document);
      const manifest = distillManifest(document);
      const meta: Record<string, AfIdMeta> = {};
      for (const m of manifest) meta[m.afId] = { tag: m.tag, label: m.nearbyText };
      win.__applyforge_afid_meta__ = meta;
      return { manifest, heuristicFields: scanFields(), url: location.href };
    };

    win.__applyforge_fill__ = (map) => {
      let filledCount = 0;
      const failedFields: string[] = [];
      const meta = win.__applyforge_afid_meta__ ?? {};
      for (const [selector, value] of Object.entries(map)) {
        // BR13: for an afId-based selector, verify the element still matches what we scanned.
        const afMatch = AF_ID_SELECTOR_RE.exec(selector);
        if (afMatch?.[1]) {
          const expected = meta[afMatch[1]];
          if (expected && !isAfIdConsistent(document.querySelector(selector), expected)) {
            failedFields.push(selector);
            continue;
          }
        }
        if (fillField(selector, value)) filledCount += 1;
        else failedFields.push(selector);
      }
      return { filledCount, failedFields };
    };

    win.__applyforge_fill_file__ = (selector, bytes, mimeType, filename) => {
      return fillFileField(selector, bytes, mimeType, filename);
    };

    // For executeScript({files:...}) the return value of the last statement is
    // sent back. Returning the scan result here means the first scan call is
    // a single round-trip.
    return win.__applyforge_scan__();
  },
});
