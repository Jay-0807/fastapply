// R3 — LLM semantic extraction (PRD §10 pipeline part 3).
// Sends the distilled control manifest to the LLM and gets back "fields a human would fill".
// Reuses the project's own callLLM dispatcher (provider routing + 429 backoff) — the same
// pattern detectEventFromPage already uses to send page text to the LLM (so no NEW "send page
// to LLM" posture is introduced; api.md §3).
//
// Output shape is `{ "fields": [ {afIds,label,type,sensitive} ] }` — a nested array, which the
// flat key→string parseBatchResponse can't model. We therefore parse with a dedicated tolerant
// reader that reuses the SAME escalation (strip ```json``` fence → slice braces → JSON.parse →
// escape raw control chars → parse). Field labels are short, so this is robust in practice.

import { callLLM } from '@/lib/claude/client';
import type { FieldType, LLMProviderType } from '@/lib/db/types';
import type { ControlManifestEntry, LlmExtractedField } from './types';

export interface SemanticLLMConfig {
  provider: LLMProviderType;
  apiKey: string;
  baseURL?: string;
  modelId: string;
}

const SYSTEM_PROMPT = `你是表单字段识别器。给定一个网页上"可交互控件"的精简清单，返回"一个真人会填写的字段"列表。
规则：
- 每个字段给出 afIds（数组，引用清单里出现的 afId；同一字段由多个控件组成时列多个，如"手机=区号 select + 号码 input"列两个 afId）、label（这个字段在问什么）、type、sensitive。
- 只使用清单中真实出现的 afId，绝不编造不存在的 id。
- 排除：提交/保存/取消/下一步/上一页等动作按钮、导航/页脚/工具栏控件、纯装饰或后端隐藏控件。
- type 取值只能是：text|textarea|select|checkbox|radio|number|email|url|tel|date|file|unknown。
- sensitive：otp（短信码/验证码/captcha）| personal（姓名/手机/邮箱/微信/身份证等本人身份信息）| null（都不是）。
- 不要解释，不要前后缀，直接输出 JSON。`;

const VALID_TYPES = new Set<FieldType>([
  'text', 'textarea', 'select', 'checkbox', 'radio', 'number', 'email', 'url', 'tel', 'date', 'file', 'unknown',
]);

function renderManifest(manifest: ControlManifestEntry[]): string {
  return manifest
    .map((m) => {
      const bits: string[] = [
        m.afId,
        `${m.tag}${m.inputType ? '/' + m.inputType : ''}${m.role ? ' role=' + m.role : ''}`,
      ];
      if (m.nearbyText) bits.push(`附近="${m.nearbyText}"`);
      if (m.placeholder) bits.push(`placeholder="${m.placeholder}"`);
      if (m.groupHint) bits.push(`组=${m.groupHint}`);
      const dc = m.domConstraints;
      if (dc.options?.length) bits.push(`选项=[${dc.options.join('|')}]`);
      if (dc.maxLength) bits.push(`限${dc.maxLength}字`);
      if (dc.required) bits.push('必填');
      if (dc.accept) bits.push(`accept=${dc.accept}`);
      return bits.join(' | ');
    })
    .join('\n');
}

export function buildSemanticPrompt(manifest: ControlManifestEntry[]): { system: string; user: string } {
  const user = `【可交互控件清单】\n${renderManifest(manifest)}\n\n【输出格式】严格 JSON：\n{"fields":[{"afIds":["af-0"],"label":"字段名","type":"text","sensitive":null}]}\n只输出这个 JSON 对象。`;
  return { system: SYSTEM_PROMPT, user };
}

// Mirrors prompts.ts escapeControlCharsInStrings (kept local so this module stays self-contained
// for the {fields:[...]} array shape; parseBatchResponse is flat key→string and can't be reused here).
function escapeControlCharsInStrings(s: string): string {
  let inStr = false;
  let esc = false;
  let out = '';
  for (const ch of s) {
    if (esc) { out += ch; esc = false; continue; }
    if (ch === '\\') { out += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr && ch === '\n') { out += '\\n'; continue; }
    if (inStr && ch === '\r') { out += '\\r'; continue; }
    if (inStr && ch === '\t') { out += '\\t'; continue; }
    out += ch;
  }
  return out;
}

function tolerantParse(text: string): unknown {
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) cleaned = fence[1].trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last <= first) return null;
  const slice = cleaned.slice(first, last + 1).replace(/,(\s*[}\]])/g, '$1');
  try { return JSON.parse(slice); } catch { /* fall through */ }
  try { return JSON.parse(escapeControlCharsInStrings(slice)); } catch { /* fall through */ }
  return null;
}

/**
 * Parse a `{fields:[...]}` LLM response into validated LlmExtractedField[].
 * Returns `null` when the response is UNPARSEABLE (no fields array found) — distinct from a valid
 * but EMPTY `{"fields":[]}` which returns `[]`. The caller treats null as a hard failure (so pure
 * `llm` mode surfaces ok:false per api.md §5) but `[]` as "the LLM legitimately found nothing".
 */
export function parseSemanticExtractResponse(text: string): LlmExtractedField[] | null {
  const obj = tolerantParse(text);
  const fieldsRaw = obj && typeof obj === 'object' ? (obj as { fields?: unknown }).fields : undefined;
  if (!Array.isArray(fieldsRaw)) return null;

  const out: LlmExtractedField[] = [];
  for (const raw of fieldsRaw) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const afIds = Array.isArray(r.afIds) ? r.afIds.filter((x): x is string => typeof x === 'string') : [];
    if (afIds.length === 0) continue;
    const label = typeof r.label === 'string' ? r.label : '';
    const t = typeof r.type === 'string' && VALID_TYPES.has(r.type as FieldType) ? (r.type as FieldType) : 'unknown';
    const field: LlmExtractedField = { afIds, label, type: t };
    if (r.sensitive === 'otp' || r.sensitive === 'personal') field.sensitive = r.sensitive;
    out.push(field);
  }
  return out;
}

/** Run the one-shot LLM extraction. Throws if the LLM call itself fails (caller / R5 handles fallback). */
export async function extractFieldsViaLLM(
  manifest: ControlManifestEntry[],
  cfg: SemanticLLMConfig,
): Promise<LlmExtractedField[]> {
  if (manifest.length === 0) return [];
  const { system, user } = buildSemanticPrompt(manifest);
  const result = await callLLM({
    apiKey: cfg.apiKey,
    provider: cfg.provider,
    baseURL: cfg.baseURL ?? '',
    model: cfg.modelId,
    systemPrompt: system,
    userPrompt: user,
    maxTokensOverride: 2048,
  });
  const parsed = parseSemanticExtractResponse(result.text);
  if (parsed === null) throw new Error('LLM 返回无法解析为字段列表');
  return parsed;
}
