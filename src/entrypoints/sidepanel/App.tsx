// Side Panel — the main filling workspace.
// 3-step UX: confirm event context → review/edit AI drafts → submit & persist.
// See 04-ui-context.md for full UX spec.

import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { v4 as uuid } from 'uuid';
import {
  Flame,
  Lock,
  Clock,
  Pencil,
  Check,
  X as XIcon,
  AlertTriangle,
  RefreshCw,
  MessageCircle,
  Paperclip,
  PartyPopper,
  Download,
  ArrowRight,
  FolderOpen,
  Info,
  BarChart2,
  Sparkles,
} from 'lucide-react';
import { db } from '@/lib/db/schema';
import type {
  DetectedField,
  EventContext,
  Project,
  QAPair,
  QARecord,
  UserAction,
} from '@/lib/db/types';
import { AsyncButton } from '@/components/AsyncButton';
import { useToast } from '@/components/ErrorToast';
import { FieldExplainer } from '@/components/FieldExplainer';
import { useTabSessionState } from '@/lib/state/session-state';
import type { LLMConfig } from '@/lib/db/types';
import type { ScanResult, ScanResultMeta } from '@/lib/fields/semantic/types';

type Step = 'project' | 'context' | 'draft' | 'submitted';

export function SidePanelApp() {
  const projects = useLiveQuery(() => db.projects.toArray(), []) ?? [];
  const toast = useToast();
  // These four states are now persisted to chrome.storage.session keyed by
  // tabId — so closing/reopening the sidepanel (or switching tabs and back)
  // no longer wipes the user's in-flight workflow. See lib/state/session-state.ts
  // and 05a-ux-design.md §B.0. The setters keep the same useState-shaped
  // signature; the only behavioral diff is that initial mount renders the
  // defaultValue for one tick before async-hydrating from storage.
  const [step, setStep] = useTabSessionState<Step>('sidepanel.step', 'project');
  const [projectId, setProjectId] = useTabSessionState<string | null>('sidepanel.projectId', null);
  const [eventDraft, setEventDraft] = useTabSessionState<Partial<EventContext> | null>('sidepanel.eventDraft', null);
  const [fields, setFields] = useTabSessionState<DetectedField[]>('sidepanel.fields', []);
  // V0.3.0: recall / fallback metadata from the last scan (drives the recall bar + notices).
  const [scanMeta, setScanMeta] = useTabSessionState<ScanResultMeta | null>('sidepanel.scanMeta', null);
  const [qaPairs, setQaPairs] = useTabSessionState<Record<string, QAPair>>('sidepanel.qaPairs', {});
  // streamingDrafts / draftErrors / fieldState are truly transient — only
  // meaningful while a generation is mid-flight. Persisting them would just
  // confuse the user with stale "generating..." labels on reopen.
  const [streamingDrafts, setStreamingDrafts] = useState<Record<string, string>>({});
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  // Wire-level Anthropic model ID for this session.
  //
  // UX iteration 2026-05-23 (T10): previous version had a "seededFromSettings"
  // gate that protected against settings re-seeding mid-session, but there was
  // a startup race: if the user picked a model BEFORE settings useLiveQuery
  // resolved, the subsequent settings load would overwrite their choice. The
  // fix: persist the active session choice in tabSession (chrome.storage.session)
  // so model survives sidepanel reopen + is the authoritative source while
  // active. db.appSettings.defaultModel still gets written as the long-lived
  // default (consulted on next browser session).
  const settings = useLiveQuery(() => db.appSettings.get('singleton'), []);
  // V2.2: sidepanel's active LLM config is identified by id (referencing
  // an entry in settings.llmConfigs). Stored in tabSession so a sidepanel
  // reopen preserves the user's last selection. null = "use the global default".
  const [sessionConfigId, setSessionConfigId] = useTabSessionState<string | null>('sidepanel.configId', null);

  // Resolve the active config: explicit session pick → global default → first config.
  const llmConfigs: LLMConfig[] = useMemo(() => settings?.llmConfigs ?? [], [settings?.llmConfigs]);
  const activeConfig: LLMConfig | undefined = useMemo(() => {
    if (sessionConfigId) {
      const m = llmConfigs.find((c) => c.id === sessionConfigId);
      if (m) return m;
      // The previously-selected config was deleted — fall through to default.
    }
    return llmConfigs.find((c) => c.isDefault) ?? llmConfigs[0];
  }, [sessionConfigId, llmConfigs]);

  const activeConfigId = activeConfig?.id ?? '';
  const [fillStatus, setFillStatus] = useState<Record<string, 'success' | 'failed'>>({});
  const [submittedMarkdownPath, setSubmittedMarkdownPath] = useState<string | null>(null);
  // When generation fails with "Settings locked" we show an inline unlock card
  // instead of plain error text. lockedFields tells us which fields are waiting
  // for the unlock to complete so we can auto-retry them.
  const [lockedFields, setLockedFields] = useState<string[]>([]);
  // Per-field state machine so the UI can show "queued" / "generating" /
  // "done" / "error" even when the underlying message round-trip is slow.
  // Before this existed, a stuck generation showed as an empty textarea with
  // the default placeholder — exactly the "I clicked but nothing happened"
  // feeling we just hit.
  const [fieldState, setFieldState] = useState<Record<string, 'queued' | 'generating' | 'done' | 'error'>>({});
  // Progress cursor for batched generation (the "AI 生成全部草稿" button). Null
  // when no batch is active.
  const [batchProgress, setBatchProgress] = useState<{ index: number; total: number } | null>(null);
  // fieldId → assetId mapping. Resolved once after scan via Claude (or local
  // keyword match). User can override by picking a different asset in the
  // file-field card. Persisted to tabSession so the user's manual asset
  // overrides survive a sidepanel reopen — selecting 5 photos again because
  // you switched tabs was a major frustration in V1.
  const [assetMatches, setAssetMatches] = useTabSessionState<Record<string, string | null>>('sidepanel.assetMatches', {});
  // Asset metadata for the current project — used to render selectors in
  // file-field cards without sending blobs over the wire.
  const [projectAssets, setProjectAssets] = useState<{ id: string; filename: string; mimeType: string; tag: string }[]>([]);

  // ----- Step 1: pick project -----
  useEffect(() => {
    if (projects.length && !projectId) setProjectId(projects[0]!.id);
  }, [projects, projectId]);

  const goToContextStep = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      // Previously this silently returned and the user saw nothing happen
      // when clicking "下一步" without an active tab. Throw so AsyncButton
      // surfaces the issue.
      throw new Error('没找到激活的浏览器标签。请确认表单页还在前台。');
    }
    const detected = await sendMessage({ type: 'events.detectFromPage', payload: { tabId: tab.id } });
    setEventDraft({
      id: uuid(),
      name: '',
      theme: '',
      organizer: '',
      location: '',
      url: '',
      deadline: null,
      extraNotes: '',
      pageMetaJson: {},
      createdAt: Date.now(),
      ...(detected as Partial<EventContext>),
    });
    setStep('context');
  };

  // Scan a tab's DOM for fillable fields. One-liner wrapper so the first scan
  // and the multi-page re-scan share a single typed message call.
  // V0.3.0: returns a ScanResult { fields, meta }. `mode` is omitted so the background
  // reads the global AppSettings.scanMode (Options · 扫描模式); meta.mode reports what ran.
  const scanCurrentTab = (tabId: number) =>
    sendMessage({ type: 'fields.scan', payload: { tabId } }) as Promise<ScanResult>;

  // Populate the draft workspace from a freshly-scanned field list: seed empty
  // QA pairs, jump to the draft step, then resolve file-field → asset matches.
  // Shared by confirmContextAndScan (first page) and continueToNextPage (next
  // page of a multi-step form) so both paths stay in lockstep.
  const enterDraftWithFields = async (detected: DetectedField[]) => {
    setFields(detected);
    // seed empty qa pairs
    const seed: Record<string, QAPair> = {};
    for (const f of detected) {
      seed[f.fieldId] = {
        fieldId: f.fieldId,
        fieldLabel: f.label,
        fieldType: f.type,
        fieldConstraints: f.constraints,
        aiDraft: '',
        aiModel: activeConfig?.modelId ?? '',
        finalValue: '',
        userAction: 'skipped',
        ragReferences: { chunkIds: [], similarities: [] },
        generatedAt: 0,
        retryCount: 0,
      };
    }
    setQaPairs(seed);
    setStep('draft');

    // After scan: if there are file fields, fetch this project's assets and
    // ask the matcher (Claude + local keyword) which asset belongs in which
    // field. Result is shown in each file field's card and used by fillPage.
    const fileFields = detected.filter((f) => f.type === 'file');
    if (fileFields.length > 0 && projectId) {
      try {
        const assets = (await sendMessage({ type: 'assets.list', payload: { projectId } })) as
          { id: string; filename: string; mimeType: string; tag: string }[];
        setProjectAssets(assets);
        if (assets.length > 0) {
          const matchRes = (await sendMessage({
            type: 'assets.matchToFields',
            payload: {
              projectId,
              fields: fileFields.map((f) => ({
                fieldId: f.fieldId,
                label: f.label,
                accept: (f.constraints.placeholder || '').replace(/^允许文件类型:\s*/, ''),
              })),
            },
          })) as { matches: { fieldId: string; assetId: string | null }[] };
          const map: Record<string, string | null> = {};
          for (const m of matchRes.matches) map[m.fieldId] = m.assetId;
          setAssetMatches(map);
        }
      } catch (err) {
        // Previously this was a silent console.warn: file-field cards just
        // didn't show suggested assets and the user assumed there was nothing
        // to match. Surface it as a warning so they know to pick manually.
        console.warn('[assets] match failed:', err);
        toast.warning(
          '资产自动匹配失败',
          `请在文件字段卡片里手动选择资产。原因：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  };

  // ----- Step 2: confirm event context, then scan fields -----
  const confirmContextAndScan = async () => {
    if (!eventDraft || !projectId) {
      throw new Error('请先选择项目并填写事件信息。');
    }
    const fullEvent: EventContext = {
      id: eventDraft.id ?? uuid(),
      name: eventDraft.name ?? '',
      theme: eventDraft.theme ?? '',
      organizer: eventDraft.organizer ?? '',
      location: eventDraft.location ?? '',
      url: eventDraft.url ?? '',
      deadline: eventDraft.deadline ?? null,
      extraNotes: eventDraft.extraNotes ?? '',
      pageMetaJson: eventDraft.pageMetaJson ?? {},
      createdAt: eventDraft.createdAt ?? Date.now(),
    };
    await sendMessage({ type: 'events.save', payload: { eventContext: fullEvent } });
    setEventDraft(fullEvent);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const result = await scanCurrentTab(tab.id);
    const detected = result.fields;
    if (detected.length === 0) {
      // Most common cause: user opened the form's editor URL instead of the
      // public fill URL. We can't reliably check chrome.tabs.url here without
      // a permission bump, so we deliver a generic but actionable message.
      const url = tab.url || '';
      const isGoogleEditor = /docs\.google\.com\/forms\/d\/[^/]+\/edit/.test(url);
      const isTypeformEditor = /admin\.typeform\.com\//.test(url);
      const editorHint =
        isGoogleEditor
          ? '当前是 Google Forms 的编辑页（URL 含 /edit）。请打开公开填写链接（URL 形如 /forms/d/e/.../viewform）后再扫描。'
          : isTypeformEditor
            ? '当前是 Typeform 后台。请打开公开链接（form.typeform.com/to/...）后再扫描。'
            : '没识别到任何用户可填写的字段。可能原因：(1) 你在表单的编辑页而非填写页；(2) 字段都在 iframe 内且跨域；(3) 这个页面用了我们还没适配的 UI 库。';
      // Surfacing as a warning toast (non-blocking) rather than alert(): the
      // user might want to switch tabs to a different URL and come back, and
      // a modal alert disrupts that flow. The toast lingers ~5s with the full
      // hint message visible.
      toast.warning('扫描结果为空', `${editorHint}\n\n确认 URL 正确后回来重试。`);
      return;
    }
    setScanMeta(result.meta);
    await enterDraftWithFields(detected);
  };

  // ----- Multi-page / wizard forms: continue to the NEXT page -----
  // Real registration forms (创赛 / 孵化器 / 高校) are usually multi-step:
  // step1 → step2.html → … Each page is a fresh DOM with new fields. Before
  // this, the flow dead-ended after "我已提交" — SubmittedPanel only had a
  // window.close button, so when the site advanced to page 2 the user was
  // stuck with no way to keep filling. continueToNextPage re-scans the CURRENT
  // tab, KEEPS the same project + event context, resets all per-page transient
  // state, and re-enters the draft step. Each page seals its own QARecord on
  // submit, so the natural loop is: 填 → 我已提交 → 继续下一页 → 填 → …
  // 2026-06-05 (科大硅谷 gowithdream step2.html dogfood).
  const continueToNextPage = async () => {
    if (!projectId || !eventDraft?.id) {
      throw new Error('缺少项目或活动信息，请回到第 1 步重新开始。');
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error('没找到激活的浏览器标签，请确认表单页还在前台。');
    }
    const result = await scanCurrentTab(tab.id);
    const detected = result.fields;
    if (detected.length === 0) {
      toast.warning(
        '本页没扫到字段',
        '确认你已翻到表单的下一页（能看到新的输入框）再点一次。若这页本来就没有可填字段，直接在网页上点「下一步」即可。',
      );
      return;
    }
    // Drop everything tied to the page we just finished; keep project + event.
    setStreamingDrafts({});
    setDraftErrors({});
    setFieldState({});
    setBatchProgress(null);
    setFillStatus({});
    setLockedFields([]);
    setSubmittedMarkdownPath(null);
    setAssetMatches({});
    setProjectAssets([]);
    setScanMeta(result.meta);
    await enterDraftWithFields(detected);
  };

  // ----- Streaming subscriber -----
  useEffect(() => {
    const listener = (msg: { kind?: string; streamId?: string; token?: string; text?: string; ragRefs?: { chunkIds: string[]; similarities: number[] }; message?: string }) => {
      if (!msg.kind || !msg.streamId) return;
      const fieldId = msg.streamId;
      if (msg.kind === 'draft.token' && msg.token) {
        setStreamingDrafts((d) => ({ ...d, [fieldId]: (d[fieldId] ?? '') + msg.token }));
        // First token = generation actually started. Flip state from
        // queued → generating so the UI shows a more accurate label.
        setFieldState((s) => (s[fieldId] === 'generating' ? s : { ...s, [fieldId]: 'generating' }));
      }
      if (msg.kind === 'draft.done' && msg.text) {
        setStreamingDrafts((d) => {
          const { [fieldId]: _, ...rest } = d;
          return rest;
        });
        setQaPairs((qa) => ({
          ...qa,
          [fieldId]: {
            ...qa[fieldId]!,
            aiDraft: msg.text!,
            finalValue: msg.text!,
            userAction: 'accepted',
            aiModel: activeConfig?.modelId ?? '',
            ragReferences: msg.ragRefs ?? { chunkIds: [], similarities: [] },
            generatedAt: Date.now(),
          },
        }));
        setFieldState((s) => ({ ...s, [fieldId]: 'done' }));
      }
      if (msg.kind === 'draft.error') {
        recordDraftError(fieldId, msg.message ?? 'unknown error');
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [activeConfig?.modelId]);

  // Centralised error sink. Both the broadcast channel and the promise-reject
  // channel funnel here so we only have one place to decide UI treatment.
  const recordDraftError = (fieldId: string, message: string) => {
    setStreamingDrafts((d) => {
      const { [fieldId]: _drop, ...rest } = d;
      return rest;
    });
    setDraftErrors((d) => ({ ...d, [fieldId]: message }));
    setFieldState((s) => ({ ...s, [fieldId]: 'error' }));
    if (/locked/i.test(message) || /unlock/i.test(message)) {
      setLockedFields((arr) => (arr.includes(fieldId) ? arr : [...arr, fieldId]));
    }
  };

  const clearDraftError = (fieldId: string) => {
    setDraftErrors((d) => {
      const { [fieldId]: _drop, ...rest } = d;
      return rest;
    });
    setLockedFields((arr) => arr.filter((id) => id !== fieldId));
  };

  const triggerGenerate = (field: DetectedField, refinement?: string): Promise<void> => {
    if (!projectId || !eventDraft?.id) return Promise.resolve();
    setStreamingDrafts((d) => ({ ...d, [field.fieldId]: '' }));
    setFieldState((s) => ({ ...s, [field.fieldId]: 'queued' }));
    clearDraftError(field.fieldId);
    // Wrap with an explicit timeout: if the SW or message channel hangs for
    // any reason (Chrome silently closing long-lived channels has been seen
    // in MV3 with multi-minute Claude streams), we want a visible error
    // rather than an infinitely "generating" textarea.
    const messagePromise = sendMessage({
      type: 'draft.generateOne',
      payload: {
        projectId,
        eventContextId: eventDraft.id,
        field,
        configId: activeConfigId, // V2.2
        ...(refinement ? { refinement } : {}),
        streamId: field.fieldId,
      },
    });
    const TIMEOUT_MS = 120_000; // 2 min — generous; primary + retry + fallback
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`生成超时（${TIMEOUT_MS / 1000}s 无响应）`)), TIMEOUT_MS),
    );
    return Promise.race([messagePromise, timeoutPromise])
      .then(() => {})
      .catch((err: Error) => {
        // Promise-channel safety net — background.generateOneDraft broadcasts
        // AND throws, so we get the error here too if the broadcast was missed.
        recordDraftError(field.fieldId, err.message);
      });
  };

  /**
   * Generate drafts strictly serially. Earlier versions ran concurrency=2,
   * which was faster but introduced two reliability problems on real forms:
   *   1) Anthropic 30K-tokens/min tier-1 cap burst — observable as random
   *      fields failing with 429 partway through a 9-field run.
   *   2) Chrome's long-running sendMessage channels are not infinitely
   *      patient. When a single generation took 30-60s (retry + fallback +
   *      streaming), some channels silently closed without ever resolving
   *      OR rejecting — the field would just sit in "generating" forever.
   *
   * Strict serial: each field's promise must settle (or time out via the
   * 120s wrapper in triggerGenerate) before the next starts. Slower in the
   * happy path (~15s × N fields) but reliable.
   *
   * File inputs are excluded — they need manual user upload (browser
   * security forbids programmatic writes to <input type="file">) and AI
   * generation makes no sense.
   */
  /**
   * UX iteration 2026-05-24 (D): Hybrid batch + per-field generation.
   *
   * Strategy:
   *   - Choice fields (radio/checkbox/select) → per-field via triggerGenerate.
   *     These need strict output format ("exact option label, no preamble")
   *     which batch JSON path can't easily enforce per-field.
   *   - Text-y fields (text/textarea/email/url/tel/number/date) → batched
   *     in groups of 3 via triggerGenerateBatch. Cuts API calls ~3x.
   *   - File fields → skipped entirely (browser security forbids auto-fill).
   *
   * Throttle: 8s between SEQUENTIAL operations (one batch counts as one
   * operation). On a 23-field form with say 15 text fields + 8 choice:
   *   - 15 text → 5 batches × 1 call = 5 calls
   *   - 8 choice → 8 calls
   *   - Total: 13 calls × 8s = ~1.7 min wall-clock (vs ~3 min before D).
   *
   * If a batch errors, the per-field error broadcast lets the user pick
   * which to retry individually (no auto-fallback to avoid burst-firing).
   */
  const generateAll = async () => {
    if (!projectId || !eventDraft?.id) return;

    // Partition: choice fields stay per-field; text-y fields go to batches.
    const isChoice = (f: DetectedField) =>
      f.type === 'radio' || f.type === 'checkbox' || f.type === 'select';
    // Skip file fields (manual upload) AND noAiFill fields (验证码 / personal
    // contact info — the AI must not invent these; the user fills them). G5.
    const generatable = fields.filter((f) => f.type !== 'file' && !f.constraints.noAiFill);
    const choiceFields = generatable.filter(isChoice);
    const textFields = generatable.filter((f) => !isChoice(f));

    // Chunk textFields into batches of 3. Smaller batch = better per-field
    // quality (Claude has more focus); larger = fewer API calls. 3 is the
    // sweet spot from internal testing.
    const BATCH_SIZE = 3;
    const textBatches: DetectedField[][] = [];
    for (let i = 0; i < textFields.length; i += BATCH_SIZE) {
      textBatches.push(textFields.slice(i, i + BATCH_SIZE));
    }

    // "operations" = each batch + each choice field. Used for progress UI.
    const totalOps = textBatches.length + choiceFields.length;
    const totalFields = generatable.length;
    // batchProgress.total reports field count (matches what the user sees),
    // batchProgress.index advances per-field even within a batch.
    setBatchProgress({ index: 0, total: totalFields });

    const THROTTLE_MS = 8_000;
    let fieldsDone = 0;

    try {
      // Batches first (typically the bulk).
      for (let bi = 0; bi < textBatches.length; bi++) {
        const batch = textBatches[bi];
        if (!batch || batch.length === 0) continue;
        // Mark all fields in batch as queued in the UI.
        for (const f of batch) {
          setFieldState((s) => ({ ...s, [f.fieldId]: 'queued' }));
          setStreamingDrafts((d) => ({ ...d, [f.fieldId]: '' }));
          clearDraftError(f.fieldId);
        }
        await triggerGenerateBatch(batch);
        fieldsDone += batch.length;
        setBatchProgress({ index: fieldsDone, total: totalFields });
        if (bi < textBatches.length - 1 || choiceFields.length > 0) {
          await new Promise((r) => setTimeout(r, THROTTLE_MS));
        }
      }

      // Then choice fields (per-field — needs strict output).
      for (let ci = 0; ci < choiceFields.length; ci++) {
        const f = choiceFields[ci];
        if (!f) continue;
        fieldsDone += 1;
        setBatchProgress({ index: fieldsDone, total: totalFields });
        await triggerGenerate(f);
        if (ci < choiceFields.length - 1) {
          await new Promise((r) => setTimeout(r, THROTTLE_MS));
        }
      }
      // Reference totalOps so TS doesn't flag it as unused; also useful for debugging.
      void totalOps;
    } finally {
      setBatchProgress(null);
    }
  };

  /**
   * Fire-and-forget batch generation. The background handler broadcasts
   * per-field draft.done / draft.error events; the existing streaming
   * listener (`useEffect` on chrome.runtime.onMessage) handles them.
   *
   * We DON'T return until the batch is complete because the parent loop
   * needs to respect throttling. Wait for the batch by polling fieldState
   * for "all batch fields are done OR errored." With a 120s safety timeout.
   */
  const triggerGenerateBatch = async (batch: DetectedField[]): Promise<void> => {
    if (!projectId || !eventDraft?.id) return;
    const streamId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const messagePromise = sendMessage({
      type: 'draft.generateBatch',
      payload: {
        projectId,
        eventContextId: eventDraft.id,
        fields: batch,
        configId: activeConfigId, // V2.2
        streamId,
      },
    });

    // Wait for all fields to terminal (done|error). The streaming listener
    // updates fieldState as broadcasts arrive — we poll it here.
    const TIMEOUT_MS = 120_000;
    const deadline = Date.now() + TIMEOUT_MS;
    const batchIds = batch.map((f) => f.fieldId);

    // Surface message-channel errors too (e.g. SW crash). messagePromise
    // resolves immediately with {ok, streamId} from the handler; the actual
    // generation broadcast is async. Catch any rejection just to log.
    void messagePromise.catch((err: Error) => {
      // Each field in batch gets a draft.error so UI flips them to ❌
      for (const fid of batchIds) {
        recordDraftError(fid, err.message);
      }
    });

    return new Promise<void>((resolve) => {
      const tick = () => {
        // Read fieldState through the setter to get the freshest value
        // (React state in closure is stale otherwise). We use a getter ref
        // to snapshot synchronously.
        let allTerminal = true;
        setFieldState((current) => {
          for (const fid of batchIds) {
            const st = current[fid];
            if (st !== 'done' && st !== 'error') {
              allTerminal = false;
              break;
            }
          }
          return current; // no change
        });
        if (allTerminal) {
          resolve();
          return;
        }
        if (Date.now() > deadline) {
          // Force-error any field still pending so the UI doesn't hang
          for (const fid of batchIds) {
            recordDraftError(fid, '批量生成超时（120s 无响应），请单独重试该字段');
          }
          resolve();
          return;
        }
        setTimeout(tick, 500);
      };
      tick();
    });
  };

  // Called by LockedFieldsCard after the user enters their master password.
  // We re-run any field that's currently blocked on the locked state.
  const retryLockedFields = () => {
    const blocked = [...lockedFields];
    setLockedFields([]);
    setDraftErrors((d) => {
      const next = { ...d };
      for (const id of blocked) delete next[id];
      return next;
    });
    for (const id of blocked) {
      const field = fields.find((f) => f.fieldId === id);
      if (field) triggerGenerate(field);
    }
  };

  const regenerateOne = (field: DetectedField, refinement?: string) => {
    triggerGenerate(field, refinement);
    setQaPairs((qa) => ({
      ...qa,
      [field.fieldId]: { ...qa[field.fieldId]!, retryCount: (qa[field.fieldId]?.retryCount ?? 0) + 1 },
    }));
  };

  const updateFinal = (fieldId: string, value: string) => {
    setQaPairs((qa) => {
      const prev = qa[fieldId]!;
      const userAction: UserAction = classifyAction(prev.aiDraft, value);
      return { ...qa, [fieldId]: { ...prev, finalValue: value, userAction } };
    });
  };

  const fillPage = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      // This used to silently return — user clicked the big "fill page"
      // button and saw nothing happen. Now they get a clear "we couldn't
      // find your tab" message.
      throw new Error('没找到激活的浏览器标签，请确认表单页还在前台。');
    }
    const fillMap: Record<string, string> = {};
    const fileMap: Record<string, string> = {}; // selector → assetId
    // Track which selector belongs to which fieldId so we can map the backend's
    // "failedFields" (selector list) back to per-field UI badges.
    const selectorToField: Record<string, string> = {};
    for (const f of fields) {
      if (f.type === 'file') {
        // UX iteration 2026-05-30: skip custom JS uploaders — they have no
        // <input type=file> to inject into; the user uploads them manually
        // (the FileFieldPanel offers a one-click asset download instead).
        if (f.constraints.manualUploadOnly) continue;
        const assetId = assetMatches[f.fieldId];
        if (assetId) {
          fileMap[f.domSelector] = assetId;
          selectorToField[f.domSelector] = f.fieldId;
        }
      } else {
        const v = qaPairs[f.fieldId]?.finalValue;
        if (v) {
          fillMap[f.domSelector] = v;
          selectorToField[f.domSelector] = f.fieldId;
        }
      }
    }
    // No more local try/catch + alert here — AsyncButton at the call site
    // catches the thrown error and surfaces it via toast. Single error path.
    const result = (await sendMessage({
      type: 'fields.fillPage',
      payload: { tabId: tab.id, fillMap, fileMap },
    })) as { filledCount: number; failedFields: string[] };
    const next: Record<string, 'success' | 'failed'> = {};
    const failedSet = new Set(result.failedFields ?? []);
    for (const [selector, fieldId] of Object.entries(selectorToField)) {
      next[fieldId] = failedSet.has(selector) ? 'failed' : 'success';
    }
    setFillStatus(next);
    // Success feedback: how many actually wrote, how many failed.
    const failedCount = result.failedFields?.length ?? 0;
    if (failedCount > 0) {
      toast.warning(
        `已填入 ${result.filledCount} 个字段`,
        `${failedCount} 个字段未能写入（页面可能用了我们还没适配的 UI 库）。可在每个字段卡片看到状态。`,
      );
    } else if (result.filledCount > 0) {
      toast.success('填入完成', `${result.filledCount} 个字段已填入页面。`);
    }
  };

  const markSubmitted = async () => {
    if (!projectId || !eventDraft?.id) {
      throw new Error('缺少项目或事件信息，无法保存经验。请回到第 1 步重新开始。');
    }
    const stats = computeStats(Object.values(qaPairs));
    const record: QARecord = {
      id: uuid(),
      projectId,
      eventContextId: eventDraft.id,
      status: 'in_progress',
      qaPairs: Object.values(qaPairs),
      markdownPath: null,
      submittedAt: null,
      pageUrl: eventDraft.url ?? '',
      pageTitle: eventDraft.name ?? '',
      stats,
      createdAt: Date.now(),
    };
    // No more try/catch + alert: AsyncButton at the call site catches thrown
    // errors and toasts them. We just let exceptions propagate.
    await sendMessage({ type: 'qaRecord.upsertDraft', payload: { qaRecord: record } });
    const result = (await sendMessage({
      type: 'qaRecord.markSubmitted',
      payload: { qaRecordId: record.id },
    })) as { markdownPath: string; ragChunksCreated: number };
    setSubmittedMarkdownPath(result.markdownPath);
    setStep('submitted');
    toast.success('经验已沉淀', `下载到：${result.markdownPath}`);
  };

  // ----- Render -----
  const totalGenerated = useMemo(() => Object.values(qaPairs).filter((q) => q.aiDraft).length, [qaPairs]);

  return (
    <div className="p-4 max-w-[640px] mx-auto flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="font-semibold text-lg flex items-center gap-1.5"><Flame className="w-4 h-4 text-orange-500" />ApplyForge</h1>
        <StepIndicator step={step} />
      </header>

      {step === 'project' && (
        <ProjectPicker
          projects={projects}
          selected={projectId}
          onSelect={setProjectId}
          onNext={goToContextStep}
        />
      )}

      {step === 'context' && eventDraft && (
        <EventContextEditor
          draft={eventDraft}
          onChange={setEventDraft}
          onConfirm={confirmContextAndScan}
        />
      )}

      {step === 'draft' && (
        <>
          {lockedFields.length > 0 && (
            <LockedFieldsCard count={lockedFields.length} onUnlocked={retryLockedFields} />
          )}
          <DraftWorkspace
            fields={fields}
            scanMeta={scanMeta}
            qaPairs={qaPairs}
            streamingDrafts={streamingDrafts}
            draftErrors={draftErrors}
            fieldState={fieldState}
            batchProgress={batchProgress}
            fillStatus={fillStatus}
            llmConfigs={llmConfigs}
            activeConfigId={activeConfigId}
            generatedCount={totalGenerated}
            assetMatches={assetMatches}
            projectAssets={projectAssets}
            onChangeAssetMatch={(fieldId, assetId) => setAssetMatches((m) => ({ ...m, [fieldId]: assetId }))}
            onSelectConfig={(id) => setSessionConfigId(id)}
            onOpenSettings={() => chrome.runtime.openOptionsPage()}
            onGenerateAll={generateAll}
            onRegenerate={regenerateOne}
            onUpdate={updateFinal}
            onFillPage={fillPage}
            onMarkSubmitted={markSubmitted}
          />
        </>
      )}

      {step === 'submitted' && (
        <SubmittedPanel markdownPath={submittedMarkdownPath} onContinue={continueToNextPage} />
      )}
    </div>
  );
}

// V0.3.0 (PRD §10): scan-metadata bar shown atop the draft step. Surfaces (a) the honest
// static-field boundary so we never imply dynamic/paged fields were captured (F9), (b) the
// heuristic-vs-hybrid recall comparison (O1), (c) a one-time external-send privacy notice
// (the page's visible control text is sent to the user's model), and (d) the LLM-fallback
// warning when the semantic pass failed and we fell back to heuristic results (F8/BR7).
// All icons are lucide-react (durable rule #2 — never emoji).
function ScanMetaBar({ meta }: { meta: ScanResultMeta | null }) {
  if (!meta) return null;
  const isSemantic = meta.mode === 'hybrid' || meta.mode === 'llm';
  const delta = meta.mergedCount > meta.heuristicCount ? meta.mergedCount - meta.heuristicCount : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground bg-muted/40 rounded px-2 py-1.5">
        <Info size={13} className="mt-px shrink-0" aria-hidden />
        <span>本页静态字段；条件展开 / 分页字段需翻到下一页后再扫一次。</span>
      </div>
      {isSemantic && !meta.llmFallback && (
        <div className="flex items-center gap-1.5 text-[11px]" title="LLM 比纯启发式多识别的字段数">
          <BarChart2 size={13} className="shrink-0 text-violet-600" aria-hidden />
          <span className="text-muted-foreground">启发式 {meta.heuristicCount} · 混合 {meta.mergedCount}</span>
          {delta > 0 ? (
            <span className="text-green-600 font-medium">+{delta}</span>
          ) : (
            <span className="text-muted-foreground/70">无新增</span>
          )}
        </div>
      )}
      {isSemantic && (
        <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground/80">
          <Sparkles size={12} className="mt-px shrink-0 text-violet-500" aria-hidden />
          <span>混合 / 纯 LLM 模式会将本页可见控件文字发送给你配置的模型用于识别。</span>
        </div>
      )}
      {meta.llmFallback && (
        <div className="flex items-start gap-1.5 text-[11px] text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded px-2 py-1.5">
          <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden />
          <span>LLM 补漏未完成（已用启发式结果）。{meta.llmError ? `原因：${meta.llmError}` : ''}</span>
        </div>
      )}
    </div>
  );
}

// Inline master-password card. Appears whenever any draft generation fails with
// a "Settings locked" / "unlock" message — saves the user from having to leave
// the side panel, go to Options, save settings, and come back.
function LockedFieldsCard({ count, onUnlocked }: { count: number; onUnlocked: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!password) {
      setErr('请输入主密码');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await sendMessage({ type: 'settings.unlock', payload: { masterPassword: password } });
      setPassword('');
      onUnlocked();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-primary/60 bg-primary/10 p-3 flex flex-col gap-2">
      <p className="text-sm font-medium flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" />需要解锁</p>
      <p className="text-xs text-muted-foreground">
        Chrome 重启了后台 worker，加密的 API key 暂时不能访问。
        输入主密码即可继续生成 {count} 个字段的草稿。
      </p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        placeholder="主密码"
        className="px-3 py-2 border border-border rounded-md text-sm"
        autoFocus
      />
      {err && <p className="text-xs text-red-400">{err}</p>}
      <button
        onClick={submit}
        disabled={busy}
        className="self-start px-4 py-1.5 bg-primary text-primary-foreground rounded text-sm disabled:opacity-50"
      >
        {busy ? '解锁中...' : '解锁并重试'}
      </button>
    </div>
  );
}

// ----- Helpers -----

function sendMessage<T = unknown>(msg: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp: { ok: boolean; data?: T; error?: string }) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      if (!resp?.ok) return reject(new Error(resp?.error || 'unknown'));
      resolve(resp.data as T);
    });
  });
}

function classifyAction(aiDraft: string, finalValue: string): UserAction {
  if (!finalValue) return 'skipped';
  if (finalValue === aiDraft) return 'accepted';
  const distance = levenshteinRatio(aiDraft, finalValue);
  if (distance < 0.1) return 'edited_minor';
  if (distance < 0.5) return 'edited_major';
  return 'rewritten';
}

function levenshteinRatio(a: string, b: string): number {
  if (!a) return 1;
  if (!b) return 1;
  // Quick approximation — full Levenshtein is O(N*M) which can hurt on long fields.
  // We just compare relative-length-diff plus prefix overlap as a cheap proxy.
  const lenDiff = Math.abs(a.length - b.length) / Math.max(a.length, b.length);
  let prefix = 0;
  while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  const prefixRatio = 1 - prefix / Math.max(a.length, b.length);
  return (lenDiff + prefixRatio) / 2;
}

function computeStats(pairs: QAPair[]): QARecord['stats'] {
  const stats = { accepted: 0, edited_minor: 0, edited_major: 0, rewritten: 0, skipped: 0 };
  for (const p of pairs) stats[p.userAction]++;
  return stats;
}

// ----- Sub-components (intentionally lean — full UI to be expanded) -----

function StepIndicator({ step }: { step: Step }) {
  const stepNum = { project: 0, context: 1, draft: 2, submitted: 3 }[step];
  return <span className="text-xs text-muted-foreground">步骤 {stepNum + 1} / 4</span>;
}

function ProjectPicker({ projects, selected, onSelect, onNext }: {
  projects: Project[];
  selected: string | null;
  onSelect: (id: string) => void;
  // Async now: AsyncButton needs a Promise-returning handler so it can show
  // "detecting page..." while the chrome.tabs.query + sendMessage runs.
  onNext: () => Promise<void>;
}) {
  if (!projects.length) {
    return (
      <div className="p-4 border border-dashed rounded text-center">
        <p>请先在设置中创建项目档案。</p>
        <button onClick={() => chrome.runtime.openOptionsPage()} className="mt-2 text-primary underline">
          打开设置
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <label className="text-sm font-medium">第 1 步 · 选择本次报名的项目</label>
      <select
        value={selected ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        className="px-3 py-2 border border-border rounded-md text-sm"
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <AsyncButton
        onClick={onNext}
        label="下一步 →"
        loadingLabel="读取页面内容中…"
        successLabel="✅ 已检测，进入下一步"
        errorPrefix="读取页面失败"
        timeoutMs={30_000}
        disabled={!selected}
        size="lg"
      />
    </div>
  );
}

// Defined OUTSIDE EventContextEditor on purpose: a component declared inside
// another component is a brand-new type on every parent render, which makes
// React unmount/remount the <input> on every keystroke — that's the "can only
// type one character at a time, then it loses focus" bug.
function EventField({
  label,
  value,
  onValueChange,
  hint,
  origin,
}: {
  label: string;
  value: string;
  onValueChange: (v: string) => void;
  hint?: string;
  // UX iteration 2026-05-23 (T11): origin tags the field with where the data
  // came from. 'extracted' = trusted (no badge), 'guess' = inferred from page
  // metadata (warn user to verify), 'empty' = AI didn't fill in (user knows
  // they need to type something).
  origin?: 'extracted' | 'empty' | 'guess' | undefined;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-muted-foreground">
        {label}
        {hint && <em className="ml-1 not-italic text-muted-foreground/70">{hint}</em>}
        <FieldOriginBadge origin={origin} />
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className="px-3 py-2 border border-border rounded-md"
      />
    </label>
  );
}

/**
 * Extract _extractionMeta from pageMetaJson if present.
 * Returns null when the meta isn't tagged (older detections from before
 * UX iteration 2026-05-23 don't have it).
 */
function readExtractionMeta(draft: Partial<EventContext>): {
  confidence: 'high' | 'medium' | 'low' | 'failed';
  source: 'claude' | 'meta' | 'title';
  fieldOrigins: Record<string, 'extracted' | 'empty' | 'guess'>;
} | null {
  const meta = (draft.pageMetaJson as Record<string, unknown> | undefined)?._extractionMeta;
  if (!meta || typeof meta !== 'object') return null;
  return meta as ReturnType<typeof readExtractionMeta> extends infer T ? NonNullable<T> : never;
}

function ExtractionConfidenceBanner({ meta }: { meta: ReturnType<typeof readExtractionMeta> }) {
  if (!meta) return null;
  const styles: Record<'high' | 'medium' | 'low' | 'failed', { bg: string; icon: string; label: string }> = {
    high: { bg: 'bg-green-500/10 border-green-500/40 text-green-700', icon: '🟢', label: 'AI 已从页面正文识别（claude 高置信）' },
    medium: { bg: 'bg-amber-500/10 border-amber-500/40 text-amber-700', icon: '🟡', label: '部分字段是页面标题猜的 —— 请核对' },
    low: { bg: 'bg-orange-500/10 border-orange-500/40 text-orange-700', icon: '🟠', label: 'AI 提取置信度低 —— 大部分字段需手动确认' },
    failed: { bg: 'bg-red-500/10 border-red-500/40 text-red-700', icon: '🔴', label: 'AI 提取失败 —— 以下信息来自页面元数据，请仔细核对' },
  };
  const s = styles[meta.confidence];
  return (
    <div className={`rounded-md border px-3 py-2 text-xs flex items-start gap-2 ${s.bg}`}>
      <span aria-hidden="true">{s.icon}</span>
      <div>
        <div className="font-medium">{s.label}</div>
        <div className="opacity-80 mt-0.5 text-[10px]">数据来源：{meta.source === 'claude' ? 'Claude 解析页面正文' : meta.source === 'meta' ? 'OG / meta 标签' : '页面标题'}</div>
      </div>
    </div>
  );
}

function FieldOriginBadge({ origin }: { origin: 'extracted' | 'empty' | 'guess' | undefined }) {
  if (!origin || origin === 'extracted') return null; // 'extracted' is the default success case — no badge needed (less visual noise)
  if (origin === 'guess') {
    return <span className="text-[10px] text-amber-600 ml-1" title="这个字段是从页面元数据猜的，请核对">? 猜测</span>;
  }
  return <span className="text-[10px] text-muted-foreground ml-1" title="AI 没能从页面识别这个字段">— 未识别</span>;
}

function EventContextEditor({ draft, onChange, onConfirm }: {
  draft: Partial<EventContext>;
  onChange: (d: Partial<EventContext>) => void;
  // Async now: scan can take 1-5s on a large form. AsyncButton shows progress.
  onConfirm: () => Promise<void>;
}) {
  const set = (k: keyof EventContext) => (v: string) => onChange({ ...draft, [k]: v });
  const extractionMeta = readExtractionMeta(draft);
  const origins = extractionMeta?.fieldOrigins ?? {};
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">第 2 步 · 确认活动背景</h2>
      <ExtractionConfidenceBanner meta={extractionMeta} />
      <p className="text-xs text-muted-foreground">
        AI 已从页面元信息推断，修改不准的字段。<strong>多花 30 秒填好这里，AI 才能写出针对性内容。</strong>
      </p>
      <EventField label="活动名" value={draft.name ?? ''} onValueChange={set('name')} origin={origins.name} />
      <EventField label="主题" value={draft.theme ?? ''} onValueChange={set('theme')} hint="如 AI Agent / 智能制造 / 消费升级" origin={origins.theme} />
      <EventField label="主办方" value={draft.organizer ?? ''} onValueChange={set('organizer')} origin={origins.organizer} />
      <EventField label="地点" value={draft.location ?? ''} onValueChange={set('location')} hint="影响答案的地域产业特色匹配" origin={origins.location} />
      <EventField label="报名链接" value={draft.url ?? ''} onValueChange={set('url')} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">补充说明（可选）</span>
        <textarea
          value={draft.extraNotes ?? ''}
          onChange={(e) => onChange({ ...draft, extraNotes: e.target.value })}
          className="px-3 py-2 border border-border rounded-md min-h-[80px]"
          placeholder="例如：主办方今年特别关注硬件创业，或截止前一周才能改"
        />
      </label>
      <AsyncButton
        onClick={onConfirm}
        label="✅ 确认，开始扫描字段"
        loadingLabel="正在扫描页面字段…"
        successLabel="✅ 扫描完成"
        errorPrefix="扫描失败"
        timeoutMs={60_000}
        size="lg"
      />
    </div>
  );
}

function DraftWorkspace(props: {
  fields: DetectedField[];
  qaPairs: Record<string, QAPair>;
  streamingDrafts: Record<string, string>;
  draftErrors: Record<string, string>;
  fieldState: Record<string, 'queued' | 'generating' | 'done' | 'error'>;
  batchProgress: { index: number; total: number } | null;
  fillStatus: Record<string, 'success' | 'failed'>;
  /** V2.2: all configured LLM configs from settings. */
  llmConfigs: LLMConfig[];
  /** V2.2: id of the config the sidepanel is currently using (may be session-only). */
  activeConfigId: string;
  generatedCount: number;
  assetMatches: Record<string, string | null>;
  projectAssets: { id: string; filename: string; mimeType: string; tag: string }[];
  onChangeAssetMatch: (fieldId: string, assetId: string | null) => void;
  /** V2.2: select a different config for THIS sidepanel session (doesn't change global default). */
  onSelectConfig: (id: string) => void;
  /** V2.2: open the Options page so the user can add/edit configs. */
  onOpenSettings: () => void;
  // Async handlers so AsyncButton can show loading / errors / timeouts.
  onGenerateAll: () => Promise<void>;
  onRegenerate: (f: DetectedField, refinement?: string) => void;
  onUpdate: (fieldId: string, v: string) => void;
  onFillPage: () => Promise<void>;
  onMarkSubmitted: () => Promise<void>;
  /** V0.3.0: scan recall / fallback metadata for the meta bar. */
  scanMeta: ScanResultMeta | null;
}) {
  const { fields, qaPairs, streamingDrafts, draftErrors, fieldState, batchProgress, fillStatus, llmConfigs, activeConfigId, generatedCount, assetMatches, projectAssets, onChangeAssetMatch } = props;
  const isGenerating = !!batchProgress;
  const [pickerOpen, setPickerOpen] = useState(false);
  const filledCount = Object.values(fillStatus).filter((s) => s === 'success').length;
  const failedCount = Object.values(fillStatus).filter((s) => s === 'failed').length;
  const activeConfig = llmConfigs.find((c) => c.id === activeConfigId);
  // Chip label: prefer displayName, fall back to "未配置" if empty list.
  const chipLabel = activeConfig?.displayName ?? '未配置模型';
  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">第 3 步 · 草稿 · 已识别 {fields.length} 个字段</h2>
        <button
          onClick={() => setPickerOpen((v) => !v)}
          className="text-xs border border-border rounded px-2 py-1 hover:bg-muted/30 max-w-[260px] truncate"
          title="切换本次报名使用的 AI 配置"
        >
          {chipLabel} ▾
        </button>
      </header>
      <ScanMetaBar meta={props.scanMeta} />
      {pickerOpen && (
        <div className="rounded-md border border-border p-3 bg-muted/20 flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">本次报名使用哪个 AI 配置？（仅本会话有效）</span>
          {llmConfigs.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">
              还没添加任何 AI 配置。
              <button
                type="button"
                onClick={() => { props.onOpenSettings(); setPickerOpen(false); }}
                className="ml-1 text-primary hover:underline"
              >
                去添加 →
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {llmConfigs.map((cfg) => (
                <label
                  key={cfg.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-muted/50 text-sm ${
                    cfg.id === activeConfigId ? 'bg-primary/10' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="sidepanel-llm-config"
                    checked={cfg.id === activeConfigId}
                    onChange={() => props.onSelectConfig(cfg.id)}
                  />
                  <span className="flex-1 truncate" title={cfg.displayName}>{cfg.displayName}</span>
                  {cfg.isDefault && (
                    <span className="text-[10px] text-green-600 dark:text-green-400">⭐ 全局默认</span>
                  )}
                </label>
              ))}
              <button
                type="button"
                onClick={() => { props.onOpenSettings(); setPickerOpen(false); }}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline mt-1 self-start"
              >
                + 去设置加新 Provider
              </button>
            </div>
          )}
          <button
            onClick={() => setPickerOpen(false)}
            className="mt-1 text-xs text-muted-foreground hover:underline self-start"
          >
            收起
          </button>
        </div>
      )}

      {/* Generate-all button keeps the legacy <button> instead of AsyncButton —
          it has a custom external progress indicator (batchProgress prop) that
          updates live across N child generations, and its disabled state is
          synced with the parent's batchProgress, not just the button's own
          in-flight state. AsyncButton's internal lifecycle doesn't fit this
          multi-child case. We still wrap a try/catch via the async handler. */}
      <button
        onClick={() => { void props.onGenerateAll(); }}
        disabled={isGenerating}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-60"
      >
        {isGenerating
          ? `⏳ 正在生成第 ${batchProgress!.index} / ${batchProgress!.total} 个…`
          : `AI 生成全部草稿（已生成 ${generatedCount} / ${fields.length}）`}
      </button>
      {isGenerating && (
        <p className="text-[11px] text-muted-foreground -mt-1">
          串行生成中，每个字段大约 10-25 秒。看到 ⏳ 标记的字段正在等待。
        </p>
      )}

      <div className="flex flex-col gap-3">
        {fields.map((f, idx) => (
          <FieldCard
            key={f.fieldId}
            index={idx}
            field={f}
            qa={qaPairs[f.fieldId]}
            streaming={streamingDrafts[f.fieldId] ?? ''}
            error={draftErrors[f.fieldId]}
            state={fieldState[f.fieldId]}
            fillStatus={fillStatus[f.fieldId]}
            assetMatch={assetMatches[f.fieldId] ?? null}
            availableAssets={projectAssets}
            onChangeAssetMatch={(assetId) => onChangeAssetMatch(f.fieldId, assetId)}
            onRegenerate={(refinement) => props.onRegenerate(f, refinement)}
            onUpdate={(v) => props.onUpdate(f.fieldId, v)}
          />
        ))}
      </div>

      {(filledCount > 0 || failedCount > 0) && (
        <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
          上次填入：<strong className="text-green-500">{filledCount} 成功</strong>
          {failedCount > 0 && <> · <strong className="text-red-400">{failedCount} 失败（看下方红色 ⚠ 标记）</strong></>}
          。回页面检查后点"我已提交"。
        </div>
      )}

      <div className="flex gap-2 sticky bottom-0 bg-background pt-3 border-t">
        <AsyncButton
          onClick={props.onFillPage}
          label="🎯 一键填入页面"
          loadingLabel="正在填入字段…"
          successLabel="✅ 已填入"
          errorPrefix="填入失败"
          timeoutMs={45_000}
          size="lg"
          className="flex-1"
        />
        <AsyncButton
          onClick={props.onMarkSubmitted}
          label="✅ 我已提交，沉淀经验"
          loadingLabel="保存中…"
          successLabel="✅ 已沉淀"
          errorPrefix="保存失败"
          timeoutMs={30_000}
          variant="ghost"
          size="lg"
          className="flex-1 border border-primary text-primary bg-transparent hover:bg-primary/10"
        />
      </div>
    </div>
  );
}

function FieldCard({ index, field, qa, streaming, error, state, fillStatus, assetMatch, availableAssets, onChangeAssetMatch, onRegenerate, onUpdate }: {
  index: number;
  field: DetectedField;
  qa: QAPair | undefined;
  streaming: string;
  error: string | undefined;
  state: 'queued' | 'generating' | 'done' | 'error' | undefined;
  fillStatus: 'success' | 'failed' | undefined;
  assetMatch: string | null;
  availableAssets: { id: string; filename: string; mimeType: string; tag: string }[];
  onChangeAssetMatch: (assetId: string | null) => void;
  onRegenerate: (refinement?: string) => void;
  onUpdate: (v: string) => void;
}) {
  const [regenHint, setRegenHint] = useState('');
  const constraintBadges: string[] = [];
  if (field.constraints.required) constraintBadges.push('必填');
  if (field.constraints.maxLength) constraintBadges.push(`≤ ${field.constraints.maxLength} 字`);
  // Show the field type with a friendlier label so users know it's a choice.
  const typeLabels: Record<string, string> = {
    radio: '单选',
    checkbox: '多选',
    select: '下拉',
    textarea: '长文本',
    text: '短文本',
    email: '邮箱',
    url: '链接',
    tel: '电话',
    number: '数字',
    date: '日期',
    file: '文件上传',
  };
  constraintBadges.push(typeLabels[field.type] ?? field.type);

  const isFile = field.type === 'file';
  const isChoice = field.type === 'radio' || field.type === 'checkbox' || field.type === 'select';
  // G5: 验证码 / 个人联系人信息 — AI must not invent these; no regenerate button.
  const isSensitive = !!field.constraints.noAiFill;
  const options = field.constraints.options ?? [];

  const charCount = (qa?.finalValue ?? '').length;
  const overLimit = field.constraints.maxLength ? charCount > field.constraints.maxLength : false;
  const showError = !!error && !qa?.finalValue;

  return (
    <article className={`border rounded-md p-3 flex flex-col gap-2 text-sm ${
      showError ? 'border-red-500/60 bg-red-500/5' : 'border-border'
    }`}>
      <header className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <h3 className="font-medium flex items-center gap-1.5 flex-wrap">
            <span>{index + 1}. {field.label}</span>
            {state === 'queued' && <span title="等待生成" className="inline-flex items-center gap-1 text-muted-foreground text-xs"><Clock className="w-3 h-3" />等待中</span>}
            {state === 'generating' && <span title="正在生成" className="inline-flex items-center gap-1 text-primary text-xs"><Pencil className="w-3 h-3" />生成中</span>}
            {state === 'done' && <span title="已生成" className="inline-flex items-center gap-1 text-green-500 text-xs"><Check className="w-3 h-3" />已生成</span>}
            {state === 'error' && <span title="生成失败" className="inline-flex items-center gap-1 text-red-400 text-xs"><XIcon className="w-3 h-3" />失败</span>}
            {fillStatus === 'success' && <span title="已填入页面" className="inline-flex items-center gap-1 text-green-500 text-xs"><Check className="w-3 h-3" />已填入</span>}
            {fillStatus === 'failed' && <span title="填入失败" className="inline-flex items-center gap-1 text-red-400 text-xs"><AlertTriangle className="w-3 h-3" />填入失败</span>}
          </h3>
          <div className="flex flex-wrap gap-1 mt-1">
            {constraintBadges.map((b) => (
              <span key={b} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{b}</span>
            ))}
          </div>
        </div>
        {/* Re-generate. Free-text fields also get an optional "how to change it"
            hint so regeneration CONVERGES instead of producing another random
            draft (UX iteration 2026-06-01). File fields need a human upload;
            choice fields keep a plain button (just pick from the list).
            Sensitive fields (验证码 / 个人信息) get no regenerate — the user fills
            them. */}
        {!isFile && !isSensitive && (
          <div className="flex items-center gap-1 shrink-0">
            {!isChoice && (
              <input
                value={regenHint}
                onChange={(e) => setRegenHint(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && regenHint.trim()) {
                    onRegenerate(regenHint.trim());
                    setRegenHint('');
                  }
                }}
                placeholder="改写建议(可选)"
                title="告诉 AI 想怎么改，例如：更简短 / 更正式 / 突出落地、加数据。留空 = 普通重生成"
                className="w-24 px-1.5 py-0.5 text-[11px] border border-border rounded bg-transparent focus:w-40 transition-all"
              />
            )}
            <button
              onClick={() => { onRegenerate(regenHint.trim() || undefined); setRegenHint(''); }}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
            >
              <RefreshCw className="w-3 h-3" />重生成
            </button>
          </div>
        )}
      </header>

      {field.constraints.helperText && (
        <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><MessageCircle className="w-3 h-3" />{field.constraints.helperText}</p>
      )}

      {/* G5: sensitive field — AI doesn't draft it; the user fills it. */}
      {isSensitive && (
        <p className="text-[12px] text-amber-300 bg-amber-500/10 rounded px-2 py-1.5 inline-flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" />
          {field.constraints.sensitiveKind === 'otp'
            ? '验证码请直接在网页里填，AI 不代写。'
            : '个人 / 联系人信息，请你自己填，AI 不代写。'}
        </p>
      )}

      {/* Provenance "ⓘ 为什么扫到这个字段？" toggle — collapsed by default to
          keep the card lean. Power users / debuggers expand to see source,
          selector, visibility, label confidence, matched pattern. */}
      <FieldExplainer provenance={field.provenance} />


      {/* File-upload field: show matched project asset (if any) + override picker. */}
      {isFile && (
        <FileFieldPanel
          assetMatch={assetMatch}
          availableAssets={availableAssets}
          accept={field.constraints.placeholder ?? ''}
          manualUploadOnly={field.constraints.manualUploadOnly ?? false}
          onChange={onChangeAssetMatch}
        />
      )}

      {/* For choice fields, show the option list so users can see what AI picked from */}
      {isChoice && options.length > 0 && (
        <div className="text-[11px] text-muted-foreground flex flex-wrap gap-1">
          {options.map((o) => {
            const picked = (qa?.finalValue ?? '').split(/[,，]/).some((v) => v.trim() === o);
            return (
              <span
                key={o}
                className={`px-1.5 py-0.5 rounded border ${
                  picked ? 'border-primary bg-primary/15 text-primary' : 'border-border'
                }`}
              >
                {o}
              </span>
            );
          })}
        </div>
      )}

      {isFile ? null : showError ? (
        <div className="text-[12px] text-red-400 bg-red-500/10 rounded px-2 py-1.5">
          ⚠️ 生成失败：{error}
          <button onClick={() => onRegenerate()} className="ml-2 underline">重试</button>
        </div>
      ) : isChoice && options.length > 0 ? (
        // Choice: dropdown for radio/select; native multi-select for checkbox
        field.type === 'checkbox' ? (
          <input
            type="text"
            value={qa?.finalValue ?? streaming}
            onChange={(e) => onUpdate(e.target.value)}
            placeholder="用「，」分隔多个选项，例如：北京，上海"
            className="w-full px-2 py-1.5 border border-border rounded text-sm"
          />
        ) : (
          <select
            value={qa?.finalValue ?? streaming ?? ''}
            onChange={(e) => onUpdate(e.target.value)}
            className="w-full px-2 py-1.5 border border-border rounded text-sm"
          >
            <option value="">（AI 未选 / 点上方"重生成"）</option>
            {options.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        )
      ) : (
        <textarea
          value={qa?.finalValue ?? streaming}
          onChange={(e) => onUpdate(e.target.value)}
          rows={field.type === 'textarea' ? 4 : 2}
          className={`w-full px-2 py-1.5 border rounded text-sm ${overLimit ? 'border-red-500' : 'border-border'}`}
          placeholder={streaming ? '生成中...' : '点击「AI 生成全部草稿」或自己写'}
        />
      )}

      <footer className="flex items-center justify-between text-[11px] text-muted-foreground">
        {/* Char count only matters for free-text fields. */}
        {isFile ? (
          <span>文件由你手动上传</span>
        ) : isChoice ? (
          <span>{qa?.finalValue ? `已选: ${qa.finalValue}` : '未选'}</span>
        ) : (
          <span className={overLimit ? 'text-red-400' : ''}>
            {charCount}{field.constraints.maxLength ? ` / ${field.constraints.maxLength}` : ''} 字
          </span>
        )}
        {!isFile && qa?.ragReferences?.chunkIds?.length ? (
          <span title={`相似度 ${qa.ragReferences.similarities.map((s) => s.toFixed(2)).join(', ')}`}>
            📎 参考 {qa.ragReferences.chunkIds.length} 个片段
          </span>
        ) : null}
      </footer>
    </article>
  );
}

/**
 * Download a project asset to disk so the user can manually upload it. Used
 * by custom-JS-uploader fields (manualUploadOnly) where we can't inject the
 * file programmatically. Runs in the sidepanel DOM context, so Blob + object
 * URL are available (unlike the service worker). UX iteration 2026-05-30.
 */
async function downloadAsset(assetId: string): Promise<void> {
  const res = await sendMessage<{ filename: string; mimeType: string; bytes: ArrayBuffer }>({
    type: 'assets.getBinary',
    payload: { id: assetId },
  });
  const blob = new Blob([res.bytes], { type: res.mimeType || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = res.filename || 'asset';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function FileFieldPanel({
  assetMatch,
  availableAssets,
  accept,
  manualUploadOnly,
  onChange,
}: {
  assetMatch: string | null;
  availableAssets: { id: string; filename: string; mimeType: string; tag: string }[];
  accept: string;
  manualUploadOnly: boolean;
  onChange: (assetId: string | null) => void;
}) {
  const matched = availableAssets.find((a) => a.id === assetMatch) ?? null;
  const acceptTokens = accept.toLowerCase().replace(/^允许文件类型:\s*/, '').split(',').map((t) => t.trim()).filter(Boolean);
  const compatible = availableAssets.filter((a) => {
    if (acceptTokens.length === 0) return true;
    return acceptTokens.some((t) => (t.endsWith('/*') ? a.mimeType.toLowerCase().startsWith(t.slice(0, -1)) : a.mimeType.toLowerCase() === t));
  });

  // ----- Custom JS uploader (manualUploadOnly): can't auto-fill. Offer a
  // matched-asset download so the user uploads it manually in one step. -----
  if (manualUploadOnly) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] flex flex-col gap-2">
        <p className="font-medium text-amber-300 inline-flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5" />需手动上传（此表单用了自定义上传控件）
        </p>
        {availableAssets.length === 0 ? (
          <p className="text-muted-foreground">
            去 Options → 项目档案上传相关文件（如 BP / PPT）。下次回来这里能帮你匹配 + 一键下载，再手动上传。
          </p>
        ) : (
          <>
            <label className="flex items-center gap-2 text-muted-foreground">
              <span>选要传的:</span>
              <select
                value={assetMatch ?? ''}
                onChange={(e) => onChange(e.target.value || null)}
                className="flex-1 px-2 py-1 border border-border rounded text-xs"
              >
                <option value="">（选一个文件）</option>
                {availableAssets.map((a) => (
                  <option key={a.id} value={a.id}>[{a.tag}] {a.filename}</option>
                ))}
              </select>
            </label>
            {matched && (
              <button
                type="button"
                onClick={() => { void downloadAsset(matched.id); }}
                className="self-start inline-flex items-center gap-1 px-2.5 py-1 rounded bg-primary text-primary-foreground text-xs hover:bg-primary/90"
              >
                <Download className="w-3.5 h-3.5" />下载 {matched.filename}
              </button>
            )}
            <p className="text-[11px] text-muted-foreground">
              下载后，点表单的「上传」按钮，在弹出的文件框里选这个文件即可。
              <br />（浏览器安全限制：选文件这步必须你手动操作，任何扩展都代替不了。）
            </p>
          </>
        )}
      </div>
    );
  }

  if (availableAssets.length === 0) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] flex flex-col gap-1.5">
        <p className="font-medium text-amber-300 inline-flex items-center gap-1"><Paperclip className="w-3.5 h-3.5" />没有可用的项目资产</p>
        <p className="text-muted-foreground">
          去 Options → 项目档案 → 你这个项目，上传 项目照片 / Logo / PPT。下次回来就能自动填了。
        </p>
        {accept && <p className="text-muted-foreground">{accept}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-[12px] flex flex-col gap-2">
      {matched ? (
        <p className="font-medium text-primary inline-flex items-center gap-1"><Paperclip className="w-3.5 h-3.5" />将自动填入：{matched.filename}</p>
      ) : (
        <p className="font-medium text-amber-300 inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />AI 没找到合适的资产匹配 — 请手动选一个</p>
      )}
      {accept && <p className="text-muted-foreground text-[11px]">{accept}</p>}
      <label className="flex items-center gap-2 text-muted-foreground">
        <span>选择:</span>
        <select
          value={assetMatch ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          className="flex-1 px-2 py-1 border border-border rounded text-xs"
        >
          <option value="">（不自动填，我手动上传）</option>
          {compatible.map((a) => (
            <option key={a.id} value={a.id}>[{a.tag}] {a.filename}</option>
          ))}
          {compatible.length === 0 && availableAssets.length > 0 && (
            <option disabled>（没有匹配 accept 类型的资产）</option>
          )}
        </select>
      </label>
    </div>
  );
}

function SubmittedPanel({ markdownPath, onContinue }: { markdownPath: string | null; onContinue: () => Promise<void> }) {
  const openDownloads = () => {
    try {
      chrome.downloads.showDefaultFolder();
    } catch {
      // Older Chrome / no permission — fall back to listing recent downloads.
      chrome.downloads.search({ limit: 1 }, (items) => {
        if (items[0]?.id) chrome.downloads.show(items[0].id);
      });
    }
  };

  return (
    <div className="p-4 border border-border rounded flex flex-col gap-3">
      <p className="text-lg text-center inline-flex items-center justify-center gap-2"><PartyPopper className="w-5 h-5 text-amber-400" />已为你保存这次报名记录</p>

      {markdownPath ? (
        <div className="text-sm text-muted-foreground bg-muted/30 rounded p-2 font-mono break-all">
          📄 {markdownPath}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center">
          Markdown 已下载到 ~/Downloads/applyforge/
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        这份 Q&amp;A 已加入经验库，下次填类似字段时 AI 会参考它，回答会越来越收敛到你的风格。
      </p>

      {/* Multi-page / wizard forms: the site often advances to step2/step3 with
          brand-new fields. Let the user re-scan the page they just navigated to
          — keeping project + event context — instead of dead-ending here.
          UX iteration 2026-06-05 (科大硅谷 step2 dogfood). */}
      <div className="rounded-md border border-primary/40 bg-primary/5 p-3 flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          这个报名还有下一页？在网页上翻到下一页后点这里，AI 接着帮你填——你的项目和活动背景都会保留。
        </p>
        <AsyncButton
          onClick={onContinue}
          icon={<ArrowRight className="w-4 h-4" />}
          label="继续填下一页（扫描本页新字段）"
          loadingLabel="正在扫描本页…"
          successLabel="已扫描，进入草稿"
          errorPrefix="扫描失败"
          timeoutMs={60_000}
          size="lg"
        />
      </div>

      <div className="flex gap-2 mt-2">
        <button onClick={openDownloads} className="flex-1 px-3 py-2 border border-border rounded text-sm hover:bg-muted inline-flex items-center justify-center gap-1.5">
          <FolderOpen className="w-4 h-4" />打开 Downloads 目录
        </button>
        <button onClick={() => window.close()} className="flex-1 px-3 py-2 bg-primary text-primary-foreground rounded text-sm">
          全部完成
        </button>
      </div>
    </div>
  );
}
