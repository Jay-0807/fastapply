import { describe, expect, it } from 'vitest';
import { mapLabelToPersonFieldKey, resolvePersonalFills } from './person-fields';
import type { DetectedField, Person } from '@/lib/db/types';

function field(label: string, sensitiveKind: 'personal' | 'otp' | undefined): DetectedField {
  return {
    fieldId: label,
    domSelector: `#${label}`,
    label,
    type: 'text',
    constraints: sensitiveKind ? { noAiFill: true, sensitiveKind } : {},
    rawElementInfo: { tagName: 'input', classes: [] },
  };
}

function person(id: string, fields: Person['fields']): Person {
  return { id, displayName: id, role: '', fields, notes: '', createdAt: 0, updatedAt: 0 };
}

describe('mapLabelToPersonFieldKey', () => {
  it('maps common personal labels to canonical keys', () => {
    expect(mapLabelToPersonFieldKey('姓名')).toBe('name');
    expect(mapLabelToPersonFieldKey('联系人')).toBe('name');
    expect(mapLabelToPersonFieldKey('手机号')).toBe('phone');
    expect(mapLabelToPersonFieldKey('联系电话')).toBe('phone');
    expect(mapLabelToPersonFieldKey('电子邮箱')).toBe('email');
    expect(mapLabelToPersonFieldKey('微信')).toBe('wechat');
    expect(mapLabelToPersonFieldKey('身份证号')).toBe('idNumber');
  });

  it('lets email win over name when both could match (e-mail)', () => {
    expect(mapLabelToPersonFieldKey('Email')).toBe('email');
  });

  it('returns undefined for unknown labels', () => {
    expect(mapLabelToPersonFieldKey('项目预算')).toBeUndefined();
  });
});

describe('resolvePersonalFills', () => {
  const zhang = person('z', { name: '张三', phone: '13800000000', email: 'z@x.com' });
  const li = person('l', { name: '李四', wechat: 'li_wx' });

  it('fills personal fields from the primary person', () => {
    const fields = [field('姓名', 'personal'), field('联系电话', 'personal')];
    const res = resolvePersonalFills(fields, [zhang, li], 'z');
    expect(res).toHaveLength(2);
    expect(res.find((r) => r.fieldId === '姓名')?.value).toBe('张三');
    expect(res.find((r) => r.fieldId === '联系电话')?.value).toBe('13800000000');
  });

  it('falls back to another selected person when the primary lacks the key', () => {
    const fields = [field('微信号', 'personal')];
    const res = resolvePersonalFills(fields, [zhang, li], 'z'); // zhang has no wechat
    expect(res).toHaveLength(1);
    expect(res[0]?.value).toBe('li_wx');
    expect(res[0]?.personId).toBe('l');
  });

  it('omits fields no selected person can satisfy', () => {
    const fields = [field('身份证号', 'personal')];
    expect(resolvePersonalFills(fields, [zhang, li], 'z')).toHaveLength(0);
  });

  it('NEVER resolves OTP fields (one-time codes are not reusable)', () => {
    const fields = [field('短信验证码', 'otp')];
    expect(resolvePersonalFills(fields, [zhang, li], 'z')).toHaveLength(0);
  });

  it('ignores non-sensitive fields entirely', () => {
    const fields = [field('项目简介', undefined)];
    expect(resolvePersonalFills(fields, [zhang], 'z')).toHaveLength(0);
  });

  it('returns nothing when no people are selected (no fabrication)', () => {
    const fields = [field('姓名', 'personal')];
    expect(resolvePersonalFills(fields, [], undefined)).toHaveLength(0);
  });
});
