import { describe, it, expect, beforeEach } from 'vitest';
import { tagInteractiveControls, AF_ID_ATTR } from './tagger';

describe('tagger', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('tags input / select / textarea / button with data-af-id', () => {
    document.body.innerHTML =
      '<input type="text"><select><option>a</option></select><textarea></textarea><button>X</button>';
    const added = tagInteractiveControls(document);
    expect(added).toBe(4);
    expect(document.querySelectorAll(`[${AF_ID_ATTR}]`).length).toBe(4);
  });

  it('is idempotent — re-running adds nothing and keeps ids stable (BR10)', () => {
    document.body.innerHTML = '<input><input>';
    const added1 = tagInteractiveControls(document);
    const ids1 = Array.from(document.querySelectorAll(`[${AF_ID_ATTR}]`)).map((e) => e.getAttribute(AF_ID_ATTR));
    const added2 = tagInteractiveControls(document);
    const ids2 = Array.from(document.querySelectorAll(`[${AF_ID_ATTR}]`)).map((e) => e.getAttribute(AF_ID_ATTR));
    expect(added1).toBe(2);
    expect(added2).toBe(0);
    expect(ids2).toEqual(ids1);
  });

  it('continues numbering for controls added after the first pass', () => {
    document.body.innerHTML = '<input>';
    tagInteractiveControls(document);
    document.body.insertAdjacentHTML('beforeend', '<input>');
    tagInteractiveControls(document);
    const ids = Array.from(document.querySelectorAll(`[${AF_ID_ATTR}]`)).map((e) => e.getAttribute(AF_ID_ATTR));
    expect(ids).toEqual(['af-0', 'af-1']);
  });

  it('tags opacity:0 native inputs and styled buttons (HiCool F10), but skips aria-hidden', () => {
    document.body.innerHTML =
      '<input class="op" style="opacity:0"><button role="radio">Yes</button>' +
      '<div aria-hidden="true"><input class="hidden"></div>';
    tagInteractiveControls(document);
    expect(document.querySelector('.op')?.hasAttribute(AF_ID_ATTR)).toBe(true);
    expect(document.querySelector('button')?.hasAttribute(AF_ID_ATTR)).toBe(true);
    expect(document.querySelector('.hidden')?.hasAttribute(AF_ID_ATTR)).toBe(false);
  });

  it('skips disabled controls', () => {
    document.body.innerHTML = '<input disabled><input>';
    tagInteractiveControls(document);
    expect(document.querySelectorAll(`[${AF_ID_ATTR}]`).length).toBe(1);
  });

  it('does NOT collide light-DOM ids with shadow-DOM ids on re-scan (BUG 3)', () => {
    document.body.innerHTML = '<input class="a"><div id="host"></div>';
    const sr = document.getElementById('host')!.attachShadow({ mode: 'open' });
    sr.innerHTML = '<input class="b"><input class="c">';
    tagInteractiveControls(document); // light .a + shadow .b/.c
    document.body.insertAdjacentHTML('beforeend', '<input class="d">');
    tagInteractiveControls(document); // re-scan: must continue past the shadow indices
    const ids = [
      document.querySelector('.a')!.getAttribute(AF_ID_ATTR),
      sr.querySelector('.b')!.getAttribute(AF_ID_ATTR),
      sr.querySelector('.c')!.getAttribute(AF_ID_ATTR),
      document.querySelector('.d')!.getAttribute(AF_ID_ATTR),
    ];
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(4); // all unique — no af-1 collision
  });
});
