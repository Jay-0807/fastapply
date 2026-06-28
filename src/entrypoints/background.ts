// Service worker — central message router + Claude/OpenAI API calls.
// All long-running work happens here; UI surfaces are thin clients.

import { defineBackground } from 'wxt/sandbox';
import { v4 as uuid } from 'uuid';

import { db } from '@/lib/db/schema';
import type {
  Project,
  DocumentRecord,
  Chunk,
  QARecord,
  AppSettings,
  DetectedField,
  EventContext,
  LLMConfig,
  ScanMode,
  Person,
  ProjectFacts,
} from '@/lib/db/types';
import type { Message, StreamingEvent } from '@/lib/messages/types';
import { generateDraft, generateBatchDrafts } from '@/lib/claude/client';
import { resolvePersonalFills, type PersonalFillResolution } from '@/lib/graph/person-fields';
import { deriveEventType, deriveTopicTags } from '@/lib/graph/event-similarity';
import { importGraphSeed } from '@/lib/graph/seed-import';
import { deleteProjectCascade } from '@/lib/db/project-ops';
import { scanHybrid } from '@/lib/fields/semantic/orchestrate';
import type { SemanticLLMConfig } from '@/lib/fields/semantic/extract';
import type { ControlManifestEntry, ScanResult } from '@/lib/fields/semantic/types';
import { parseDocument } from '@/lib/parsers';
import { chunkText, approxTokenCount } from '@/lib/rag/embedding';
import { retrieveGraphAware } from '@/lib/rag/retrieval';
import { isSeedableQaPair, buildQaChunkText } from '@/lib/rag/qa-seed';
import { buildMarkdown, buildFilename, slugify } from '@/lib/markdown/qa-writer';
import {
  deriveKey,
  encryptString,
  decryptString,
  newSalt,
  getSessionKey,
  setSessionKey,
  restoreSessionKey,
  SECURE_STORAGE_CONFIG,
} from '@/lib/crypto/secure-storage';
import { collectUnlockVerificationTargets } from '@/lib/crypto/unlock-target';

// Module-level readiness promise — every message handler awaits this so a
// request that arrives 50ms after SW boot doesn't see a still-null sessionKey
// and report "Settings locked" while it's actually being restored.
// Previously this was `void restoreSessionKey()` (fire-and-forget) inside
// defineBackground; the race manifested as "I just unlocked but the next
// generation says I'm locked." See 05a-ux-design.md §B.1.
let sessionReadyPromise: Promise<void> | null = null;

export default defineBackground(() => {
  // Kick off session-key restore on SW boot. We keep the promise so handlers
  // can await it; it's idempotent so calling restoreSessionKey() again later
  // is safe (it just resolves with the already-restored key).
  sessionReadyPromise = restoreSessionKey().catch((err) => {
    console.warn('[background] restoreSessionKey failed:', err);
  });

  // Open the side panel when the action icon is clicked.
  chrome.action.onClicked.addListener((tab) => {
    if (tab.id) chrome.sidePanel.open({ tabId: tab.id });
  });

  chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
    // Gate every handler on session-key readiness so the unlock race is
    // impossible. Even if the promise is null (somehow handler fires before
    // the SW finishes defineBackground init), we fall through to handle and
    // the inner code throws "Settings locked" — which is the correct
    // behavior in that genuinely-unauthenticated case.
    (sessionReadyPromise ?? Promise.resolve())
      .then(() => handle(msg))
      .then((res) => sendResponse({ ok: true, data: res }))
      .catch((err) => {
        console.error('[background]', msg.type, err);
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true; // async response
  });
});

// -------- Router --------
async function handle(msg: Message): Promise<unknown> {
  switch (msg.type) {
    case 'projects.list':
      return db.projects.orderBy('createdAt').reverse().toArray();
    case 'projects.create':
      return createProject(msg.payload);
    case 'projects.update':
      await db.projects.update(msg.payload.id, { ...msg.payload.patch, updatedAt: Date.now() });
      return db.projects.get(msg.payload.id);
    case 'projects.delete':
      // Cascade-delete the project + everything it owns (docs / chunks / records
      // / assets), atomically, leaving no orphans. See deleteProjectCascade.
      await deleteProjectCascade(msg.payload.id);
      return { ok: true };
    case 'documents.upload':
      return uploadDocument(msg.payload);
    case 'documents.list':
      return db.documents.where('projectId').equals(msg.payload.projectId).toArray();
    case 'documents.delete':
      await db.transaction('rw', db.documents, db.chunks, async () => {
        await db.chunks.where('sourceId').equals(msg.payload.id).delete();
        await db.documents.delete(msg.payload.id);
      });
      return { ok: true };
    case 'documents.reindex': {
      // Retry the chunk pipeline for a document that previously failed.
      // We keep the rawText (parse already succeeded in the UI) and just rerun
      // chunking — which in V1 is the only remaining step.
      const doc = await db.documents.get(msg.payload.id);
      if (!doc) throw new Error('Document not found');
      await db.chunks.where('sourceId').equals(doc.id).delete();
      await db.documents.update(doc.id, { parseStatus: 'pending', parseError: null });
      void indexDocument({ ...doc, parseStatus: 'pending', parseError: null });
      return { ok: true };
    }
    case 'assets.upload': {
      const id = uuid();
      const blob = new Blob([msg.payload.bytes], { type: msg.payload.mimeType });
      const asset = {
        id,
        projectId: msg.payload.projectId,
        filename: msg.payload.filename,
        mimeType: msg.payload.mimeType,
        sizeBytes: msg.payload.sizeBytes,
        blob,
        tag: msg.payload.tag,
        notes: msg.payload.notes,
        createdAt: Date.now(),
      };
      await db.projectAssets.add(asset);
      return { id, filename: asset.filename, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, tag: asset.tag };
    }
    case 'assets.list': {
      const items = await db.projectAssets.where('projectId').equals(msg.payload.projectId).toArray();
      // Strip the blob — clients only need metadata for display.
      return items.map((a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        tag: a.tag,
        notes: a.notes,
        createdAt: a.createdAt,
      }));
    }
    case 'assets.delete':
      await db.projectAssets.delete(msg.payload.id);
      return { ok: true };
    case 'assets.matchToFields':
      return matchAssetsToFields(msg.payload);
    case 'assets.getBinary': {
      const a = await db.projectAssets.get(msg.payload.id);
      if (!a) throw new Error('Asset not found');
      // chrome.runtime.sendMessage can carry ArrayBuffer transparently.
      const buf = await a.blob.arrayBuffer();
      return { filename: a.filename, mimeType: a.mimeType, bytes: buf };
    }
    case 'events.detectFromPage':
      return detectEventFromPage(msg.payload.tabId);
    case 'events.save': {
      // V0.4.0 KG: derive the matching hints (eventType / topicTags) at save
      // time so the graph-aware retriever can find similar past events later.
      const ec = withDerivedEventGraph(msg.payload.eventContext);
      await db.eventContexts.put(ec);
      return ec;
    }
    case 'fields.scan':
      return scanFieldsOnTab(msg.payload.tabId, msg.payload.mode);
    case 'draft.generateOne':
      // Streams via separate channel; sender awaits 'draft.done'.
      void generateOneDraft(msg.payload);
      return { ok: true, streamId: msg.payload.streamId };
    case 'draft.generateBatch':
      // UX iteration 2026-05-24 (D): batched generation for non-choice fields.
      // Per-field draft.done events broadcast as Claude's JSON parses.
      void generateBatchDrafts_handler(msg.payload);
      return { ok: true, streamId: msg.payload.streamId };
    case 'fields.fillPage':
      return fillFieldsOnTab(msg.payload.tabId, msg.payload.fillMap, msg.payload.fileMap);
    case 'qaRecord.upsertDraft':
      await db.qaRecords.put(msg.payload.qaRecord);
      return msg.payload.qaRecord;
    case 'qaRecord.markSubmitted':
      return markRecordSubmitted(msg.payload.qaRecordId);
    case 'qa.toggleExclusion':
      return toggleQAExclusion(msg.payload);
    case 'settings.get':
      return db.appSettings.get('singleton');
    case 'settings.unlock':
      return unlockSettings(msg.payload.masterPassword);
    case 'settings.lock':
      setSessionKey(null);
      return { ok: true };
    case 'settings.save':
      return saveSettings(msg.payload);
    // ===== V2.2: LLM config library CRUD =====
    case 'llmConfig.add':
      return addLLMConfig(msg.payload);
    case 'llmConfig.delete':
      return deleteLLMConfig(msg.payload.id);
    case 'llmConfig.setActive':
      return setActiveLLMConfig(msg.payload.id);
    case 'backup.export':
      return exportBackup();
    case 'backup.import':
      return importBackup(msg.payload.jsonText);
    case 'qaRecord.delete':
      // Delete the record + its derived chunks so it stops surfacing in
      // future RAG retrieval. Markdown file already downloaded — we don't
      // touch the user's Downloads folder.
      await db.transaction('rw', db.qaRecords, db.chunks, async () => {
        await db.chunks.where('sourceId').equals(msg.payload.id).delete();
        await db.qaRecords.delete(msg.payload.id);
      });
      return { ok: true };
    // ===== V0.4.0 knowledge graph: Person CRUD =====
    case 'persons.list':
      return db.persons.orderBy('createdAt').reverse().toArray();
    case 'persons.create':
      return createPerson(msg.payload);
    case 'persons.update':
      await db.persons.update(msg.payload.id, { ...msg.payload.patch, updatedAt: Date.now() });
      return db.persons.get(msg.payload.id);
    case 'persons.delete':
      await db.persons.delete(msg.payload.id);
      return { ok: true };
    case 'persons.resolveFills':
      return resolvePersonalFillsForFields(msg.payload);
    // ===== V0.4.0 knowledge graph: structured fact extraction from a dropped file =====
    case 'projectFacts.extract':
      return extractProjectFactsFromText(msg.payload.text);
    case 'graph.importSeed':
      return importGraphSeed(msg.payload.seed);
    default: {
      const _exhaustive: never = msg;
      throw new Error(`Unhandled message: ${(_exhaustive as { type: string }).type}`);
    }
  }
}

