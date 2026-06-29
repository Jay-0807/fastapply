import { describe, expect, it } from 'vitest';
import { extractMinLength, cleanDisplayLabel, readingOrder, composeGridLabels, type RectLike } from './field-normalize';

describe('extractMinLength', () => {
  it('parses 最少/至少/不少于 forms', () => {
    expect(extractMinLength('项目概要（最少200字，最多不超过1000字）')).toBe(200);
    expect(extractMinLength('至少 150 字')).toBe(150);
    expect(extractMinLength('不少于300个字')).toBe(300);
    expect(extractMinLength('500 字以上')).toBe(500);
  });
  it('parses English min forms', () => {
    expect(extractMinLength('at least 100 words')).toBe(100);
    expect(extractMinLength('minimum 50 characters')).toBe(50);
  });
  it('does not pick up a max-only hint', () => {
    expect(extractMinLength('最多不超过1000字')).toBeUndefined();
    expect(extractMinLength('200 字以内')).toBeUndefined();
  });
  it('returns undefined when absent', () => {
    expect(extractMinLength('项目名称')).toBeUndefined();
  });
});

describe('cleanDisplayLabel — main title only', () => {
  it('drops the absorbed placeholder (副标题) merged in via " - "', () => {
    expect(cleanDisplayLabel('项目概要 - 产品开发：生产策略、行业特点', '产品开发：生产策略、行业特点')).toBe('项目概要');
  });
  it('drops a 请输入 prefix AND the absorbed placeholder', () => {
    expect(cleanDisplayLabel('请输入项目概要 - 产品开发：生产策略', '产品开发：生产策略')).toBe('项目概要');
  });
  it('strips a trailing length parenthetical (already parsed into constraints)', () => {
    expect(cleanDisplayLabel('项目概要（最少200字，最多不超过1000字）')).toBe('项目概要');
    expect(cleanDisplayLabel('项目阶段（最多不超过100字）')).toBe('项目阶段');
  });
  it('keeps a non-length parenthetical', () => {
    expect(cleanDisplayLabel('竞争对手名称（可增加）')).toBe('竞争对手名称（可增加）');
  });
  it('does NOT mistake 字段/字条 for a length hint', () => {
    expect(cleanDisplayLabel('方案说明（见第3字段）')).toBe('方案说明（见第3字段）');
    expect(cleanDisplayLabel('补充（约500字数）')).toBe('补充'); // 字数 IS a length word
  });
  it('strips leading * and trailing colon', () => {
    expect(cleanDisplayLabel('* 类似技术研发机构：')).toBe('类似技术研发机构');
  });
  it('leaves a genuine compound label alone when no placeholder matches', () => {
    expect(cleanDisplayLabel('队员A - 职业/职称')).toBe('队员A - 职业/职称');
  });
  it('KEEPS a short genuine sub-label placeholder (出席项目队员 - 姓名)', () => {
    // "姓名" is a real sub-field label, not a content hint → compound stays.
    expect(cleanDisplayLabel('出席项目队员 - 姓名', '姓名')).toBe('出席项目队员 - 姓名');
    expect(cleanDisplayLabel('队员 - 职称', '职称')).toBe('队员 - 职称');
  });
  it('drops a generic "请输入内容" prompt placeholder and the 请输入 prefix', () => {
    expect(cleanDisplayLabel('请输入竞争优势 - 请输入内容', '请输入内容')).toBe('竞争优势');
  });
  it('never returns empty (falls back to the squashed original)', () => {
    expect(cleanDisplayLabel('请输入')).toBe('请输入');
  });
});

