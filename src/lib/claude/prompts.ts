// Prompt templates for the Claude API client.
// Designed to enforce field constraints AS HARD CONSTRAINTS — the failure mode
// Claude for Chrome exhibits is exactly that it ignores length hints.

import type { DetectedField, EventContext, Chunk } from '@/lib/db/types';
import { MAX_CHUNK_CHARS_FOR_PROMPT } from '@/lib/rag/retrieval';

/**
 * Truncate a chunk's text for prompt inclusion. Keeps the first
 * MAX_CHUNK_CHARS_FOR_PROMPT chars + appends "…" marker so Claude knows
 * content was cut. UX iteration 2026-05-24 (C): essential for 429
 * mitigation on long projects where any one chunk could be 2K+ chars.
 */
function truncateChunk(text: string): string {
  if (text.length <= MAX_CHUNK_CHARS_FOR_PROMPT) return text;
  return text.slice(0, MAX_CHUNK_CHARS_FOR_PROMPT) + '…(已截断)';
}

/**
 * Detect the form's working language from its labels / event title so we can
 * FORCE the answer into that language. UX iteration 2026-06-01: on an English
 * form (Epic Connector) some fields came back in Chinese because the RAG
 * material is Chinese and the old per-field hint ("看 label 判断") was too weak
 * — the Chinese context won. This makes the directive explicit + form-level.
 */