// -------- Implementations --------

async function createProject(args: { name: string; description: string; tags: string[] }): Promise<Project> {
  const proj: Project = {
    id: uuid(),
    name: args.name,
    description: args.description,
    tags: args.tags,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    applicationCount: 0,
  };
  await db.projects.add(proj);
  return proj;
}

// ===========================================================================
// V0.4.0 knowledge graph — Person CRUD + personal-fill resolution +
// event-graph derivation + structured fact extraction.
// ===========================================================================

/** Canonical PersonFieldKey set — used to whitelist LLM-extracted person fields. */
const PERSON_FIELD_KEYS = ['name', 'phone', 'email', 'wechat', 'qq', 'idNumber', 'title', 'organization', 'address', 'bio'] as const;

async function createPerson(args: {
  displayName: string;
  role?: string;
  fields?: Person['fields'];
  notes?: string;
}): Promise<Person> {
  const now = Date.now();
  const person: Person = {
    id: uuid(),
    displayName: args.displayName,
    role: args.role ?? '',
    fields: args.fields ?? {},
    notes: args.notes ?? '',
    createdAt: now,
    updatedAt: now,
  };
  await db.persons.add(person);
  return person;
}

/**
 * Resolve which personal fields can be auto-filled from the selected people's
 * stored profiles. Pure logic lives in person-fields.ts; this just loads the
 * Person rows. The sidepanel merges the result into its fillMap (visible to the
 * user) — we never fill personal info silently or via the LLM.
 */
async function resolvePersonalFillsForFields(payload: {
  fields: DetectedField[];
  personIds: string[];
  primaryPersonId?: string;
}): Promise<PersonalFillResolution[]> {
  if (!payload.personIds.length) return [];
  const loaded = await db.persons.bulkGet(payload.personIds);
  const persons = loaded.filter((p): p is Person => !!p);
  return resolvePersonalFills(payload.fields, persons, payload.primaryPersonId);
}

/** Fill in derived matching hints (eventType / topicTags) on an event if absent. */
function withDerivedEventGraph(ec: EventContext): EventContext {
  return {
    ...ec,
    eventType: ec.eventType ?? deriveEventType(ec),
    topicTags: ec.topicTags && ec.topicTags.length ? ec.topicTags : deriveTopicTags(ec),
  };
}

/**
 * Provider-aware one-shot text completion (mirrors extractEventFromBody's
 * dispatch). Used for the structured fact / person extraction below.
 */
async function llmOneShotText(
  cfg: Awaited<ReturnType<typeof requireLLMConfigById>>,
  prompt: string,
  maxTokens: number,
): Promise<string> {
  if (cfg.provider === 'anthropic') {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: cfg.apiKey, timeout: 30_000, dangerouslyAllowBrowser: true });
    const resp = await client.messages.create({ model: cfg.modelId, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] });
    return resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  }
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL!, timeout: 30_000, dangerouslyAllowBrowser: true });
  const resp = await client.chat.completions.create({ model: cfg.modelId, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] });
  return resp.choices[0]?.message?.content ?? '';
}

export interface ExtractedPersonCandidate {
  displayName: string;
  role: string;
  fields: Person['fields'];
}

/**
 * Extract structured project facts + person candidates from a dropped file's
 * text. Returns CANDIDATES ONLY — the UI shows them for the user to confirm /
 * edit before anything is written to the graph (we never blindly trust the LLM;
 * decision 2026-06-24). Sensitive person info is whitelisted to known keys and
 * the prompt forbids fabrication.
 */
async function extractProjectFactsFromText(text: string): Promise<{ facts: ProjectFacts; persons: ExtractedPersonCandidate[] }> {
  const clipped = (text ?? '').slice(0, 12000);
  if (clipped.trim().length < 20) return { facts: {}, persons: [] };
  const cfg = await requireLLMConfigById();

  const prompt = `下面是用户提供的一份项目资料（BP / 产品介绍 / 团队介绍等）。请抽取结构化信息，严格输出 JSON。

【资料正文（前 12000 字）】
${clipped}

【任务】抽取两部分：
1) facts —— 项目结构化事实（找不到的字段留空字符串）：
   oneLiner(一句话介绍) / sector(赛道行业) / stage(阶段，如 种子轮/已成立公司) / location(所在城市) / teamSize(团队规模) / metrics(关键指标进展) / techStack(技术栈)
2) persons —— 团队成员数组（只抽资料里明确写到的真实人）：每个含 displayName(姓名), role(角色/职位), fields{ name, phone, email, wechat, title, organization }（这些个人信息仅在资料里明确出现才填，否则省略该键）

【绝对规则】不确定就留空 / 省略；**绝不编造人名、电话、邮箱、身份证、微信**。个人敏感信息只在原文明确出现才填。

【输出格式 · 严格 JSON · 不要 markdown 包裹】
{"facts":{"oneLiner":"","sector":"","stage":"","location":"","teamSize":"","metrics":"","techStack":""},"persons":[]}

直接输出 JSON。`;

  const raw = await llmOneShotText(cfg, prompt, 1024);
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('结构化抽取失败：模型没有返回 JSON');
  const parsed = JSON.parse(m[0]) as {
    facts?: Record<string, unknown>;
    persons?: Array<{ displayName?: unknown; role?: unknown; fields?: Record<string, unknown> }>;
  };

  // Sanitize facts — keep only known string keys with non-empty values.
  const facts: ProjectFacts = {};
  const f = parsed.facts ?? {};
  for (const key of ['oneLiner', 'sector', 'stage', 'location', 'teamSize', 'metrics', 'techStack'] as const) {
    const v = f[key];
    if (typeof v === 'string' && v.trim()) facts[key] = v.trim();
  }

  // Sanitize persons — whitelist field keys, require a display name, never invent.
  const persons: ExtractedPersonCandidate[] = [];
  for (const p of parsed.persons ?? []) {
    const displayName = typeof p.displayName === 'string' ? p.displayName.trim() : '';
    if (!displayName) continue;
    const fields: Person['fields'] = {};
    const src = p.fields ?? {};
    for (const key of PERSON_FIELD_KEYS) {
      const v = src[key];
      if (typeof v === 'string' && v.trim()) fields[key] = v.trim();
    }
    persons.push({ displayName, role: typeof p.role === 'string' ? p.role.trim() : '', fields });
  }

  return { facts, persons };
}

async function uploadDocument(args: {
  projectId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  text: string;
}): Promise<DocumentRecord> {
  // Document parsing runs in the UI context (see options/App.tsx onUpload).
  // We considered shipping the raw bytes here, but chrome.runtime.sendMessage
  // round-trips through a JSON-like channel that silently drops ArrayBuffer
  // contents — bytes arrive as `{}`, leading to NaN sizes and parse-of-empty
  // failures. Parsing in the UI also avoids the service-worker 5-minute idle
  // kill that would otherwise interrupt large PDFs.
  const doc: DocumentRecord = {
    id: uuid(),
    projectId: args.projectId,
    filename: args.filename,
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes,
    rawText: args.text,
    parseStatus: 'parsed',
    parseError: null,
    createdAt: Date.now(),
  };
  await db.documents.add(doc);

  // Kick off chunk → embed pipeline asynchronously — UI polls progress via
  // documents table.
  void indexDocument(doc);
  return doc;
}

