import { describe, it, expect, beforeEach } from 'vitest';
import { isAfIdConsistent } from './consistency';

describe('isAfIdConsistent (BR13 anti-mis-fill guard)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('false when the element vanished (afId no longer resolves)', () => {
    expect(isAfIdConsistent(null, { tag: 'input', label: '姓名' })).toBe(false);
  });

  it('false when the tag at this afId is now different (control was replaced)', () => {
    document.body.innerHTML = '<select></select>';
    expect(isAfIdConsistent(document.querySelector('select'), { tag: 'input', label: '姓名' })).toBe(false);
  });

  it('true when tag matches and the label still overlaps', () => {
    document.body.innerHTML = '<label for="n">申请人姓名</label><input id="n">';
    expect(isAfIdConsistent(document.querySelector('input'), { tag: 'input', label: '姓名' })).toBe(true);
  });

  it('false when tag matches but the field is now a completely different one (React reorder)', () => {
    document.body.innerHTML = '<label for="n">上传文件</label><input id="n">';
    expect(isAfIdConsistent(document.querySelector('input'), { tag: 'input', label: '申请人姓名' })).toBe(false);
  });
});