describe('readingOrder — visual top→bottom, left→right', () => {
  const R = (top: number, left: number, w = 100, h = 30): RectLike => ({ top, left, width: w, height: h });

  it('returns null when there is no layout (all zero-sized → DOM-order fallback)', () => {
    expect(readingOrder([{ top: 0, left: 0, width: 0, height: 0 }, { top: 0, left: 0, width: 0, height: 0 }])).toBeNull();
    expect(readingOrder([])).toBeNull();
  });

  it('orders two columns row by row, left then right', () => {
    // row1: A(left) B(right) ; row2: C(left) D(right) — DOM order was A,C,B,D.
    const rects = [R(0, 0), R(40, 0), R(0, 300), R(40, 300)]; // A, C, B, D
    expect(readingOrder(rects)).toEqual([0, 2, 1, 3]); // A, B, C, D
  });

  it('groups vertically-overlapping controls into the same row (sorted by left)', () => {
    // A tall textarea on the right overlaps a short label on the left.
    const label = R(10, 0, 80, 20);
    const textarea = R(0, 200, 300, 120);
    expect(readingOrder([textarea, label])).toEqual([1, 0]); // label (left) before textarea (right)
  });

  it('is stable for identical positions (preserves original index)', () => {
    expect(readingOrder([R(0, 0), R(0, 0), R(0, 0)])).toEqual([0, 1, 2]);
  });

  it('GAN-B: a no-box (hidden) field goes LAST in DOM order, never hoisted to top', () => {
    const hidden = { top: 0, left: 0, width: 0, height: 0 };
    // hidden field is DOM-first but must not jump ahead of the visible ones.
    expect(readingOrder([hidden, R(100, 0), R(140, 0)])).toEqual([1, 2, 0]);
    expect(readingOrder([R(100, 0), hidden, R(140, 0)])).toEqual([0, 2, 1]);
  });

  it('GAN-A: a tall control does not chain the next question-row into its band', () => {
    // Row1: label(left) + tall textarea(right). Row2: label + textarea, clearly
    // below. The 120px textarea must NOT swallow row2 via running max-bottom.
    const r1label = R(10, 0, 80, 20);
    const r1textarea = R(0, 200, 300, 120);
    const r2label = R(150, 0, 80, 20);
    const r2textarea = R(150, 200, 300, 40);
    // input order scrambled on purpose
    expect(readingOrder([r1textarea, r2textarea, r1label, r2label])).toEqual([2, 0, 3, 1]);
  });
});

describe('composeGridLabels — 财务预测 metric × year grid', () => {
  // 深创赛: 营业收入/营业成本 each repeat across 3 year columns (515/728/942).
  const headers = [
    { text: '2026年', left: 505 },
    { text: '2027年', left: 718 },
    { text: '2028年', left: 932 },
  ];
  it('pairs each repeated-row cell with its column header', () => {
    const cells = [
      { label: '营业收入', left: 515 }, { label: '营业收入', left: 728 }, { label: '营业收入', left: 942 },
      { label: '营业成本', left: 515 }, { label: '营业成本', left: 728 }, { label: '营业成本', left: 942 },
    ];
    expect(composeGridLabels(cells, headers)).toEqual([
      '营业收入（2026年）', '营业收入（2027年）', '营业收入（2028年）',
      '营业成本（2026年）', '营业成本（2027年）', '营业成本（2028年）',
    ]);
  });
  it('leaves a non-repeated label untouched (not a grid row)', () => {
    expect(composeGridLabels([{ label: '项目名称', left: 515 }], headers)).toEqual(['项目名称']);
  });
  it('leaves a label repeated at the SAME left untouched (a column, not a grid row needing headers)', () => {
    expect(composeGridLabels([{ label: '姓名', left: 515 }, { label: '姓名', left: 515 }], headers))
      .toEqual(['姓名', '姓名']);
  });
  it('keeps the label when no header aligns within tolerance', () => {
    const cells = [{ label: '净利润', left: 515 }, { label: '净利润', left: 9999 }];
    expect(composeGridLabels(cells, headers)).toEqual(['净利润（2026年）', '净利润']);
  });
  it('does NOT treat a long header-row string as a grid row (深创赛 诉讼表)', () => {
    // The 诉讼 table's "label" is the whole header row — a long string that must
    // not be composed (the real dogfood bug that mislabeled 营业收入 as 诉讼原因).
    const long = '法律风险类型 诉讼原因 诉讼内容 操作';
    const cells = [{ label: long, left: 301 }, { label: long, left: 515 }, { label: long, left: 764 }];
    expect(composeGridLabels(cells, headers)).toEqual([long, long, long]);
  });
});