async function indexDocument(doc: DocumentRecord): Promise<void> {
  // V1 architecture: a single API (Claude) only. We skip embedding entirely —
  // since Sonnet 4.5 has a 200K-token context window and a typical user's
  // project corpus + Q&A history fits well under that, we stuff the full text
  // into prompts at draft time instead of building a vector index here.
  // Embedding remains in the schema for V2 when the corpus may outgrow context.
  try {
    const chunks = chunkText(doc.rawText);
    const chunkRecords: Chunk[] = chunks.map((c, i) => ({
      id: uuid(),
      sourceType: 'document',
      sourceId: doc.id,
      projectId: doc.projectId,
      text: c,
      embedding: new Float32Array(0),
      embeddingModel: 'none',
      tokenCount: approxTokenCount(c),
      excludedFromRag: false,
      createdAt: Date.now(),
      metadata: { chunkIndex: i, sourceFilename: doc.filename },
    }));
    // GAN fix: a concurrent project delete could orphan these chunks (the cascade
    // ran while we were chunking). Do the existence-check + chunk write in ONE
    // transaction — Dexie serializes it against deleteProjectCascade since both
    // touch documents+chunks — so if the doc was deleted meanwhile, we skip and
    // never resurrect orphan chunks.
    let wrote = false;
    await db.transaction('rw', db.documents, db.chunks, async () => {
      if (!(await db.documents.get(doc.id))) return; // deleted mid-index → bail
      await db.chunks.bulkAdd(chunkRecords);
      await db.documents.update(doc.id, { parseStatus: 'parsed', parseError: null });
      wrote = true;
    });
    if (wrote) broadcast({ kind: 'documents.parseProgress', documentId: doc.id, progress: 1 });
  } catch (err) {
    await db.documents.update(doc.id, {
      parseStatus: 'failed',
      parseError: err instanceof Error ? err.message : String(err),
    });
  }
}

async function detectEventFromPage(tabId: number): Promise<Partial<EventContext>> {
  // Two-source capture: (a) document meta + page title, (b) first ~4K chars
  // of rendered body text. Meta is useless on hosted form platforms
  // (Qualtrics/Typeform titles are always boilerplate), so we send the body
  // text through Claude for structured extraction. The meta is still used as
  // a fallback if Claude is unreachable.
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const get = (sel: string) => document.querySelector(sel)?.getAttribute('content') || '';
      // UX iteration 2026-05-23: previously we just took the first 4000 chars
      // of document.body.innerText. On long-form pages (with hero + sponsors +
      // FAQ + footer), the actual event description was AFTER 4000 chars, so
      // Claude saw boilerplate and hallucinated names like "New Application
      // Form". Now: try semantic containers first (<main>, [role="main"],
      // #content, .content), fall back to body. Cap raised to 8000 — context
      // budget allows it and Claude needs the full intro paragraph.
      const semanticEl = document.querySelector('main, [role="main"], #content, .content, [class*="main-content" i]');
      const sourceText = semanticEl
        ? (semanticEl as HTMLElement).innerText || ''
        : document.body?.innerText || '';
      const bodyText = sourceText.slice(0, 8000);
      const textSource = semanticEl ? 'semantic' : 'body';
      return {
        pageTitle: document.title,
        pageUrl: location.href,
        ogTitle: get('meta[property="og:title"]'),
        ogDescription: get('meta[property="og:description"]'),
        ogImage: get('meta[property="og:image"]'),
        ogSiteName: get('meta[property="og:site_name"]'),
        h1: document.querySelector('h1')?.textContent?.trim() || '',
        bodyText,
        textSource,
      };
    },
  });
  const captured = (result?.result || {}) as Record<string, string>;
  const { bodyText, ...meta } = captured;
  const url = meta.pageUrl || '';

  // Try Claude extraction — the only way to get real event info from a
  // hosted-form page where the title is boilerplate.
  if (bodyText && bodyText.trim().length > 50) {
    try {
      const ai = await extractEventFromBody(bodyText, meta);
      // Track per-field origin so the UI can render colored badges
      // (extracted/guess/empty) next to each EventField. Claude got "name"
      // → "extracted"; we filled "" but meta had og:title → "guess".
      const fieldOrigins: Record<string, 'extracted' | 'empty' | 'guess'> = {
        name: ai.name ? 'extracted' : (meta.ogTitle || meta.h1 || meta.pageTitle) ? 'guess' : 'empty',
        theme: ai.theme ? 'extracted' : 'empty',
        organizer: ai.organizer ? 'extracted' : meta.ogSiteName ? 'guess' : 'empty',
        location: ai.location ? 'extracted' : 'empty',
        deadline: ai.deadline ? 'extracted' : 'empty',
      };
      return {
        name: ai.name || meta.ogTitle || meta.h1 || meta.pageTitle || '',
        theme: ai.theme || '',
        organizer: ai.organizer || meta.ogSiteName || '',
        location: ai.location || '',
        deadline: ai.deadline || null,
        url,
        pageMetaJson: { ...meta, _extractionMeta: { confidence: ai.confidence, source: 'claude', fieldOrigins } },
      };
    } catch (err) {
      console.warn('[event-extract] Claude failed, falling back to meta:', err);
      // Fall through to meta fallback path. T19: tag it as confidence=failed
      // so the UI can show "AI extraction failed, info below comes from page
      // metadata — verify carefully."
    }
  }

  // Meta-only fallback (Claude unreachable, or page has no body text).
  // confidence='failed' when Claude tried and threw; 'low' when no bodyText.
  const fallbackConfidence: 'failed' | 'low' = bodyText && bodyText.trim().length > 50 ? 'failed' : 'low';
  return {
    name: meta.ogTitle || meta.h1 || meta.pageTitle || '',
    organizer: meta.ogSiteName || '',
    url,
    pageMetaJson: {
      ...meta,
      _extractionMeta: {
        confidence: fallbackConfidence,
        source: 'meta',
        fieldOrigins: {
          name: (meta.ogTitle || meta.h1 || meta.pageTitle) ? 'guess' : 'empty',
          theme: 'empty',
          organizer: meta.ogSiteName ? 'guess' : 'empty',
          location: 'empty',
          deadline: 'empty',
        },
      },
    },
  };
}

/**
 * Send page body text to Claude with a strict JSON-output prompt to pull out
 * structured event metadata: name, theme, organizer, location, deadline.
 * Returns empty strings (not undefined) for any field Claude couldn't infer
 * confidently — UI displays empty so user notices and fills it in.
 */
/**
 * UX iteration 2026-05-23 (T19) — return type now includes a `confidence`
 * level so the sidepanel can render the ExtractionConfidenceBanner
 * (high/medium/low/failed). We compute it cheaply from "how many of the 5
 * fields Claude actually filled" — 4-5 = high, 2-3 = medium, 0-1 = low, throw = failed.
 */
