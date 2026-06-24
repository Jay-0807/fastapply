// V0.4.0 knowledge graph — personal-field resolution.
//
// Maps a detected `sensitiveKind:'personal'` field to a Person profile key, and
// resolves the real value to auto-fill from the selected people.
//
// PRIVACY CONTRACT (decision 2026-06-24, supersedes the blanket G5 skip):
//   - We ONLY fill a personal field from a value the user explicitly stored on a
//     Person profile. We NEVER ask the LLM to write personal info.
//   - OTP / captcha (`sensitiveKind:'otp'`) is NEVER resolved here — it stays
//     skipped forever (one-time codes can't be reused).
//   - If no stored value matches, we resolve to nothing → the field stays
//     "请你自己填" exactly as before. No fabrication, no guessing.
//
// Pure functions only (no Dexie / DOM import).

import type { DetectedField, Person, PersonFieldKey } from '@/lib/db/types';

/**
 * Ordered label → key rules. Order matters: more specific / less ambiguous
 * families first (email before name, phone before generic). A field reaches
 * this map ONLY after the scanner already classified it `sensitiveKind:'personal'`,
 * so we don't have to defend against "公司名称" etc. — those never get flagged.
 */
const PERSON_FIELD_RULES: { key: PersonFieldKey; re: RegExp }[] = [
  { key: 'email', re: /邮箱|电子邮件|e-?mail/i },
  { key: 'wechat', re: /微信|wechat/i },
  { key: 'qq', re: /\bqq\b|qq\s*号/i },
  { key: 'idNumber', re: /身份证|证件号|证件号码|护照|passport|id\s*(card|number|no)/i },
  { key: 'phone', re: /手机|电话|联系电话|手机号|联系方式|tel\b|phone|mobile|cell/i },
  { key: 'title', re: /职位|职务|头衔|title|position|job\s*title/i },
  { key: 'organization', re: /单位|所在公司|工作单位|company\s*name|organi[sz]ation|employer/i },
  { key: 'address', re: /住址|联系地址|通讯地址|地址|address/i },
  { key: 'bio', re: /个人简介|个人介绍|本人简介|个人经历|\bbio\b|biography|about\s*you/i },
  // name LAST — "name" is the broadest latin token; let specific families win.
  { key: 'name', re: /姓名|联系人|您的称呼|full\s*name|your\s*name|\bname\b/i },
];

/**
 * Resolve which Person profile key a personal field is asking for.
 * Returns undefined if it doesn't match any known family (then we don't autofill).
 */
export function mapLabelToPersonFieldKey(label: string, placeholder = ''): PersonFieldKey | undefined {
  const hay = `${label} ${placeholder}`;
  for (const rule of PERSON_FIELD_RULES) {
    if (rule.re.test(hay)) return rule.key;
  }
  return undefined;
}

export interface PersonalFillResolution {
  fieldId: string;
  key: PersonFieldKey;
  value: string;
  personId: string;
  personName: string;
}

/**
 * Given the personal fields on a form and the people selected for this
 * application, work out which fields we can auto-fill with real stored values.
 *
 * Resolution policy (MVP — honest boundary): the `primaryPersonId` (the main
 * applicant / contact picked in the sidepanel) is preferred for every personal
 * field; if they don't have that key stored, we fall back to the first other
 * selected person who does. Per-field "which teammate" mapping (e.g. "队员2手机")
 * is NOT attempted here — that's a future enhancement; unresolved fields simply
 * remain user-filled.
 *
 * @returns one resolution per field we CAN fill; fields we can't are omitted.
 */
export function resolvePersonalFills(
  fields: DetectedField[],
  persons: Person[],
  primaryPersonId?: string,
): PersonalFillResolution[] {
  if (!persons.length) return [];
  const ordered = orderByPrimary(persons, primaryPersonId);
  const out: PersonalFillResolution[] = [];

  for (const f of fields) {
    // Only personal fields. OTP and everything else is never touched here.
    if (f.constraints.sensitiveKind !== 'personal') continue;
    const key = mapLabelToPersonFieldKey(f.label, f.constraints.placeholder ?? '');
    if (!key) continue;
    const hit = ordered.find((p) => typeof p.fields[key] === 'string' && p.fields[key]!.trim() !== '');
    if (!hit) continue;
    out.push({
      fieldId: f.fieldId,
      key,
      value: hit.fields[key]!.trim(),
      personId: hit.id,
      personName: hit.displayName,
    });
  }
  return out;
}

function orderByPrimary(persons: Person[], primaryPersonId?: string): Person[] {
  if (!primaryPersonId) return persons;
  const primary = persons.filter((p) => p.id === primaryPersonId);
  const rest = persons.filter((p) => p.id !== primaryPersonId);
  return [...primary, ...rest];
}