function detectFormLang(text: string): 'zh' | 'en' {
  const cjk = (text.match(/[一-鿿]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  if (cjk === 0) return 'en';
  return cjk / (cjk + latin || 1) >= 0.2 ? 'zh' : 'en';
}

function langDirectiveFor(signal: string): string {
  return detectFormLang(signal) === 'en'
    ? '【LANGUAGE】This is an English-language form field. Write the answer in natural, native English — even though the project material below is in Chinese, translate/compose in English. (If the user\'s 修改要求 above explicitly asks for another language, follow the user.)\n\n'
    : '【语言要求】本字段为中文表单字段，答案用中文撰写。（若上方"用户修改要求"指定了其它语言，以用户为准。）\n\n';
}

export const SYSTEM_PROMPT = `你是 PM 的活动报名助手 ApplyForge。

你的任务：基于提供的 项目档案 + 历史报名经验 + 活动背景，为单个表单字段生成最匹配的答案。

【绝对规则 · 不可违反】
1. 必须严格遵守字段约束，特别是字数限制（maxLength）。超出 = 失败。
2. 直接给答案，不要解释、不要前缀、不要 "好的，以下是..."。
3. 不要编造项目档案里没有的事实（数字、人物、合作伙伴等）。
4. 不要使用 Markdown 标记（除非字段语境明显要求）。
5. 中文字段用中文回答，英文字段用英文回答（看 label 和 placeholder 判断）。

【写作风格】
- 简洁、具体、可证伪。避免"赋能"、"打造"、"重新定义"这类空话。
- 优先匹配活动主题：例如活动主题是 "AI Agent"，答案突出 Agent 相关维度。
- 优先匹配主办方偏好：如果主办方是 加速器/政府，答案要突出商业可行性 + 产业匹配。
- 如果历史 Q&A 里我之前有过类似回答，参考我的表达风格（短句 vs 长句 / 拟人化 vs 正式）。`;

interface BuildPromptArgs {
  field: DetectedField;
  event: EventContext;
  projectChunks: Chunk[];
  qaChunks: Chunk[];
  /**
   * Optional user steering for a REGENERATE (UX iteration 2026-06-01): the PM
   * typed how they want this field changed ("更简短" / "强调落地" / "make it
   * punchier"). Injected as a high-priority instruction so regeneration
   * converges instead of producing another random draft.
   */
  refinement?: string;
}

export function buildUserPrompt(args: BuildPromptArgs): string {
  const { field, event, projectChunks, qaChunks } = args;

  // Choice fields take a fundamentally different prompt path: we want EXACTLY
  // one of the option labels back, not a paragraph. Mixing free-form rules
  // with "pick one of N options" routinely produces explanatory preambles
  // that then fail the substring match in fillField.
  const isChoice =
    (field.type === 'radio' || field.type === 'select' || field.type === 'checkbox') &&
    field.constraints.options && field.constraints.options.length > 0;

  if (isChoice) {
    return buildChoicePrompt(args);
  }

  const constraintLines: string[] = [];
  if (field.constraints.maxLength != null) {
    const target = Math.floor(field.constraints.maxLength * 0.9);
    constraintLines.push(`- 硬字数上限 ${field.constraints.maxLength} 字符（约 ${Math.round(field.constraints.maxLength / 6)} 个英文词）。**必须在此字数内写出"完整、自洽、能独立成立"的答案** —— 信息装不下就只保留最重要的几点、每点写完整，绝不为塞满而写到一半被截断。控制在约 ${target} 字符、以句号结束。`);
  }
  if (field.constraints.minLength) constraintLines.push(`- 最少 ${field.constraints.minLength} 字`);
  if (field.constraints.required) constraintLines.push('- 必填');
  if (field.constraints.placeholder) constraintLines.push(`- 占位提示: "${field.constraints.placeholder}"`);
  if (field.constraints.helperText) constraintLines.push(`- 辅助说明: "${field.constraints.helperText}"`);

  const projectSection = projectChunks.length
    ? projectChunks.map((c, i) => `[文档片段 #${i + 1}]\n${truncateChunk(c.text)}`).join('\n\n')
    : '（暂无项目档案 — 谨慎作答，不要编造）';

  const qaSection = qaChunks.length
    ? qaChunks.map((c, i) => `[历史 Q&A #${i + 1}]\n${truncateChunk(c.text)}`).join('\n\n')
    : '（暂无历史 Q&A）';

  const refineBlock = args.refinement?.trim()
    ? `【本次重新生成 · 用户的修改要求（最高优先级，必须照做）】\n${args.refinement.trim()}\n\n`
    : '';

  return `${refineBlock}${langDirectiveFor(`${field.label} ${field.constraints.placeholder ?? ''} ${field.constraints.helperText ?? ''}`)}【活动背景】
- 活动名: ${event.name || '（未填）'}
- 主题: ${event.theme || '（未填）'}
- 主办方: ${event.organizer || '（未填）'}
- 地点: ${event.location || '（未填）'}
- 链接: ${event.url || '（未填）'}
${event.extraNotes ? `- 补充说明: ${event.extraNotes}` : ''}

【项目档案 · 检索到的最相关 ${projectChunks.length} 个片段】
${projectSection}

【我之前类似字段的回答 · ${qaChunks.length} 个】
${qaSection}

【要填的字段】
- 字段名: "${field.label}"
- 字段类型: ${field.type}
${constraintLines.length ? '【字段约束】\n' + constraintLines.join('\n') : ''}

【输出要求】
直接给出最终答案。不要解释、不要前缀。${
    field.constraints.maxLength
      ? ` 答案必须在 ${field.constraints.maxLength} 字符内写完整（控制在约 ${Math.floor(field.constraints.maxLength * 0.9)} 字符、以句号结束；装不下就精简内容但每句保持完整，绝不写到一半）。`
      : ''
  }`;
}

/**
 * Prompt for radio/checkbox/select fields. The output MUST be exactly one
 * of the option labels (or, for checkboxes, a comma-separated list of
 * labels). Anything else and our fillField() can't click the right element.
 */
function buildChoicePrompt(args: BuildPromptArgs): string {
  const { field, event, projectChunks, qaChunks } = args;
  const options = field.constraints.options ?? [];

  const projectSection = projectChunks.length
    ? projectChunks.map((c, i) => `[文档片段 #${i + 1}]\n${truncateChunk(c.text)}`).join('\n\n')
    : '（暂无项目档案）';
  const qaSection = qaChunks.length
    ? qaChunks.map((c, i) => `[历史 Q&A #${i + 1}]\n${truncateChunk(c.text)}`).join('\n\n')
    : '（暂无历史 Q&A）';

  const multi = field.type === 'checkbox';
  const verb = multi ? '一个或多个最匹配的选项' : '一个最匹配的选项';

  return `【活动背景】
- 活动名: ${event.name || '（未填）'}
- 主题: ${event.theme || '（未填）'}
- 主办方: ${event.organizer || '（未填）'}
- 地点: ${event.location || '（未填）'}
${event.extraNotes ? `- 补充说明: ${event.extraNotes}` : ''}

【项目档案】
${projectSection}

【历史 Q&A】
${qaSection}

【这是一个【${multi ? '多选' : '单选'}】字段】
字段标题: "${field.label}"

可选项（必须从中挑选）：
${options.map((o, i) => `  ${i + 1}. ${o}`).join('\n')}

【输出规则 · 极其严格】
- 从上面的选项中选出 ${verb}。
- ${multi
    ? '如果有多个匹配，用中文逗号「，」分隔，例如「北京，上海」。'
    : '只输出 1 个选项，不要解释。'}
- **必须原样照抄选项文本**，不要改写、不要加引号、不要加序号、不要加任何说明。
- 如果项目地点/属性无法从档案推断（例如"所在城市"档案没提），选最接近的或最合理的（例如电商公司默认在一二线城市）。
- 不要输出"我选择"、"答案是"、"根据..."这类前缀。

直接输出选项文本：`;
}

/**
 * Build a retry prompt when the first attempt violated the length constraint.
 */
export function buildRetryPrompt(originalDraft: string, field: DetectedField): string {
  const cap = field.constraints.maxLength ?? 0;
  return `你刚才生成的答案是：
"""
${originalDraft}
"""

它有 ${Array.from(originalDraft).length} 字符，**超过了硬上限 ${cap} 字符**（超出会被系统硬截断成半句话）。
请大幅精简重写：只保留最核心的 1-2 点，写到约 ${Math.floor(cap * 0.8)} 字符以内（约 ${Math.round(cap / 6)} 个英文词），**必须以句号结束的完整句子收尾**，绝不超过 ${cap} 字符。
直接给答案，不要解释。`;
}

// ===========================================================================
// UX iteration 2026-05-24 (D): Batch generation
// ---------------------------------------------------------------------------
// Generate N drafts in one Claude call. Shared event/RAG context appears
// once; per-field constraints listed individually; Claude returns JSON keyed
// by stable per-field tokens we synthesize ("f1", "f2", ...) — we then map
// back to the real fieldId so the IDs (which may contain hyphens / special
// chars) don't trip JSON.parse.
// ===========================================================================

export interface BuildBatchPromptArgs {
  fields: DetectedField[];
  event: EventContext;
  projectChunks: Chunk[];
  qaChunks: Chunk[];
}

export interface BatchPromptResult {
  prompt: string;
  /** Map from synthetic JSON key ("f1") back to real fieldId. */
  keyMap: Record<string, string>;
}

/**
 * Build the multi-field prompt. Returns prompt + key map so the caller can
 * remap Claude's JSON keys back to real fieldIds.
 *
 * Per-field tokens use 1-indexed "f1", "f2"... — short to keep JSON minimal,
 * predictable so Claude doesn't paraphrase them.
 */
export function buildBatchPrompt(args: BuildBatchPromptArgs): BatchPromptResult {
  const { fields, event, projectChunks, qaChunks } = args;

  const projectSection = projectChunks.length
    ? projectChunks.map((c, i) => `[文档片段 #${i + 1}]\n${truncateChunk(c.text)}`).join('\n\n')
    : '（暂无项目档案 — 谨慎作答，不要编造）';

  const qaSection = qaChunks.length
    ? qaChunks.map((c, i) => `[历史 Q&A #${i + 1}]\n${truncateChunk(c.text)}`).join('\n\n')
    : '（暂无历史 Q&A）';

  // Build per-field sections + the synthetic key map.
  const keyMap: Record<string, string> = {};
  const fieldSections = fields.map((f, i) => {
    const key = `f${i + 1}`;
    keyMap[key] = f.fieldId;
    const constraintLines: string[] = [];
    if (f.constraints.maxLength != null) {
      const target = Math.floor(f.constraints.maxLength * 0.9);
      constraintLines.push(`  - 硬字数上限 ${f.constraints.maxLength} 字符（约 ${Math.round(f.constraints.maxLength / 6)} 词）：在此字数内写完整自洽的内容，装不下就精简、每点完整、别写到一半。约 ${target} 字符、以句号结束。`);
    }
    if (f.constraints.minLength) constraintLines.push(`  - 最少 ${f.constraints.minLength} 字`);
    if (f.constraints.required) constraintLines.push('  - 必填');
    if (f.constraints.placeholder) constraintLines.push(`  - 占位提示: "${f.constraints.placeholder}"`);
    if (f.constraints.helperText) constraintLines.push(`  - 辅助说明: "${f.constraints.helperText}"`);
    const constraintBlock = constraintLines.length ? `\n${constraintLines.join('\n')}` : '';
    return `【字段 ${key}】
  - 字段名: "${f.label}"
  - 类型: ${f.type}${constraintBlock}`;
  }).join('\n\n');

  // Provide an explicit JSON skeleton so Claude can mimic it exactly.
  const skeletonEntries = Object.keys(keyMap).map((k) => `  "${k}": "..."`).join(',\n');
  const skeleton = `{\n${skeletonEntries}\n}`;

  return {
    keyMap,
    prompt: `${langDirectiveFor(fields.map((f) => `${f.label} ${f.constraints.placeholder ?? ''}`).join(' '))}【活动背景】
- 活动名: ${event.name || '（未填）'}
- 主题: ${event.theme || '（未填）'}
- 主办方: ${event.organizer || '（未填）'}
- 地点: ${event.location || '（未填）'}
- 链接: ${event.url || '（未填）'}
${event.extraNotes ? `- 补充说明: ${event.extraNotes}` : ''}

【项目档案 · 检索到的最相关 ${projectChunks.length} 个片段】
${projectSection}

【我之前类似字段的回答 · ${qaChunks.length} 个】
${qaSection}

【任务】
请为下面 ${fields.length} 个字段同时生成最匹配的答案。每个字段独立约束，必须严格遵守。

${fieldSections}

【输出格式 · 严格 JSON · 不要包裹在 markdown 代码块里】
${skeleton}

【输出规则 · 极其严格】
- 直接输出 JSON 对象，第一个字符是 \`{\`，最后一个字符是 \`}\`。
- 不要前缀、不要后缀、不要 \`\`\`json\` 包裹、不要解释。
- 每个 value 是字符串。如果你想换行，用 \\n。不要在 JSON 里放真实换行字符。
- 严格遵守每个字段的字数上限。
- 不要编造项目档案里没有的事实。`,
  };
}

/**
 * Escape raw control characters (newlines, tabs, CR) that appear INSIDE JSON
 * string values. This is the #1 reason JSON.parse fails on LLM batch output:
 * models routinely write multi-line text (e.g. a multi-paragraph project
 * intro) with LITERAL newlines inside the quotes instead of `\n`, which is
 * invalid JSON. We walk the string tracking quote state and escape any bare
 * control char that occurs while inside a string.
 *
 * UX iteration 2026-05-30: added after a real-form run where 3 long-text
 * fields batched together all failed with "批量生成返回的 JSON 无法解析"
 * because the model put real newlines in the project-intro value.
 */
function escapeControlCharsInStrings(json: string): string {
  let out = '';
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!;
    if (inStr) {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === '\\') { out += ch; escaped = true; continue; }
      if (ch === '"') { out += ch; inStr = false; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
    } else {
      if (ch === '"') { inStr = true; }
      out += ch;
    }
  }
  return out;
}

/**
 * Last-resort: pull "fN": "value" pairs by regex when JSON.parse can't be
 * salvaged at all (e.g. the model emitted prose around the values, or the
 * structure is irreparably broken). Tolerates raw newlines inside the value
 * since the character class spans them.
 */
function regexExtractPairs(text: string, keyMap: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [synthKey, realId] of Object.entries(keyMap)) {
    const re = new RegExp(`"${synthKey}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
    const m = text.match(re);
    if (m && m[1] !== undefined) {
      out[realId] = m[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  }
  return out;
}

/**
 * Structure-aware recovery for batch JSON that JSON.parse can't handle —
 * almost always because a value contains an unescaped ASCII double-quote
 * (English answers love quoting terms: a "quorum gate"), which `escapeControl`
 * can't fix and the old regex fallback truncated the value at. Since we KNOW
 * the keys (f1..fN) and the shape `{"f1":"...","f2":"..."}`, extract each value
 * as everything between its own `"fK":"` and the START of the next key's marker
 * (or the trailing `}` for the last). Embedded quotes/newlines are preserved.
 * UX iteration 2026-06-02: fixes English drafts being cut mid-sentence.
 */
function structuredExtract(text: string, keyMap: Record<string, string>): Record<string, string> {
  type Mark = { key: string; openIdx: number; valStart: number };
  const marks: Mark[] = Object.keys(keyMap)
    .map((k): Mark | null => {
      const m = text.match(new RegExp(`"${k}"\\s*:\\s*"`));
      return m && m.index !== undefined ? { key: k, openIdx: m.index, valStart: m.index + m[0].length } : null;
    })
    .filter((x): x is Mark => x !== null)
    .sort((a, b) => a.valStart - b.valStart);

  const out: Record<string, string> = {};
  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i]!;
    const next = marks[i + 1];
    const lastBrace = text.lastIndexOf('}');
    const end = next ? next.openIdx : (lastBrace > cur.valStart ? lastBrace : text.length);
    // Strip the trailing structural closing-quote (+ optional comma/whitespace)
    // that separates this value from the next key / closing brace. Quotes INSIDE
    // the value are left untouched.
    const raw = text.slice(cur.valStart, end).replace(/"\s*,?\s*$/, '');
    out[keyMap[cur.key]!] = raw
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return out;
}

/**
 * Parse the batch response back into per-field drafts.
 * Returns null only if NOTHING could be salvaged; otherwise returns a (possibly
 * partial) map — caller falls back to per-field generation for missing ids.
 *
 * Tolerant of common LLM output quirks (in escalating order):
 *   - ```json wrapping / preamble prose (slice between first { and last })
 *   - trailing commas
 *   - RAW newlines/tabs inside string values (the big one — multi-line text)
 *   - total JSON breakage → regex pair extraction
 */
export function parseBatchResponse(
  responseText: string,
  keyMap: Record<string, string>,
): Record<string, string> | null {
  // Strip ```json...``` wrapping if present
  let cleaned = responseText.trim();
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) cleaned = codeBlockMatch[1].trim();

  // Find the first { and last } — models sometimes prepend explanation.
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    // No object braces at all — try regex extraction as a Hail Mary.
    const salvaged = regexExtractPairs(cleaned, keyMap);
    return Object.keys(salvaged).length ? salvaged : null;
  }
  const jsonSlice = cleaned.slice(firstBrace, lastBrace + 1);

  // Remove trailing commas (common quirk) — `,\s*}` and `,\s*]`
  const sanitized = jsonSlice.replace(/,(\s*[}\]])/g, '$1');

  const extract = (parsed: Record<string, unknown>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [synthKey, realId] of Object.entries(keyMap)) {
      const v = parsed[synthKey];
      if (typeof v === 'string') out[realId] = v;
      else if (v != null && typeof v !== 'object') out[realId] = String(v);
    }
    return out;
  };

  // Attempt 1: parse as-is.
  try {
    return extract(JSON.parse(sanitized) as Record<string, unknown>);
  } catch { /* fall through */ }

  // Attempt 2: repair raw control chars inside string values, then parse.
  try {
    return extract(JSON.parse(escapeControlCharsInStrings(sanitized)) as Record<string, unknown>);
  } catch { /* fall through */ }

  // Attempt 3: structure-aware extraction — robust to unescaped quotes / raw
  // newlines inside values (the English-answer failure mode that truncated
  // drafts mid-sentence). Splits on the known f1..fN key markers rather than
  // stopping at the first quote.
  const structured = structuredExtract(jsonSlice, keyMap);
  if (Object.keys(structured).length) return structured;

  // Attempt 4: last-resort regex pair extraction (may be partial).
  const salvaged = regexExtractPairs(jsonSlice, keyMap);
  return Object.keys(salvaged).length ? salvaged : null;
}