async function extractEventFromBody(
  bodyText: string,
  meta: Record<string, string>,
): Promise<{ name: string; theme: string; organizer: string; location: string; deadline: string | null; confidence: 'high' | 'medium' | 'low' }> {
  // V2.2: route through the user's currently-active LLM config.
  // If user is set up for OpenAI-compatible (DeepSeek/Kimi/etc.), this uses that.
  const cfg = await requireLLMConfigById();
  const provider = cfg.provider;
  const model = cfg.modelId;
  const apiKey = cfg.apiKey;
  const baseURL = cfg.baseURL;

  const prompt = `下面是一个活动报名表单页面的开头文本。请从中抽取活动的关键背景信息。

【页面正文（前 8000 字）】
${bodyText}

【附加 meta 数据】
- 页面标题（通常是表单平台 boilerplate，仅供参考）: "${meta.pageTitle || ''}"
- og:title: "${meta.ogTitle || ''}"
- og:description: "${meta.ogDescription || ''}"
- og:site_name: "${meta.ogSiteName || ''}"

【任务】
提取以下信息，严格输出 JSON：
- name: 活动正式名称（如 "2026 WAIC OPC独立先锋挑战赛"，不要写表单平台名）
- theme: 活动主题或赛道（如 "AI Agent" / "智能制造" / "硬件" / "数字经济"），从正文里找
- organizer: 主办方/承办方名称（如 "HKU iCube" / "上海创业大赛组委会"）
- location: 城市或地区（如 "香港" / "上海" / "Online"）
- deadline: 截止/活动日期（ISO 8601 格式如 "2026-05-26"，没找到就 null）

【重要】
正文可能不完整或缺失关键信息。**如果你对某个字段不确定，请返回空字符串（或 deadline=null），不要猜测。**
错误的猜测比空值更糟糕——空值会让用户在 UI 上手动补全，而猜测会让用户带着错的信息往下走。

【输出格式】
{"name":"...","theme":"...","organizer":"...","location":"...","deadline":null}

任何不能从原文确定的字段写空字符串（或 deadline 用 null）。**不要编造**。不要解释，直接 JSON。`;

  // Provider-aware one-shot call. We use the same dispatcher as the main draft
  // generator so we automatically get 429 backoff + correct SDK routing.
  let text = '';
  if (provider === 'anthropic') {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey, timeout: 30_000, dangerouslyAllowBrowser: true });
    const resp = await client.messages.create({
      model,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
    text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  } else {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey, baseURL: baseURL!, timeout: 30_000, dangerouslyAllowBrowser: true });
    const resp = await client.chat.completions.create({
      model,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
    text = resp.choices[0]?.message?.content ?? '';
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON in response');
  const parsed = JSON.parse(m[0]) as { name?: string; theme?: string; organizer?: string; location?: string; deadline?: string | null };
  const name = parsed.name || '';
  const theme = parsed.theme || '';
  const organizer = parsed.organizer || '';
  const location = parsed.location || '';
  const deadline = parsed.deadline || null;
  // Compute confidence from "how many fields Claude actually populated."
  // Rationale: Claude was instructed to leave empty when unsure (see prompt),
  // so missing fields = Claude was honest about not knowing, not that the page
  // was unparseable. This is a coarse signal but doesn't require an extra API call.
  const populated = [name, theme, organizer, location, deadline].filter((v) => v && (typeof v !== 'string' || v.length > 0)).length;
  const confidence: 'high' | 'medium' | 'low' = populated >= 4 ? 'high' : populated >= 2 ? 'medium' : 'low';
  return { name, theme, organizer, location, deadline, confidence };
}

async function getScanMode(): Promise<ScanMode> {
  const settings = await db.appSettings.get('singleton');
  return settings?.scanMode ?? 'heuristic';
}

/**
 * V0.3.0 (PRD §10): mode-aware field scan.
 *   heuristic → original behaviour (single files-injection round-trip).
 *   hybrid/llm → files-injection mounts the window helpers, then a second func-injection runs
 *                __applyforge_tag_distill__ (tag + distill in-page), and scanHybrid runs the LLM
 *                pass + merge in the worker. `executeScript({files})` can't take args, so the mode
 *                signal stays in the worker and the in-page helper is parameterless (Method B).
 * Always returns a ScanResult { fields, meta }.
 */
async function scanFieldsOnTab(tabId: number, mode?: ScanMode): Promise<ScanResult> {
  const effectiveMode = mode ?? (await getScanMode());

  const [injected] = await chrome.scripting.executeScript({
    target: { tabId },
    files: ['/content-scripts/content.js'],
  });
  const heuristicFields = (injected?.result || []) as DetectedField[];

  if (effectiveMode === 'heuristic') {
    return {
      fields: heuristicFields,
      meta: { mode: 'heuristic', heuristicCount: heuristicFields.length, mergedCount: heuristicFields.length },
    };
  }

  // hybrid / llm need a configured model. Without one, degrade to the heuristic result
  // (the UI disables these modes when no model exists, but a stale tab-session could still ask).
  let llmConfig: SemanticLLMConfig;
  try {
    const cfg = await requireLLMConfigById();
    llmConfig = { provider: cfg.provider, apiKey: cfg.apiKey, modelId: cfg.modelId };
    if (cfg.baseURL) llmConfig.baseURL = cfg.baseURL;
  } catch (err) {
    return {
      fields: heuristicFields,
      meta: {
        mode: 'heuristic',
        heuristicCount: heuristicFields.length,
        mergedCount: heuristicFields.length,
        llmFallback: true,
        llmError: err instanceof Error ? err.message : String(err),
      },
    };
  }

  // Second injection: tag + distill. Helpers were mounted by the first (files) injection.
  const [td] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      // @ts-expect-error injected by content script
      return window.__applyforge_tag_distill__();
    },
  });
  const tagResult = (td?.result || { manifest: [], heuristicFields: [], url: '' }) as {
    manifest: ControlManifestEntry[];
    heuristicFields: DetectedField[];
    url: string;
  };

  return scanHybrid({
    url: tagResult.url,
    mode: effectiveMode,
    manifest: tagResult.manifest,
    heuristicFields: tagResult.heuristicFields,
    llmConfig,
  });
}

async function fillFieldsOnTab(
  tabId: number,
  fillMap: Record<string, string>,
  fileMap?: Record<string, string>, // selector → assetId
): Promise<{ filledCount: number; failedFields: string[] }> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (map: Record<string, string>) => {
      // @ts-expect-error injected by content script
      return window.__applyforge_fill__(map);
    },
    args: [fillMap],
  });
  const textResult = result?.result as { filledCount: number; failedFields: string[] } ?? { filledCount: 0, failedFields: [] };

  // File-input pass — fetch each asset's binary and inject via DataTransfer.
  // We do them sequentially (Chrome's executeScript is async and we want
  // deterministic error reporting per asset).
  if (fileMap && Object.keys(fileMap).length > 0) {
    let extraFilled = 0;
    const extraFailed: string[] = [];
    for (const [selector, assetId] of Object.entries(fileMap)) {
      try {
        const asset = await db.projectAssets.get(assetId);
        if (!asset) {
          extraFailed.push(selector);
          continue;
        }
        const bytes = await asset.blob.arrayBuffer();
        const [r] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel: string, b: ArrayBuffer, mime: string, name: string) => {
            // @ts-expect-error injected by content script
            return window.__applyforge_fill_file__(sel, b, mime, name);
          },
          args: [selector, bytes, asset.mimeType, asset.filename],
        });
        if (r?.result === true) extraFilled++;
        else extraFailed.push(selector);
      } catch (err) {
        console.error('[fill-file]', selector, err);
        extraFailed.push(selector);
      }
    }
    return {
      filledCount: textResult.filledCount + extraFilled,
      failedFields: [...textResult.failedFields, ...extraFailed],
    };
  }
  return textResult;
}

async function generateOneDraft(payload: {
  projectId: string;
  eventContextId: string;
  field: DetectedField;
  /** V2.2: which LLM config to use. */
  configId?: string;
  /** @deprecated V2.2 — legacy wire fields. */
  model?: string;
  /** @deprecated V2.2 — legacy wire fields. */
  provider?: 'anthropic' | 'openai-compatible';
  /** UX iteration 2026-06-01: optional user steering for a regenerate. */
  refinement?: string;
  streamId: string;
}): Promise<void> {
  const { streamId } = payload;
  try {
    // V2.2: resolve provider/key/baseURL/model from the named config. If the
    // sidepanel sent a configId (the V2.2 path), use it; otherwise fall back
    // to the default config (handles backward-compat for older sidepanel
    // builds that send model+provider but not configId — those fields are
    // ignored now; we just use the user's active default).
    const cfg = await requireLLMConfigById(payload.configId);

    const event = await db.eventContexts.get(payload.eventContextId);
    if (!event) throw new Error('Event context not found');
    const project = await db.projects.get(payload.projectId);

    // V0.4.0 KG: graph-aware retrieval ranks historical answers by how similar
    // their event was to THIS event (theme/organizer/type/location), so a
    // similar past competition's answers surface first. Docs unchanged.
    const query = [
      payload.field.label,
      payload.field.constraints.placeholder,
      payload.field.constraints.helperText,
    ].filter(Boolean).join(' · ');

    const { documentResults, qaResults } = await retrieveGraphAware({
      projectId: payload.projectId,
      currentEvent: event,
      query,
    });

    const result = await generateDraft({
      apiKey: cfg.apiKey,
      provider: cfg.provider,
      baseURL: cfg.baseURL ?? '',
      field: payload.field,
      event,
      projectChunks: documentResults.map((r) => r.chunk),
      qaChunks: qaResults.map((r) => r.chunk),
      model: cfg.modelId,
      ...(payload.refinement ? { refinement: payload.refinement } : {}),
      ...(project?.facts ? { projectFacts: project.facts } : {}),
      onToken: (tok) => broadcast({ kind: 'draft.token', streamId, token: tok }),
    });

    const refChunkIds = [...documentResults, ...qaResults].map((r) => r.chunk.id);
    const sims = [...documentResults, ...qaResults].map((r) => r.similarity);

    broadcast({
      kind: 'draft.done',
      streamId,
      text: result.text,
      modelUsed: result.modelUsed,
      retried: result.retried,
      ragRefs: { chunkIds: refChunkIds, similarities: sims },
    });
  } catch (err) {
    // Broadcast for the streaming-aware UI path, AND re-throw so the sendMessage
    // promise rejects too. Either channel is enough; we want both so a single
    // dropped broadcast (the sidepanel is closed, the SW just restarted, etc.)
    // can't leave the UI hung on "生成中...".
    const message = err instanceof Error ? err.message : String(err);
    broadcast({ kind: 'draft.error', streamId, message });
    throw err;
  }
}

