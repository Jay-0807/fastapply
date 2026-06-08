import { describe, it, expect, beforeEach } from 'vitest';
import { tagInteractiveControls } from './tagger';
import { distillManifest } from './distill';

describe('distill', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('emits one queryable manifest entry per tagged control with DOM constraints', () => {
    document.body.innerHTML = '<label for="n">姓名</label><input id="n" maxlength="20" required>';
    tagInteractiveControls(document);
    const m = distillManifest(document);
    expect(m.length).toBe(1);
    expect(document.querySelector(`[data-af-id="${m[0]!.afId}"]`)).not.toBeNull();
    expect(m[0]!.nearbyText).toContain('姓名');
    expect(m[0]!.domConstraints.maxLength).toBe(20);
    expect(m[0]!.domConstraints.required).toBe(true);
  });

  it('captures <select> options as DOM-truth constraints', () => {
    document.body.innerHTML = '<select><option>A 赛道</option><option>B 赛道</option></select>';
    tagInteractiveControls(document);
    const m = distillManifest(document);
    expect(m[0]!.domConstraints.options).toEqual(['A 赛道', 'B 赛道']);
  });

  it('NEVER includes the user\'s already-filled input value (BR12 privacy / F7)', () => {
    document.body.innerHTML = '<label for="p">手机</label><input id="p" value="13800001111" placeholder="请输入手机号">';
    tagInteractiveControls(document);
    const m = distillManifest(document);
    const blob = JSON.stringify(m);
    expect(blob).not.toContain('13800001111'); // value excluded
    expect(m[0]!.placeholder).toBe('请输入手机号'); // placeholder still sent
  });

  it('truncates nearbyText to ≤120 chars', () => {
    const long = 'x'.repeat(300);
    document.body.innerHTML = `<label for="l">${long}</label><input id="l">`;
    tagInteractiveControls(document);
    const m = distillManifest(document);
    expect(m[0]!.nearbyText.length).toBeLessThanOrEqual(120);
  });

  it('records inputType and accept for file controls', () => {
    document.body.innerHTML = '<label for="f">商业计划书</label><input id="f" type="file" accept=".pdf">';
    tagInteractiveControls(document);
    const m = distillManifest(document);
    expect(m[0]!.inputType).toBe('file');
    expect(m[0]!.domConstraints.accept).toBe('.pdf');
  });

  it('does NOT leak an adjacent contenteditable\'s typed content into a sibling field (BUG 4 / BR12)', () => {
    document.body.innerHTML =
      '<div class="row"><div contenteditable="true">PII_AAA_111</div><div contenteditable="true">PII_BBB_222</div></div>';
    tagInteractiveControls(document);
    const blob = JSON.stringify(distillManifest(document));
    expect(blob).not.toContain('PII_AAA_111');
    expect(blob).not.toContain('PII_BBB_222');
  });
});