/**
 * UX iteration 2026-05-24 (D): Batch draft generation handler.
 * UX iteration 2026-05-30: added transparent per-field FALLBACK.
 *
 * Flow:
 *   1. Resolve config + event + RAG context (hard failure → error all fields).
 *   2. Try ONE batched call. Broadcast draft.done for every field the batch
 *      returned successfully.
 *   3. FALLBACK: any field the batch couldn't produce (parse failure, missing
 *      key, or the batch call threw entirely) is regenerated INDIVIDUALLY via
 *      generateDraft (plain-text output, no JSON fragility). Only the failed
 *      subset falls back, so this can't "burst-fire" the whole form.
 *
 * Why the fallback: on a real form, 3 long-text fields batched together all
 * failed with "批量生成返回的 JSON 无法解析" (the model put raw newlines in a
 * multi-paragraph project intro, breaking the JSON). Per-field generation has
 * no JSON layer, so it always recovers. The user just sees a slightly slower
 * generation instead of three dead fields.
 */
async function generateBatchDrafts_handler(payload: {
  projectId: string;
  eventContextId: string;
  fields: DetectedField[];
  configId?: string;
  /** @deprecated V2.2. */
  model?: string;
  /** @deprecated V2.2. */
  provider?: 'anthropic' | 'openai-compatible';
  streamId: string;
}): Promise<void> {
  const { fields } = payload;
  if (fields.length === 0) return;

  // ---- Step 1: resolve config + event + RAG (unrecoverable if this fails) ----
  let cfg: Awaited<ReturnType<typeof requireLLMConfigById>>;
  let event: EventContext | undefined;
  let projectFacts: ProjectFacts | undefined;
  let projectChunks: Chunk[] = [];
  let qaChunks: Chunk[] = [];
  let refChunkIds: string[] = [];
  let sims: number[] = [];
  try {
    cfg = await requireLLMConfigById(payload.configId);
    event = await db.eventContexts.get(payload.eventContextId);
    if (!event) throw new Error('Event context not found');
    projectFacts = (await db.projects.get(payload.projectId))?.facts;
    const query = fields
      .map((f) => [f.label, f.constraints.placeholder, f.constraints.helperText].filter(Boolean).join(' '))
      .join(' · ');
    const { documentResults, qaResults } = await retrieveGraphAware({ projectId: payload.projectId, currentEvent: event, query });
    projectChunks = documentResults.map((r) => r.chunk);
    qaChunks = qaResults.map((r) => r.chunk);
    refChunkIds = [...documentResults, ...qaResults].map((r) => r.chunk.id);
    sims = [...documentResults, ...qaResults].map((r) => r.similarity);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const f of fields) broadcast({ kind: 'draft.error', streamId: f.fieldId, message });
    return;
  }

  // ---- Step 2: try the batched call; broadcast what it produced ----
  const drafts: Record<string, string> = {};
  let batchModelUsed = cfg.modelId;
  try {
    const result = await generateBatchDrafts({
      apiKey: cfg.apiKey,
      provider: cfg.provider,
      baseURL: cfg.baseURL ?? '',
      fields,
      event,
      projectChunks,
      qaChunks,
      model: cfg.modelId,
      ...(projectFacts ? { projectFacts } : {}),
    });
    batchModelUsed = result.modelUsed;
    Object.assign(drafts, result.drafts);
    for (const f of fields) {
      if (drafts[f.fieldId] !== undefined) {
        broadcast({
          kind: 'draft.done',
          streamId: f.fieldId,
          text: drafts[f.fieldId]!,
          modelUsed: batchModelUsed,
          retried: false,
          ragRefs: { chunkIds: refChunkIds, similarities: sims },
        });
      }
    }
  } catch (err) {
    // Batch threw entirely (parse-null, network, etc.) — every field falls
    // back below. Not fatal; just log.
    console.warn('[batch] failed, falling back to per-field:', err);
  }

  // ---- Step 3: per-field fallback for anything the batch didn't produce ----
  const missing = fields.filter((f) => drafts[f.fieldId] === undefined);
  for (const f of missing) {
    try {
      const single = await generateDraft({
        apiKey: cfg.apiKey,
        provider: cfg.provider,
        baseURL: cfg.baseURL ?? '',
        field: f,
        event,
        projectChunks,
        qaChunks,
        model: cfg.modelId,
        onToken: (tok) => broadcast({ kind: 'draft.token', streamId: f.fieldId, token: tok }),
      });
      broadcast({
        kind: 'draft.done',
        streamId: f.fieldId,
        text: single.text,
        modelUsed: single.modelUsed,
        retried: single.retried,
        ragRefs: { chunkIds: refChunkIds, similarities: sims },
      });
    } catch (err) {
      broadcast({
        kind: 'draft.error',
        streamId: f.fieldId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function markRecordSubmitted(qaRecordId: string): Promise<{ markdownPath: string; ragChunksCreated: number }> {
  const record = await db.qaRecords.get(qaRecordId);
  if (!record) throw new Error('QA record not found');
  const project = await db.projects.get(record.projectId);
  if (!project) throw new Error('Project not found');
  const event = await db.eventContexts.get(record.eventContextId);
  if (!event) throw new Error('Event context not found');

  const markdown = buildMarkdown(record, project, event);
  const filename = buildFilename(project.name, event.name);

  // MV3 service workers do NOT have URL.createObjectURL (it's a DOM-only API
  // — the SW has no window/document). Use a base64 data URL instead, which
  // chrome.downloads.download accepts and is supported in the SW context.
  // We hand-roll UTF-8 → base64 since btoa() chokes on multi-byte strings
  // (Chinese chars), and spreading a Uint8Array into String.fromCharCode can
  // overflow the call stack on large blobs.
  const utf8 = new TextEncoder().encode(markdown);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < utf8.length; i += CHUNK) {
    binary += String.fromCharCode(...utf8.subarray(i, i + CHUNK));
  }
  const dataUrl = `data:text/markdown;charset=utf-8;base64,${btoa(binary)}`;
  await chrome.downloads.download({
    url: dataUrl,
    filename: `applyforge/${slugify(project.name)}/${filename}`,
    saveAs: false,
  });

  // Index each Q&A as a chunk so it shows up in future draft generation. V1
  // skips embedding — Sonnet's 200K context fits the full corpus comfortably.
  // V0.4.0 KG + PRIVACY: seed each Q&A as a chunk for future retrieval, baking
  // the full event identity (主办方 / 地点 / 主题 / 类型) into the text AND the
  // structured metadata (eventContextId / personIds = the graph edge).
  // CRITICAL: personal/OTP answers are NEVER seeded — that would leak the user's
  // real phone/email/ID into every future draft prompt (Code GAN 2026-06-24).
  // They remain in the QARecord + downloaded markdown (local only).
  const seedable = record.qaPairs.filter(isSeedableQaPair);
  const newChunks: Chunk[] = seedable.map((qa, i) => {
    const text = buildQaChunkText(qa, event);
    return {
      id: uuid(),
      sourceType: 'qa',
      sourceId: record.id,
      projectId: record.projectId,
      text,
      embedding: new Float32Array(0),
      embeddingModel: 'none',
      tokenCount: approxTokenCount(text),
      excludedFromRag: false,
      createdAt: Date.now(),
      metadata: {
        qaIndex: i,
        fieldId: qa.fieldId,
        fieldLabel: qa.fieldLabel,
        eventContextId: record.eventContextId,
        eventType: event.eventType ?? null,
        personIds: record.personIds ?? [],
      },
    };
  });
  if (newChunks.length) await db.chunks.bulkAdd(newChunks);

  const markdownPath = `applyforge/${slugify(project.name)}/${filename}`;
  await db.qaRecords.update(qaRecordId, {
    status: 'submitted',
    submittedAt: Date.now(),
    markdownPath,
  });
  await db.projects.update(record.projectId, {
    applicationCount: project.applicationCount + 1,
    updatedAt: Date.now(),
  });

  return { markdownPath, ragChunksCreated: newChunks.length };
}

/**
 * Decide which uploaded project asset (if any) should go into each file
 * field on the form. Uses Claude with a strict JSON-output prompt — we pass
 * field labels + accept attribute, plus all the user's assets, and Claude
 * returns a mapping. Falls back to keyword matching if Claude is unreachable.
 */
async function matchAssetsToFields(args: {
  projectId: string;
  fields: { fieldId: string; label: string; accept: string }[];
}): Promise<{ matches: { fieldId: string; assetId: string | null; reason: string }[] }> {
  const assets = await db.projectAssets.where('projectId').equals(args.projectId).toArray();
  if (!assets.length || !args.fields.length) {
    return { matches: args.fields.map((f) => ({ fieldId: f.fieldId, assetId: null, reason: '没有可用资产' })) };
  }

  const assetList = assets.map((a) => ({ id: a.id, filename: a.filename, mime: a.mimeType, tag: a.tag, notes: a.notes ?? '' }));
  const fieldList = args.fields.map((f, i) => ({ index: i, fieldId: f.fieldId, label: f.label, accept: f.accept }));

  // Local keyword pre-pass — Claude is usually overkill for the common case
  // (logo, photo, pitch). Try the cheap path first, fall back to Claude only
  // for ambiguous fields.
  const localMatches = keywordMatchAssets(fieldList, assetList);
  const unresolved = localMatches.filter((m) => m.assetId === null && acceptCompatibleAssets(args.fields[m.index]!.accept, assets).length > 0);

  if (unresolved.length === 0) {
    return { matches: localMatches.map((m) => ({ fieldId: m.fieldId, assetId: m.assetId, reason: m.reason })) };
  }

  // Some fields had no confident keyword hit but DO have compatible assets —
  // ask the LLM to disambiguate. Single call routed through the user's
  // currently-active LLM config (V2.2).
  try {
    const cfg = await requireLLMConfigById();
    const aiMatches = await askLLMForAssetMatches(cfg.apiKey, cfg.provider, cfg.baseURL, cfg.modelId, fieldList, assetList);
    // Merge: prefer local match where confident, override null-locals with AI.
    return { matches: localMatches.map((m) => {
      const ai = aiMatches.find((x) => x.fieldId === m.fieldId);
      if (m.assetId) return m;
      if (ai && ai.assetId) return ai;
      return m;
    })};
  } catch (err) {
    console.warn('[assets] LLM match failed, falling back to keyword-only:', err);
    return { matches: localMatches.map((m) => ({ fieldId: m.fieldId, assetId: m.assetId, reason: m.reason })) };
  }
}

function normalizeModelIdLocal(model: string): string {
  if (model === 'sonnet-4.5') return 'claude-sonnet-4-5';
  if (model === 'haiku-3.5') return 'claude-haiku-4-5';
  return model;
}

function acceptCompatibleAssets(accept: string, assets: { mimeType: string }[]): { mimeType: string }[] {
  if (!accept) return assets; // no filter
  const tokens = accept.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  return assets.filter((a) => tokens.some((t) => {
    if (t.endsWith('/*')) return a.mimeType.toLowerCase().startsWith(t.slice(0, -1));
    return a.mimeType.toLowerCase() === t;
  }));
}

function keywordMatchAssets(
  fields: { index: number; fieldId: string; label: string; accept: string }[],
  assets: { id: string; filename: string; mime: string; tag: string }[],
): { index: number; fieldId: string; assetId: string | null; reason: string }[] {
  return fields.map((f) => {
    const label = f.label.toLowerCase();
    const compatible = acceptCompatibleAssets(f.accept, assets.map((a) => ({ mimeType: a.mime })));
    const compatibleIds = new Set(assets.filter((a) => compatible.some((c) => c.mimeType === a.mime)).map((a) => a.id));
    const compatibleAssets = assets.filter((a) => compatibleIds.has(a.id));

    // Tag-based keyword rules
    const wants =
      /logo|标志|标识/.test(label) ? 'logo' :
      /(照片|图片|photo|image|picture|screenshot)/.test(label) ? 'photo' :
      /(文案|计划书|pitch|deck|ppt|pdf|bp|proposal|商业计划)/.test(label) ? 'pitch' :
      null;
    if (wants) {
      const byTag = compatibleAssets.filter((a) => a.tag === wants);
      if (byTag.length === 1) return { index: f.index, fieldId: f.fieldId, assetId: byTag[0]!.id, reason: `按"${wants}"标签匹配` };
      if (byTag.length > 1) return { index: f.index, fieldId: f.fieldId, assetId: byTag[0]!.id, reason: `多个 "${wants}" 资产，选了第一个` };
    }
    // Single compatible asset and no obvious tag — pick it
    if (compatibleAssets.length === 1) return { index: f.index, fieldId: f.fieldId, assetId: compatibleAssets[0]!.id, reason: '唯一类型兼容资产' };
    return { index: f.index, fieldId: f.fieldId, assetId: null, reason: '需要进一步判断' };
  });
}

/**
 * V2.1: provider-aware asset matching. Calls Anthropic or OpenAI-compatible
 * depending on user's configured defaultModelProvider. Lazy-imports the SDK
 * so the popup/options bundles don't drag both in.
 */
async function askLLMForAssetMatches(
  apiKey: string,
  provider: 'anthropic' | 'openai-compatible',
  baseURL: string | undefined,
  model: string,
  fields: { index: number; fieldId: string; label: string; accept: string }[],
  assets: { id: string; filename: string; mime: string; tag: string }[],
): Promise<{ fieldId: string; assetId: string | null; reason: string }[]> {
  const prompt = `这是一个文件字段-资产匹配任务。

【表单上的文件字段】
${fields.map((f) => `${f.index}: label="${f.label}" accept="${f.accept || '(任意)'}"`).join('\n')}

【用户上传的项目资产】
${assets.map((a, i) => `${i}: id="${a.id}" filename="${a.filename}" mime="${a.mime}" tag="${a.tag}"`).join('\n')}

为每个字段挑一个最合适的资产 id，或者 null（如果没合适的）。
严格输出 JSON：{"matches":[{"fieldId":"...","assetId":"..."|null,"reason":"短理由"}]}
不要解释。`;

  let text = '';
  if (provider === 'anthropic') {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey, timeout: 30_000, dangerouslyAllowBrowser: true });
    const resp = await client.messages.create({
      model,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
    text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  } else {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey, baseURL: baseURL ?? '', timeout: 30_000, dangerouslyAllowBrowser: true });
    const resp = await client.chat.completions.create({
      model,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
    text = resp.choices[0]?.message?.content ?? '';
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON in response');
  const parsed = JSON.parse(m[0]) as { matches: { fieldId: string; assetId: string | null; reason: string }[] };
  return parsed.matches ?? [];
}

/**
 * Export the entire local database into a single JSON string. Includes
 * every table (projects, documents, chunks, eventContexts, qaRecords,
 * projectAssets, appSettings).
 *
 * Binary blobs (project asset files, document raw text) are kept inline:
 *   - asset.blob → base64 string
 *   - Float32Array embeddings → array of numbers (V1 stores empty arrays
 *     since we don't embed, but we keep the structure compatible)
 *
 * AppSettings keys remain encrypted exactly as stored; the master password
 * is needed at restore time to unlock them again. We never put plaintext
 * keys in the backup file.
 *
 * Returns { json, sizeBytes } so the UI can show "Save 4.2 MB backup".
 */
async function exportBackup(): Promise<{ json: string; sizeBytes: number; counts: Record<string, number> }> {
  const [projects, documents, chunks, eventContexts, qaRecords, projectAssets, appSettings, persons] = await Promise.all([
    db.projects.toArray(),
    db.documents.toArray(),
    db.chunks.toArray(),
    db.eventContexts.toArray(),
    db.qaRecords.toArray(),
    db.projectAssets.toArray(),
    db.appSettings.toArray(),
    db.persons.toArray(),
  ]);

  // Convert each asset.blob (Blob) to base64. Done sequentially to avoid
  // peak-memory spikes on large galleries.
  const serializedAssets: ({
    id: string;
    projectId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    tag: string;
    notes?: string | undefined;
    createdAt: number;
    blobBase64: string;
  })[] = [];
  for (const a of projectAssets) {
    const buf = await a.blob.arrayBuffer();
    serializedAssets.push({
      id: a.id, projectId: a.projectId, filename: a.filename,
      mimeType: a.mimeType, sizeBytes: a.sizeBytes, tag: a.tag,
      notes: a.notes, createdAt: a.createdAt,
      blobBase64: arrayBufferToBase64(buf),
    });
  }

  const dump = {
    // v2 (V0.4.0): adds the `persons` table. Import still accepts v1 backups
    // (persons simply absent → restored as an empty table).
    formatVersion: 2,
    exportedAt: new Date().toISOString(),
    appVersion: '0.1.0',
    counts: {
      projects: projects.length,
      documents: documents.length,
      chunks: chunks.length,
      eventContexts: eventContexts.length,
      qaRecords: qaRecords.length,
      projectAssets: projectAssets.length,
      appSettings: appSettings.length,
      persons: persons.length,
    },
    tables: {
      projects,
      documents,
      // chunks: serialize Float32Array embeddings as plain arrays for JSON
      chunks: chunks.map((c) => ({
        ...c,
        embedding: Array.from(c.embedding ?? []),
      })),
      eventContexts,
      qaRecords,
      projectAssets: serializedAssets,
      appSettings,
      persons,
    },
  };

  const json = JSON.stringify(dump, null, 2);
  return { json, sizeBytes: json.length, counts: dump.counts };
}

/**
 * Restore a previously-exported backup. Destructive: clears every table
 * first, then re-inserts from the JSON. Caller (UI) is responsible for
 * confirming with the user before running this.
 */
async function importBackup(jsonText: string): Promise<{ counts: Record<string, number> }> {
  type ChunkRow = { embedding: number[] } & Record<string, unknown>;
  const dump = JSON.parse(jsonText) as {
    formatVersion: number;
    tables: {
      projects: unknown[];
      documents: unknown[];
      chunks: ChunkRow[];
      eventContexts: unknown[];
      qaRecords: unknown[];
      projectAssets: { id: string; projectId: string; filename: string; mimeType: string; sizeBytes: number; tag: string; notes?: string; createdAt: number; blobBase64: string }[];
      appSettings: unknown[];
      /** V0.4.0 (formatVersion 2). Absent in v1 backups → restored as empty. */
      persons?: unknown[];
    };
  };

  if (dump.formatVersion !== 1 && dump.formatVersion !== 2) {
    throw new Error(`Unsupported backup format version: ${dump.formatVersion}`);
  }
  const persons = dump.tables.persons ?? [];

  // Rebuild blobs from base64 + restore Float32Array embeddings.
  const assets = dump.tables.projectAssets.map((a) => ({
    id: a.id,
    projectId: a.projectId,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    tag: a.tag as 'photo' | 'logo' | 'pitch',
    notes: a.notes,
    createdAt: a.createdAt,
    blob: new Blob([base64ToArrayBuffer(a.blobBase64)], { type: a.mimeType }),
  }));
  const chunks = dump.tables.chunks.map((c) => ({
    ...c,
    embedding: new Float32Array(c.embedding ?? []),
  })) as unknown as Parameters<typeof db.chunks.bulkAdd>[0];

  await db.transaction('rw',
    [db.projects, db.documents, db.chunks, db.eventContexts, db.qaRecords, db.projectAssets, db.appSettings, db.persons],
    async () => {
      // Clear everything first — restore is destructive.
      await Promise.all([
        db.projects.clear(),
        db.documents.clear(),
        db.chunks.clear(),
        db.eventContexts.clear(),
        db.qaRecords.clear(),
        db.projectAssets.clear(),
        db.appSettings.clear(),
        db.persons.clear(),
      ]);
      // Bulk-restore. Order isn't load-bearing since we cleared first.
      // Cast to any for the tables that hold complex structured types
      // (Float32Array, Blob, etc.) — Dexie handles these natively at runtime
      // but the typed table interface doesn't accept loosely-typed arrays.
      await db.projects.bulkAdd(dump.tables.projects as Parameters<typeof db.projects.bulkAdd>[0]);
      await db.documents.bulkAdd(dump.tables.documents as Parameters<typeof db.documents.bulkAdd>[0]);
      await db.chunks.bulkAdd(chunks);
      await db.eventContexts.bulkAdd(dump.tables.eventContexts as Parameters<typeof db.eventContexts.bulkAdd>[0]);
      await db.qaRecords.bulkAdd(dump.tables.qaRecords as Parameters<typeof db.qaRecords.bulkAdd>[0]);
      await db.projectAssets.bulkAdd(assets);
      await db.appSettings.bulkAdd(dump.tables.appSettings as Parameters<typeof db.appSettings.bulkAdd>[0]);
      await db.persons.bulkAdd(persons as Parameters<typeof db.persons.bulkAdd>[0]);
    });

  return {
    counts: {
      projects: dump.tables.projects.length,
      documents: dump.tables.documents.length,
      chunks: chunks.length,
      eventContexts: dump.tables.eventContexts.length,
      qaRecords: dump.tables.qaRecords.length,
      projectAssets: assets.length,
      appSettings: dump.tables.appSettings.length,
      persons: persons.length,
    },
  };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function toggleQAExclusion(args: { qaRecordId: string; fieldId: string; excluded: boolean }) {
  // Find the QA chunk associated with this record+field, flip excludedFromRag.
  const chunks = await db.chunks
    .where('sourceId').equals(args.qaRecordId)
    .filter((c) => c.metadata && (c.metadata as { fieldId?: string }).fieldId === args.fieldId)
    .toArray();
  await Promise.all(chunks.map((c) => db.chunks.update(c.id, { excludedFromRag: args.excluded })));
  return { ok: true, affected: chunks.length };
}

// -------- Settings / key management --------

async function requireAnthropicKey(): Promise<string> {
  // Belt-and-suspenders: if the SW just restarted and the top-level
  // restoreSessionKey() hasn't finished yet, await it here before checking.
  await restoreSessionKey();
  const settings = await db.appSettings.get('singleton');
  if (!settings) throw new Error('Settings not configured. Please complete onboarding.');
  if (!settings.encryptedAnthropicKey) {
    throw new Error('Anthropic API Key 未配置。请去设置里填好，或在 sidepanel 改用 OpenAI-Compatible Provider。');
  }
  const sessionKey = getSessionKey();
  if (!sessionKey) throw new Error('Settings locked. Please unlock with master password.');
  return decryptString(settings.encryptedAnthropicKey.split('::')[0]!, settings.encryptedAnthropicKey.split('::')[1]!, sessionKey);
}

/**
 * V2.2: resolve a fully-fledged LLM config by id. Returns everything the
 * dispatcher needs: provider / apiKey / baseURL / modelId / displayName.
 *
 * When `configId` is omitted, falls back to the current default config (the
 * one with isDefault=true). Throws clearly if no configs exist yet (fresh
 * install) or the requested id was deleted.
 */
async function requireLLMConfigById(configId?: string): Promise<{
  configId: string;
  displayName: string;
  provider: 'anthropic' | 'openai-compatible';
  modelId: string;
  baseURL?: string;
  apiKey: string;
}> {
  await restoreSessionKey();
  const settings = await db.appSettings.get('singleton');
  if (!settings) throw new Error('Settings not configured. Please complete onboarding.');
  const configs = settings.llmConfigs ?? [];
  if (configs.length === 0) {
    throw new Error('还没添加任何 AI 模型。请去 设置 页底部"添加新模型"。');
  }
  const target = configId
    ? configs.find((c) => c.id === configId)
    : configs.find((c) => c.isDefault) ?? configs[0];
  if (!target) {
    throw new Error(`指定的模型配置 (${configId}) 不存在；可能已被删除。请回 sidepanel 重新选择一个。`);
  }
  if (!target.encryptedKey) {
    throw new Error(`模型 "${target.displayName}" 缺少 API key 密文。请去 设置 删除后重新添加。`);
  }
  const sessionKey = getSessionKey();
  if (!sessionKey) throw new Error('Settings locked. Please unlock with master password.');
  const [ct, iv] = target.encryptedKey.split('::');
  if (!ct || !iv) throw new Error(`模型 "${target.displayName}" 的密文格式损坏，请删除后重新添加。`);
  const apiKey = await decryptString(ct, iv, sessionKey);
  const out: {
    configId: string;
    displayName: string;
    provider: 'anthropic' | 'openai-compatible';
    modelId: string;
    baseURL?: string;
    apiKey: string;
  } = {
    configId: target.id,
    displayName: target.displayName,
    provider: target.provider,
    modelId: target.modelId,
    apiKey,
  };
  if (target.baseURL) out.baseURL = target.baseURL;
  return out;
}

/** @deprecated V2.2: use requireLLMConfigById. Kept for back-compat with legacy code paths that haven't been migrated yet. */
async function requireLLMConfig(_provider: 'anthropic' | 'openai-compatible'): Promise<{ apiKey: string; baseURL?: string }> {
  const cfg = await requireLLMConfigById();
  const out: { apiKey: string; baseURL?: string } = { apiKey: cfg.apiKey };
  if (cfg.baseURL) out.baseURL = cfg.baseURL;
  return out;
}

async function unlockSettings(masterPassword: string): Promise<{ ok: boolean }> {
  const settings = await db.appSettings.get('singleton');
  if (!settings) throw new Error('No settings yet — run onboarding first');
  const key = await deriveKey(masterPassword, settings.keyDerivationSalt);
  // Verify the password by decrypting a key that ACTUALLY EXISTS. V2.2+ stores
  // keys in llmConfigs[].encryptedKey; the legacy encryptedAnthropicKey is ''
  // for configs-only installs — verifying it alone threw for every password,
  // even the correct one ("Wrong master password" bug, 2026-06-28).
  const targets = collectUnlockVerificationTargets(settings);
  if (targets.length === 0) {
    // No encrypted key stored yet → nothing to verify against. Accept the
    // derived key; the next encrypt adopts this password. It can't be "wrong"
    // when there's no ciphertext it must decrypt.
    setSessionKey(key);
    return { ok: true };
  }
  // Try every stored key: configs can be encrypted under different passwords
  // (addLLMConfig doesn't enforce a single one), so the correct password might
  // only match one of them. Unlock if it decrypts ANY.
  for (const target of targets) {
    try {
      const [ciphertext, iv] = target.split('::');
      await decryptString(ciphertext!, iv!, key);
      setSessionKey(key);
      return { ok: true };
    } catch {
      // This config wasn't encrypted with this password — try the next.
    }
  }
  // Matched none → wrong AES-GCM key for every stored ciphertext. Rejected.
  throw new Error('Wrong master password');
}

async function saveSettings(args: { patch: Partial<AppSettings>; plainKeys?: { anthropic?: string; openai?: string; openaiCompat?: string; masterPassword?: string } }) {
  let existing = await db.appSettings.get('singleton');
  if (!existing) {
    existing = {
      id: 'singleton',
      // V2.2: primary config storage. Fresh install starts empty — the
      // Settings UI will prompt the user to add their first config.
      llmConfigs: [],
      // V2.1 deprecated fields kept for back-compat / type completeness:
      encryptedAnthropicKey: '',
      encryptedOpenAIKey: '',
      encryptedOpenAICompatKey: '',
      openaiCompatBaseUrl: '',
      keyDerivationSalt: newSalt(),
      keyDerivationIterations: SECURE_STORAGE_CONFIG.ITERATIONS,
      defaultModel: 'claude-sonnet-4-5',
      defaultModelProvider: 'anthropic',
      fallbackModel: null,
      language: 'zh-CN',
      theme: 'auto',
      vaultDirectory: null,
      embeddingProvider: 'openai',
      embeddingDimension: 1536,
    };
  }

  const merged: AppSettings = { ...existing, ...args.patch };

  if (args.plainKeys?.masterPassword) {
    const key = await deriveKey(args.plainKeys.masterPassword, merged.keyDerivationSalt);
    setSessionKey(key);

    if (args.plainKeys.anthropic) {
      const enc = await encryptString(args.plainKeys.anthropic, key);
      merged.encryptedAnthropicKey = `${enc.ciphertext}::${enc.iv}`;
    }
    if (args.plainKeys.openai) {
      const enc = await encryptString(args.plainKeys.openai, key);
      merged.encryptedOpenAIKey = `${enc.ciphertext}::${enc.iv}`;
    }
    if (args.plainKeys.openaiCompat) {
      // V2.1 — encrypt the OpenAI-compatible key (used for DeepSeek / Moonshot /
      // GLM / etc.). Same encryption scheme as the Anthropic key; users only
      // need their master password to decrypt either.
      const enc = await encryptString(args.plainKeys.openaiCompat, key);
      merged.encryptedOpenAICompatKey = `${enc.ciphertext}::${enc.iv}`;
    }
  }

  await db.appSettings.put(merged);
  return merged;
}

// =============================================================================
// V2.2: LLM configuration library — add / delete / setActive
// -----------------------------------------------------------------------------
// Each operation reads the singleton settings, mutates the llmConfigs array,
// and writes back. Encryption happens in addLLMConfig (which needs the master
// password to derive the AES key). delete + setActive don't touch keys, so
// they can be called without unlocking.
// =============================================================================

async function addLLMConfig(payload: {
  displayName: string;
  provider: 'anthropic' | 'openai-compatible';
  modelId: string;
  baseURL?: string;
  plainKey: string;
  masterPassword: string;
  setAsDefault?: boolean;
}): Promise<{ id: string; configs: AppSettings['llmConfigs'] }> {
  // Sanity-check inputs early so we don't half-mutate state on bad input.
  if (!payload.displayName?.trim()) throw new Error('displayName 不能为空');
  if (!payload.modelId?.trim()) throw new Error('modelId 不能为空');
  if (!payload.plainKey?.trim()) throw new Error('API key 不能为空');
  if (payload.provider === 'openai-compatible' && !payload.baseURL?.trim()) {
    throw new Error('OpenAI-Compatible Provider 必须填 Base URL');
  }
  if (!payload.masterPassword) throw new Error('主密码必填，用于加密 API key');

  let settings = await db.appSettings.get('singleton');
  if (!settings) {
    // Fresh install — create the singleton with sensible defaults.
    settings = {
      id: 'singleton',
      llmConfigs: [],
      encryptedAnthropicKey: '',
      encryptedOpenAIKey: '',
      encryptedOpenAICompatKey: '',
      openaiCompatBaseUrl: '',
      keyDerivationSalt: newSalt(),
      keyDerivationIterations: SECURE_STORAGE_CONFIG.ITERATIONS,
      defaultModel: 'claude-sonnet-4-5',
      defaultModelProvider: 'anthropic',
      fallbackModel: null,
      language: 'zh-CN',
      theme: 'auto',
      vaultDirectory: null,
      embeddingProvider: 'openai',
      embeddingDimension: 1536,
    };
  }

  // Derive encryption key from master password + salt; cache in session so the
  // user doesn't have to re-enter for subsequent ops within the same hour.
  const key = await deriveKey(payload.masterPassword, settings.keyDerivationSalt);
  setSessionKey(key);

  // If the user has any existing configs, the password must DECRYPT one of
  // them successfully — otherwise this is a wrong password and we'd be
  // re-encrypting the new key with a key nobody else can decrypt. Verify by
  // attempting to decrypt the first config's key.
  const existing = settings.llmConfigs ?? [];
  if (existing.length > 0 && existing[0]?.encryptedKey) {
    try {
      const [ct, iv] = existing[0].encryptedKey.split('::');
      if (!ct || !iv) throw new Error('既有 config 密文格式损坏');
      await decryptString(ct, iv, key);
    } catch {
      throw new Error('主密码错误（与之前添加 config 时用的密码不一致）');
    }
  }

  const enc = await encryptString(payload.plainKey.trim(), key);
  const id = `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const setAsDefault = payload.setAsDefault !== false; // default true
  // If this becomes the new default, clear existing isDefault flags.
  const updatedConfigs = existing.map((c) => (setAsDefault ? { ...c, isDefault: false } : c));
  const baseURL = payload.baseURL?.trim();
  const newConfig: LLMConfig = {
    id,
    displayName: payload.displayName.trim(),
    provider: payload.provider,
    modelId: payload.modelId.trim(),
    ...(baseURL ? { baseURL } : {}),
    encryptedKey: `${enc.ciphertext}::${enc.iv}`,
    isDefault: setAsDefault || existing.length === 0, // first config is always default
    createdAt: Date.now(),
  };
  updatedConfigs.push(newConfig);

  const merged: AppSettings = { ...settings, llmConfigs: updatedConfigs };
  await db.appSettings.put(merged);
  return { id, configs: updatedConfigs };
}

async function deleteLLMConfig(id: string): Promise<{ configs: AppSettings['llmConfigs'] }> {
  const settings = await db.appSettings.get('singleton');
  if (!settings) throw new Error('Settings not configured');
  const existing = settings.llmConfigs ?? [];
  const target = existing.find((c) => c.id === id);
  if (!target) throw new Error(`Config ${id} 不存在`);

  let updated = existing.filter((c) => c.id !== id);
  // If we just removed the default, promote the first remaining one.
  if (target.isDefault && updated.length > 0) {
    updated = updated.map((c, i) => ({ ...c, isDefault: i === 0 }));
  }
  await db.appSettings.put({ ...settings, llmConfigs: updated });
  return { configs: updated };
}

async function setActiveLLMConfig(id: string): Promise<{ configs: AppSettings['llmConfigs'] }> {
  const settings = await db.appSettings.get('singleton');
  if (!settings) throw new Error('Settings not configured');
  const existing = settings.llmConfigs ?? [];
  if (!existing.some((c) => c.id === id)) {
    throw new Error(`Config ${id} 不存在`);
  }
  const updated = existing.map((c) => ({ ...c, isDefault: c.id === id }));
  await db.appSettings.put({ ...settings, llmConfigs: updated });
  return { configs: updated };
}

// -------- Broadcast helper --------

function broadcast(ev: StreamingEvent): void {
  chrome.runtime.sendMessage(ev).catch(() => {/* no listeners is fine */});
}
