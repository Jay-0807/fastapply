// Options page — full-tab control panel.
// Contains: onboarding (master password + API keys), project CRUD, document upload,
// history Q&A browsing, backup/import, settings.
//
// This file ships the *core skeleton*. Detailed sub-pages (Project editor, Q&A history
// browser, backup UI) are stubbed where indicated and to be expanded in follow-up commits.

import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Flame,
  Folder,
  FolderOpen,
  FileText,
  Download,
  AlertTriangle,
  Wrench,
  Sparkles,
  Bot,
  Users,
  UserPlus,
  Trash2,
  Upload,
} from 'lucide-react';
import { db } from '@/lib/db/schema';
import type { Project, AppSettings, LLMConfig, ScanMode, Person, PersonFieldKey, ProjectFacts } from '@/lib/db/types';
import type { Message } from '@/lib/messages/types';
import { useToast } from '@/components/ErrorToast';
import { PROVIDER_PRESETS, getProviderPreset } from '@/lib/llm/provider-catalog';

type Tab = 'projects' | 'people' | 'history' | 'settings' | 'backup';

/** Display labels for each reusable Person field (drives the profile editor). */
const PERSON_FIELD_LABELS: { key: PersonFieldKey; label: string; long?: boolean }[] = [
  { key: 'name', label: '姓名' },
  { key: 'phone', label: '手机 / 电话' },
  { key: 'email', label: '邮箱' },
  { key: 'wechat', label: '微信' },
  { key: 'qq', label: 'QQ' },
  { key: 'idNumber', label: '身份证 / 证件号' },
  { key: 'title', label: '职位 / 头衔' },
  { key: 'organization', label: '单位 / 公司' },
  { key: 'address', label: '地址' },
  { key: 'bio', label: '个人简介', long: true },
];

/**
 * Send a typed message to the background service worker and unwrap the
 * `{ ok, data, error }` envelope it returns. Throws on:
 *   - chrome.runtime.lastError (channel-level failure, e.g. SW restarted)
 *   - res.ok === false (handler ran but threw inside)
 *
 * Without this wrapper every call site has to remember to check `res.ok` and
 * background errors get silently swallowed.
 */
async function sendBg<T = unknown>(message: Message): Promise<T> {
  const res = (await chrome.runtime.sendMessage(message)) as
    | { ok: true; data: T }
    | { ok: false; error: string }
    | undefined;
  if (chrome.runtime.lastError) {
    throw new Error(chrome.runtime.lastError.message ?? 'runtime.lastError');
  }
  if (!res) {
    throw new Error('background did not respond (service worker may have crashed)');
  }
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function OptionsApp() {
  const settings = useLiveQuery(() => db.appSettings.get('singleton'), []);
  const [tab, setTab] = useState<Tab>('projects');
  // Three-state boot machine. useLiveQuery returns undefined BOTH while loading
  // AND when the row is absent, so we can't infer onboarding state from it
  // alone — we do an explicit first fetch.
  const [bootState, setBootState] = useState<'loading' | 'onboarding' | 'main'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await db.appSettings.get('singleton');
      if (cancelled) return;
      // V2.2: onboarding completes when at least one LLM config exists.
      // Back-compat: legacy installs (pre-V2.2) only had encryptedAnthropicKey;
      // their settings get migrated to llmConfigs[] in v5, but during the
      // upgrade window we also accept the legacy key as "configured".
      const hasAny = (s?.llmConfigs?.length ?? 0) > 0 || !!s?.encryptedAnthropicKey;
      setBootState(!s || !hasAny ? 'onboarding' : 'main');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // After onboarding completes, useLiveQuery picks up the new row → leave
    // the onboarding screen automatically.
    const hasAny = (settings?.llmConfigs?.length ?? 0) > 0 || !!settings?.encryptedAnthropicKey;
    if (bootState === 'onboarding' && hasAny) {
      setBootState('main');
    }
  }, [settings, bootState]);

  if (bootState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }

  if (bootState === 'onboarding') {
    return <Onboarding onDone={() => setBootState('main')} />;
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 border-r border-border p-4 flex flex-col gap-1">
        <h1 className="font-semibold mb-4 flex items-center gap-1.5"><Flame className="w-4 h-4 text-orange-500" />ApplyForge</h1>
        <TabBtn label="📁 项目档案" active={tab === 'projects'} onClick={() => setTab('projects')} />
        <TabBtn label="👤 人员档案" active={tab === 'people'} onClick={() => setTab('people')} />
        <TabBtn label="📚 经验库" active={tab === 'history'} onClick={() => setTab('history')} />
        <TabBtn label="⚙️ 设置" active={tab === 'settings'} onClick={() => setTab('settings')} />
        <TabBtn label="📦 备份" active={tab === 'backup'} onClick={() => setTab('backup')} />
      </aside>
      <main className="flex-1 p-6 overflow-y-auto">
        {tab === 'projects' && <ProjectsPane />}
        {tab === 'people' && <PeoplePane />}
        {tab === 'history' && <HistoryPane />}
        {tab === 'settings' && <SettingsPane settings={settings} />}
        {tab === 'backup' && <BackupPane />}
      </main>
    </div>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-left px-3 py-2 rounded text-sm ${active ? 'bg-muted font-medium' : 'hover:bg-muted/50'}`}
    >
      {label}
    </button>
  );
}

// ===========================================================================
// V0.4.0 knowledge graph — 人员档案 (People) tab.
// CRUD over reusable Person profiles + a file-driven structured importer that
// extracts project facts + person candidates from a dropped file (user confirms
// before anything is written — never blindly trust the LLM).
// ===========================================================================

type PersonCandidate = { displayName: string; role: string; fields: Person['fields'] };
type ExtractResult = { facts: ProjectFacts; persons: PersonCandidate[] };

const FACT_LABELS: { key: 'oneLiner' | 'sector' | 'stage' | 'location' | 'teamSize' | 'metrics' | 'techStack'; label: string; long?: boolean }[] = [
  { key: 'oneLiner', label: '一句话介绍', long: true },
  { key: 'sector', label: '赛道 / 行业' },
  { key: 'stage', label: '阶段' },
  { key: 'location', label: '所在地' },
  { key: 'teamSize', label: '团队规模' },
  { key: 'metrics', label: '关键指标 / 进展', long: true },
  { key: 'techStack', label: '技术栈' },
];

function PeoplePane() {
  const persons = useLiveQuery(() => db.persons.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) ?? [];
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const createPerson = async (data: PersonCandidate & { notes: string }) => {
    await sendBg({ type: 'persons.create', payload: data });
    setCreating(false);
    toast.success('已添加人员');
  };
  const updatePerson = async (id: string, data: PersonCandidate & { notes: string }) => {
    await sendBg({ type: 'persons.update', payload: { id, patch: data } });
    setEditingId(null);
    toast.success('已更新人员');
  };
  const deletePerson = async (id: string) => {
    if (!confirm('删除这个人员档案？（不会影响已保存的报名记录）')) return;
    await sendBg({ type: 'persons.delete', payload: { id } });
    toast.info('已删除');
  };

  // Non-destructive bulk import of a graph seed JSON (project facts + people),
  // e.g. one generated from local files. Merges; never wipes existing data.
  const onSeedFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const seed = JSON.parse(await file.text());
      const r = await sendBg<{ projectCreated: boolean; projectUpdated: boolean; personsCreated: number; personsUpdated: number }>(
        { type: 'graph.importSeed', payload: { seed } },
      );
      const proj = r.projectCreated ? '新建项目' : r.projectUpdated ? '更新项目' : '未改项目';
      toast.success('知识图谱种子已导入', `${proj}；人员 +${r.personsCreated} 新建 / ${r.personsUpdated} 更新（非破坏性，可重复导入）`);
    } catch (err) {
      toast.error('种子导入失败', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2"><Users className="w-5 h-5" />人员档案</h2>
        <p className="text-sm text-muted-foreground mt-1">
          把常用参赛 / 联系人的个人信息存一次。报名时在侧栏勾选参与的人，姓名 / 手机 / 邮箱等会
          <strong>自动回填真实信息</strong>（AI 不代写个人信息，提交前你核对）。所有数据仅存本地。
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-md border border-border p-3">
        <label className="inline-block">
          <input type="file" accept="application/json,.json" onChange={onSeedFile} className="hidden" />
          <span className="text-xs text-primary cursor-pointer hover:underline inline-flex items-center gap-1.5"><Upload className="w-3.5 h-3.5" />导入知识图谱种子 (JSON)</span>
        </label>
        <span className="text-xs text-muted-foreground">一次性导入从本地文件抽取好的项目信息 + 人员（非破坏性合并，可重复导入；按项目名 / 人名去重）。</span>
      </div>

      <StructuredImport projects={projects} />

      {!creating ? (
        <button onClick={() => setCreating(true)} className="self-start px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm inline-flex items-center gap-1.5">
          <UserPlus className="w-4 h-4" />新建人员
        </button>
      ) : (
        <PersonForm onSave={createPerson} onCancel={() => setCreating(false)} />
      )}

      <ul className="flex flex-col gap-2">
        {persons.map((p) => (
          <li key={p.id} className="border border-border rounded-md p-3">
            {editingId === p.id ? (
              <PersonForm initial={p} onSave={(d) => updatePerson(p.id, d)} onCancel={() => setEditingId(null)} />
            ) : (
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm">
                  <div className="font-medium">{p.displayName}{p.role ? <span className="text-muted-foreground"> · {p.role}</span> : null}</div>
                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {PERSON_FIELD_LABELS.filter(({ key }) => p.fields[key]).map(({ key, label }) => (
                      <span key={key}>{label}: {p.fields[key]}</span>
                    ))}
                  </div>
                  {p.notes ? <div className="text-xs text-muted-foreground mt-1">备注: {p.notes}</div> : null}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setEditingId(p.id)} className="text-xs text-primary hover:underline">编辑</button>
                  <button onClick={() => deletePerson(p.id)} className="text-xs text-red-400 hover:underline inline-flex items-center gap-1"><Trash2 className="w-3 h-3" />删除</button>
                </div>
              </div>
            )}
          </li>
        ))}
        {persons.length === 0 && !creating && (
          <li className="text-sm text-muted-foreground">还没有人员。点上面「新建人员」或从文件导入。</li>
        )}
      </ul>
    </div>
  );
}

function PersonForm({ initial, onSave, onCancel }: {
  initial?: Person;
  onSave: (data: PersonCandidate & { notes: string }) => Promise<void> | void;
  onCancel?: () => void;
}) {
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [role, setRole] = useState(initial?.role ?? '');
  const [fields, setFields] = useState<Person['fields']>(initial?.fields ?? {});
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [busy, setBusy] = useState(false);

  const setField = (k: PersonFieldKey, v: string) =>
    setFields((prev) => {
      const next = { ...prev };
      if (v.trim()) next[k] = v;
      else delete next[k];
      return next;
    });

  const save = async () => {
    if (!displayName.trim() || busy) return;
    setBusy(true);
    try {
      await onSave({ displayName: displayName.trim(), role: role.trim(), fields, notes: notes.trim() });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border border-border rounded-md p-3 bg-muted/20">
      <div className="grid grid-cols-2 gap-2">
        <Field label="显示名（如 张三）" value={displayName} setValue={setDisplayName} />
        <Field label="角色 / 职务" value={role} setValue={setRole} placeholder="创始人 / CTO / 联系人" />
        {PERSON_FIELD_LABELS.filter((f) => !f.long).map(({ key, label }) => (
          <Field key={key} label={label} value={fields[key] ?? ''} setValue={(v) => setField(key, v)} />
        ))}
      </div>
      {PERSON_FIELD_LABELS.filter((f) => f.long).map(({ key, label }) => (
        <label key={key} className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">{label}</span>
          <textarea value={fields[key] ?? ''} onChange={(e) => setField(key, e.target.value)} rows={2} className="px-3 py-2 border border-border rounded-md bg-background text-sm" />
        </label>
      ))}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">备注</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className="px-3 py-2 border border-border rounded-md bg-background text-sm" placeholder="如：用于政府类申报的对外联系人" />
      </label>
      <div className="flex gap-2">
        <button onClick={save} disabled={busy || !displayName.trim()} className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm disabled:opacity-50">{busy ? '保存中…' : '保存'}</button>
        {onCancel && <button onClick={onCancel} className="px-3 py-1.5 border border-border rounded text-sm">取消</button>}
      </div>
    </div>
  );
}

// File-driven structured importer: parse a dropped file → LLM extracts project
// facts + person candidates → user confirms / edits before saving. The facts
// form is ALSO usable for fully-manual entry (the file just pre-fills it).
function StructuredImport({ projects }: { projects: Project[] }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [targetProjectId, setTargetProjectId] = useState<string>('');
  const [facts, setFacts] = useState<ProjectFacts>({});
  const [candidates, setCandidates] = useState<PersonCandidate[]>([]);
  const [chosen, setChosen] = useState<Record<number, boolean>>({});

  const setFactField = (k: typeof FACT_LABELS[number]['key'], v: string) =>
    setFacts((prev) => {
      const next = { ...prev };
      if (v.trim()) next[k] = v;
      else delete next[k];
      return next;
    });

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const { parseDocument } = await import('@/lib/parsers');
      const text = await parseDocument(file);
      const res = await sendBg<ExtractResult>({ type: 'projectFacts.extract', payload: { text } });
      // Merge extracted facts over current (don't wipe manual entries with empties).
      setFacts((prev) => ({ ...prev, ...res.facts }));
      setCandidates(res.persons);
      const c: Record<number, boolean> = {};
      res.persons.forEach((_, i) => { c[i] = true; });
      setChosen(c);
      toast.success('抽取完成', '请核对下面的项目信息和人员，确认无误后保存（AI 可能出错）。');
    } catch (err) {
      toast.error('抽取失败', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveFacts = async () => {
    if (!targetProjectId) {
      toast.warning('请先选择项目', '项目结构化信息要挂到某个项目上。');
      return;
    }
    await sendBg({ type: 'projects.update', payload: { id: targetProjectId, patch: { facts } } });
    toast.success('项目结构化信息已保存', '下次报名生成草稿时会作为高优先上下文。');
  };

  const savePersons = async () => {
    let n = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (!chosen[i]) continue;
      const p = candidates[i]!;
      await sendBg({ type: 'persons.create', payload: { displayName: p.displayName, role: p.role, fields: p.fields } });
      n++;
    }
    toast.success(`已添加 ${n} 个人员`);
    setCandidates([]);
    setChosen({});
  };

  return (
    <details className="border border-border rounded-md">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium inline-flex items-center gap-1.5"><Upload className="w-4 h-4" />从文件导入项目信息 / 人员（结构化抽取）</summary>
      <div className="p-3 flex flex-col gap-3 border-t border-border">
        <p className="text-xs text-muted-foreground">
          上传一份 BP / 产品介绍 / 团队介绍（PDF / Word / MD / TXT），AI 抽取项目结构化事实 + 团队成员，
          <strong>你确认后再保存</strong>。也可以不传文件、直接手填下面的项目信息。
        </p>
        <label className="inline-block">
          <input type="file" accept=".pdf,.docx,.md,.txt" onChange={onFile} disabled={busy} className="hidden" />
          <span className="text-xs text-primary cursor-pointer hover:underline">{busy ? '抽取中…' : '+ 选择文件抽取'}</span>
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">项目结构化信息</span>
          <select value={targetProjectId} onChange={(e) => setTargetProjectId(e.target.value)} className="px-3 py-2 border border-border rounded-md bg-background text-sm">
            <option value="">（选择要挂到的项目）</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            {FACT_LABELS.filter((f) => !f.long).map(({ key, label }) => (
              <Field key={key} label={label} value={facts[key] ?? ''} setValue={(v) => setFactField(key, v)} />
            ))}
          </div>
          {FACT_LABELS.filter((f) => f.long).map(({ key, label }) => (
            <label key={key} className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">{label}</span>
              <textarea value={facts[key] ?? ''} onChange={(e) => setFactField(key, e.target.value)} rows={2} className="px-3 py-2 border border-border rounded-md bg-background text-sm" />
            </label>
          ))}
          <button onClick={saveFacts} className="self-start px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm">保存项目结构化信息</button>
        </div>

        {candidates.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <span className="text-sm font-medium">抽取到的团队成员（勾选后添加为人员档案）</span>
            <ul className="flex flex-col gap-1">
              {candidates.map((c, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!chosen[i]} onChange={() => setChosen((m) => ({ ...m, [i]: !m[i] }))} />
                  <span>{c.displayName}{c.role ? <span className="text-muted-foreground"> · {c.role}</span> : null}
                    {Object.keys(c.fields).length ? <span className="text-xs text-muted-foreground"> · {Object.entries(c.fields).map(([k, v]) => `${k}:${v}`).join(' ')}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            <button onClick={savePersons} className="self-start px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm">添加选中人员</button>
          </div>
        )}
      </div>
    </details>
  );
}

/**
 * V2.2 Onboarding — sets master password + adds the user's FIRST LLM config.
 * After onboarding, they can add additional providers via Settings.
 *
 * We deliberately ask only for ONE provider here (default Anthropic) to keep
 * onboarding short. Users with Chinese model preferences (DeepSeek etc.) can
 * skip onboarding's Anthropic suggestion — or, in this V2.2 design, pick a
 * different provider preset from the dropdown.
 */
function Onboarding({ onDone }: { onDone: () => void }) {
  const [masterPassword, setMasterPassword] = useState('');
  const [presetId, setPresetId] = useState<string>('anthropic'); // safe default
  const preset = useMemo(() => getProviderPreset(presetId) ?? PROVIDER_PRESETS[0]!, [presetId]);
  const [modelId, setModelId] = useState<string>(() => preset.recommendedModels[0]?.id ?? '');
  const [apiKey, setApiKey] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onPresetChange = (next: string) => {
    setPresetId(next);
    const p = getProviderPreset(next);
    if (p && p.recommendedModels.length > 0) setModelId(p.recommendedModels[0]!.id);
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (masterPassword.length < 8) throw new Error('主密码至少 8 位');
      if (!apiKey.trim()) throw new Error('API key 必填');
      if (!modelId.trim()) throw new Error('Model 必填');
      if (preset.baseURLEditable && !customBaseUrl.trim()) {
        throw new Error('自定义 Provider 必须填 Base URL');
      }
      const baseURL = preset.baseURLEditable ? customBaseUrl.trim() : preset.baseURL;
      const payload: {
        displayName: string;
        provider: 'anthropic' | 'openai-compatible';
        modelId: string;
        baseURL?: string;
        plainKey: string;
        masterPassword: string;
        setAsDefault: boolean;
      } = {
        displayName: `${preset.displayName} · ${modelId.trim()}`,
        provider: preset.protocol,
        modelId: modelId.trim(),
        plainKey: apiKey.trim(),
        masterPassword,
        setAsDefault: true,
      };
      if (baseURL) payload.baseURL = baseURL;
      const res = (await chrome.runtime.sendMessage({ type: 'llmConfig.add', payload })) as
        | { ok: true; data: unknown }
        | { ok: false; error: string };
      if (!res || !res.ok) throw new Error(('error' in (res ?? {}) && (res as { error: string }).error) || 'unknown');
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-16 p-6 border border-border rounded-lg flex flex-col gap-3">
      <h2 className="text-xl font-semibold flex items-center gap-2"><Flame className="w-5 h-5 text-orange-500" />欢迎使用 ApplyForge</h2>
      <p className="text-sm text-muted-foreground">
        首次使用需要设置主密码 + 添加 1 个 AI 模型。所有数据本地存储，
        <strong>主密码用于加密你的 API key</strong>，请妥善保管。之后可在 设置 里加更多 provider。
      </p>

      <Field label="主密码（至少 8 位，无法找回）" value={masterPassword} setValue={setMasterPassword} type="password" />

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">Provider</span>
        <select
          value={presetId}
          onChange={(e) => onPresetChange(e.target.value)}
          className="px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {PROVIDER_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.displayName}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">Model</span>
        {preset.recommendedModels.length > 0 ? (
          <select
            value={preset.recommendedModels.some((m) => m.id === modelId) ? modelId : '__custom__'}
            onChange={(e) => {
              if (e.target.value === '__custom__') setModelId('');
              else setModelId(e.target.value);
            }}
            className="px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {preset.recommendedModels.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
            <option value="__custom__">自定义</option>
          </select>
        ) : null}
        {(preset.recommendedModels.length === 0 || !preset.recommendedModels.some((m) => m.id === modelId)) && (
          <input
            type="text"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="如：gpt-4o-mini / deepseek-chat"
            className="px-3 py-2 border border-border rounded-md text-sm font-mono bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        )}
      </label>

      {preset.baseURLEditable && (
        <Field label="Base URL" value={customBaseUrl} setValue={setCustomBaseUrl} placeholder="https://..." />
      )}

      <Field label="API Key" value={apiKey} setValue={setApiKey} type="password" />

      {err && <p className="text-sm text-red-400">{err}</p>}

      <button onClick={save} disabled={busy} className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm disabled:opacity-50">
        {busy ? '保存中...' : '保存并开始'}
      </button>

      {preset.apiKeyUrl && (
        <a
          href={preset.apiKeyUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary hover:underline"
        >
          点击获取 {preset.displayName} API KEY ↗
        </a>
      )}
    </div>
  );
}

function Field({ label, value, setValue, type = 'text', placeholder }: { label: string; value: string; setValue: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </label>
  );
}

// ----- Stubs to be expanded in follow-up commits -----

function ProjectsPane() {
  const projects = useLiveQuery(() => db.projects.toArray(), []) ?? [];
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const create = async () => {
    if (!name.trim()) return;
    await chrome.runtime.sendMessage({
      type: 'projects.create',
      payload: { name: name.trim(), description: description.trim(), tags: [] },
    });
    setName('');
    setDescription('');
    setCreating(false);
  };

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <header className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">项目档案</h2>
        <button onClick={() => setCreating(true)} className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm">+ 新建项目</button>
      </header>

      {creating && (
        <div className="border border-border rounded p-4 flex flex-col gap-3">
          <Field label="项目名" value={name} setValue={setName} />
          <Field label="一句话描述" value={description} setValue={setDescription} />
          <div className="flex gap-2">
            <button onClick={create} className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm">创建</button>
            <button onClick={() => setCreating(false)} className="px-3 py-1.5 border border-border rounded text-sm">取消</button>
          </div>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {projects.map((p: Project) => (
          <li key={p.id} className="border border-border rounded p-3 text-sm">
            <strong className="inline-flex items-center gap-1"><Folder className="w-3.5 h-3.5" />{p.name}</strong>
            <p className="text-muted-foreground text-xs">{p.description}</p>
            <p className="text-xs mt-1">已用于 {p.applicationCount} 次报名 · 创建于 {new Date(p.createdAt).toLocaleDateString()}</p>
            <DocumentManager projectId={p.id} />
            <AssetManager projectId={p.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function DocumentManager({ projectId }: { projectId: string }) {
  const docs = useLiveQuery(() => db.documents.where('projectId').equals(projectId).toArray(), [projectId]) ?? [];
  const [uploading, setUploading] = useState(false);
  const toast = useToast();

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setUploading(true);
    let succeeded = 0;
    try {
      // Parse here in the UI context so we ship plain text (not ArrayBuffer)
      // to the service worker — see the note in background.uploadDocument.
      const { parseDocument } = await import('@/lib/parsers');
      for (const f of files) {
        try {
          const text = await parseDocument(f);
          await chrome.runtime.sendMessage({
            type: 'documents.upload',
            payload: {
              projectId,
              filename: f.name,
              mimeType: f.type,
              sizeBytes: f.size,
              text,
            },
          });
          succeeded++;
        } catch (err) {
          // Surface the parse failure via a toast (was: alert which broke flow).
          toast.error(`解析失败：${f.name}`, err instanceof Error ? err.message : String(err));
        }
      }
      // Reset input so the same file can be re-uploaded after fixing.
      e.target.value = '';
      if (succeeded > 0) {
        toast.success(`已上传 ${succeeded} 份文档`, '索引完成后即可参与 RAG。');
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mt-3 pl-3 border-l border-border">
      <p className="text-xs text-muted-foreground mb-1 inline-flex items-center gap-1"><FileText className="w-3 h-3" />已上传 {docs.length} 份文档</p>
      <ul className="text-xs flex flex-col gap-2">
        {docs.map((d) => (
          <li key={d.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span>{d.parseStatus === 'parsed' ? '✅' : d.parseStatus === 'failed' ? '❌' : '⏳'}</span>
              <span className="truncate">{d.filename}</span>
              <span className="text-muted-foreground">({Math.round(d.sizeBytes / 1024)} KB)</span>
              {d.parseStatus === 'failed' && (
                <button
                  onClick={async () => {
                    try {
                      await sendBg({ type: 'documents.reindex', payload: { id: d.id } });
                      toast.success('重新索引完成', `${d.filename}`);
                    } catch (err) {
                      toast.error(
                        '重试失败',
                        `${err instanceof Error ? err.message : String(err)}\n\n如果反复失败，请去 chrome://extensions 上点 🔄 Reload 后再试。`,
                      );
                    }
                  }}
                  className="ml-auto px-2 py-0.5 text-[11px] bg-primary/20 text-primary rounded hover:bg-primary/30"
                  title="重新索引"
                >
                  ↻ 重试
                </button>
              )}
              <button
                onClick={async () => {
                  if (!confirm(`删除 ${d.filename}？`)) return;
                  try {
                    await sendBg({ type: 'documents.delete', payload: { id: d.id } });
                  } catch (err) {
                    toast.error('删除失败', err instanceof Error ? err.message : String(err));
                  }
                }}
                className={`${d.parseStatus === 'failed' ? '' : 'ml-auto'} text-muted-foreground hover:text-red-500 px-1`}
                title="删除"
              >
                🗑
              </button>
            </div>
            {d.parseStatus === 'failed' && d.parseError && (
              <div className="ml-6 text-[11px] text-red-400 bg-red-500/10 rounded px-2 py-1 break-all">
                {d.parseError}
              </div>
            )}
          </li>
        ))}
      </ul>
      <label className="inline-block mt-2">
        <input type="file" multiple accept=".pdf,.docx,.md,.txt" onChange={onUpload} disabled={uploading} className="hidden" />
        <span className="text-xs text-primary cursor-pointer hover:underline">{uploading ? '上传中...' : '+ 上传 PDF / DOCX / MD / TXT'}</span>
      </label>
    </div>
  );
}

interface AssetSummary {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  tag: 'photo' | 'logo' | 'pitch';
  notes?: string;
  createdAt: number;
}

function AssetManager({ projectId }: { projectId: string }) {
  // Live query directly on the assets table (we strip the blob in the
  // background message handler, but for the manager UI we don't ship the blob
  // over the wire — instead live-query the metadata-only columns).
  const assets = useLiveQuery(
    async () => {
      const rows = await db.projectAssets.where('projectId').equals(projectId).toArray();
      return rows.map((a) => ({
        id: a.id, filename: a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes,
        tag: a.tag, notes: a.notes, createdAt: a.createdAt,
      })) as AssetSummary[];
    },
    [projectId],
  ) ?? [];
  const [uploading, setUploading] = useState(false);
  const [pendingTag, setPendingTag] = useState<'photo' | 'logo' | 'pitch'>('photo');
  const toast = useToast();

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setUploading(true);
    try {
      for (const f of files) {
        const bytes = await f.arrayBuffer();
        await sendBg({
          type: 'assets.upload',
          payload: {
            projectId,
            filename: f.name,
            mimeType: f.type || guessMimeFromName(f.name),
            sizeBytes: f.size,
            tag: pendingTag,
            bytes,
          },
        });
      }
      e.target.value = '';
      if (files.length > 0) {
        toast.success(`已上传 ${files.length} 个资产`, '可在 sidepanel 看到自动匹配的字段。');
      }
    } catch (err) {
      toast.error('上传失败', err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const tagLabel: Record<'photo' | 'logo' | 'pitch', string> = {
    photo: '📷 项目照片',
    logo: '🏷 Logo',
    pitch: '📄 PPT / PDF',
  };
  const tagAccept: Record<'photo' | 'logo' | 'pitch', string> = {
    photo: 'image/png,image/jpeg,image/webp',
    logo: 'image/png,image/jpeg,image/svg+xml',
    pitch: 'application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };

  return (
    <div className="mt-3 pl-3 border-l border-primary/40">
      <p className="text-xs text-muted-foreground mb-1 inline-flex items-center gap-1"><FolderOpen className="w-3 h-3" />项目资产（自动填入表单的文件字段）{assets.length > 0 && ` · ${assets.length} 个`}</p>
      <ul className="text-xs flex flex-col gap-2 mb-2">
        {assets.map((a) => (
          <li key={a.id} className="flex items-center gap-2">
            <span>{tagLabel[a.tag]}</span>
            <span className="truncate">{a.filename}</span>
            <span className="text-muted-foreground">({Math.round(a.sizeBytes / 1024)} KB)</span>
            <button
              onClick={async () => {
                if (!confirm(`删除 ${a.filename}？`)) return;
                try {
                  await sendBg({ type: 'assets.delete', payload: { id: a.id } });
                } catch (err) {
                  toast.error('删除失败', err instanceof Error ? err.message : String(err));
                }
              }}
              className="ml-auto text-muted-foreground hover:text-red-500 px-1"
              title="删除"
            >
              🗑
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">类别：</span>
        <select
          value={pendingTag}
          onChange={(e) => setPendingTag(e.target.value as 'photo' | 'logo' | 'pitch')}
          className="px-2 py-1 border border-border rounded text-xs"
        >
          <option value="photo">项目照片</option>
          <option value="logo">Logo</option>
          <option value="pitch">PPT / PDF</option>
        </select>
        <label className="inline-block ml-2">
          <input
            type="file"
            multiple
            accept={tagAccept[pendingTag]}
            onChange={onUpload}
            disabled={uploading}
            className="hidden"
          />
          <span className="text-primary cursor-pointer hover:underline">{uploading ? '上传中...' : `+ 上传 ${tagLabel[pendingTag]}`}</span>
        </label>
      </div>
    </div>
  );
}

function guessMimeFromName(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml',
    pdf: 'application/pdf',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return map[ext] ?? 'application/octet-stream';
}

function HistoryPane() {
  const records = useLiveQuery(() => db.qaRecords.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const toast = useToast();
  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      <h2 className="text-xl font-semibold">历史经验库</h2>
      <p className="text-sm text-muted-foreground">
        每次点 "我已提交，沉淀经验" 后会出现在这里。每条记录里的 Q&A 都会自动作为下次类似字段的 RAG 参考，
        让 AI 越来越懂你的回答风格。
      </p>
      <ul className="flex flex-col gap-2">
        {records.length === 0 ? (
          <li className="text-sm text-muted-foreground">尚无历史记录。完成一次报名后会自动出现。</li>
        ) : (
          records.map((r) => (
            <li key={r.id} className="border border-border rounded p-3 text-sm flex items-start gap-3">
              <div className="flex-1">
                <strong>{r.pageTitle || '未命名活动'}</strong>
                <p className="text-xs text-muted-foreground">
                  {new Date(r.submittedAt ?? r.createdAt).toLocaleString()} · {r.qaPairs.length} 字段
                  {r.status !== 'submitted' && <span className="ml-2 text-amber-400">（草稿）</span>}
                </p>
                <p className="text-xs mt-1">
                  采纳率: {Math.round((r.stats.accepted + r.stats.edited_minor) / Math.max(r.qaPairs.length, 1) * 100)}%
                </p>
              </div>
              <button
                onClick={async () => {
                  if (!confirm(`删除「${r.pageTitle || '未命名活动'}」这条记录？\n\n删除后它的 Q&A 不再参与未来 RAG 召回。本地下载的 markdown 文件不受影响。`)) return;
                  try {
                    await sendBg({ type: 'qaRecord.delete', payload: { id: r.id } });
                    toast.success('已删除', `${r.pageTitle || '未命名活动'}`);
                  } catch (err) {
                    toast.error('删除失败', err instanceof Error ? err.message : String(err));
                  }
                }}
                className="text-muted-foreground hover:text-red-500 px-1"
                title="删除这条记录（不影响下载的 markdown）"
              >
                🗑
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/**
 * V0.3.0 (PRD §10) — field-scan strategy selector. Writes AppSettings.scanMode via the existing
 * settings.save message (key-less patch → no master password needed). hybrid / llm require at
 * least one configured model, so they're disabled until the user adds one. Icons are lucide-react
 * (durable rule #2 — never emoji).
 */
function ScanModeSettings({ scanMode, hasModel }: { scanMode: ScanMode; hasModel: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const options: { id: ScanMode; Icon: typeof Wrench; label: string; desc: string; needsModel: boolean }[] = [
    { id: 'heuristic', Icon: Wrench, label: '启发式（默认）', desc: '现有规则扫描，零 LLM 成本，最快', needsModel: false },
    { id: 'hybrid', Icon: Sparkles, label: '混合（推荐）', desc: '启发式 + LLM 补漏，换表单更少漏检', needsModel: true },
    { id: 'llm', Icon: Bot, label: '纯 LLM（实验）', desc: '完全靠 LLM 语义识别，换表单不改代码', needsModel: true },
  ];

  const pick = async (mode: ScanMode) => {
    if (mode === scanMode || busy) return;
    setBusy(true);
    try {
      await sendBg({ type: 'settings.save', payload: { patch: { scanMode: mode } } });
      toast.success('已切换扫描模式', '下次扫描生效');
    } catch (err) {
      toast.error('保存失败', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-md border border-border p-4 flex flex-col gap-3">
      <h3 className="text-sm font-medium">扫描模式</h3>
      <p className="text-xs text-muted-foreground -mt-2">
        决定字段如何被识别。换没见过的表单时，混合 / 纯 LLM 更少漏检（每张新表单一次 LLM 调用，结果缓存）。
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {options.map(({ id, Icon, label, desc, needsModel }) => {
          const disabled = (needsModel && !hasModel) || busy;
          const active = id === scanMode;
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => void pick(id)}
              title={needsModel && !hasModel ? '需先在下方添加模型' : desc}
              className={`text-left rounded-md border p-3 flex flex-col gap-1 transition-colors ${
                active ? 'border-primary ring-1 ring-primary/40 bg-primary/5' : 'border-border hover:bg-muted/30'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${active ? 'text-primary' : ''}`}>
                <Icon size={16} aria-hidden /> {label}
              </span>
              <span className="text-[11px] text-muted-foreground">{desc}</span>
              {needsModel && !hasModel && <span className="text-[10px] text-amber-600">需先添加模型</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * V2.2 SettingsPane — completely redesigned to match a "config library" model.
 * The top form lets users add a new LLM provider (preset OR custom). The
 * bottom list shows all configured providers, with click-to-set-default,
 * expand-for-details, and delete actions.
 *
 * Reference design: PM provided a screenshot showing this exact layout in
 * another tool, requesting the same pattern here.
 */
function SettingsPane({ settings }: { settings: AppSettings | undefined }) {
  const configs = settings?.llmConfigs ?? [];

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <h2 className="text-xl font-semibold">设置</h2>

      <ScanModeSettings scanMode={settings?.scanMode ?? 'heuristic'} hasModel={configs.length > 0} />

      <LLMConfigAddForm hasExistingConfigs={configs.length > 0} />

      <LLMConfigList configs={configs} />
    </div>
  );
}

/**
 * V2.2 — "Add new model" form. Picks a provider preset, autofills baseURL,
 * shows curated model list per preset, takes API key + master password,
 * submits via llmConfig.add.
 */
function LLMConfigAddForm({ hasExistingConfigs }: { hasExistingConfigs: boolean }) {
  const toast = useToast();
  // Default to "OpenAI" preset since it's the most universally recognized;
  // user can re-select via the dropdown.
  const [presetId, setPresetId] = useState<string>('openai');
  const preset = useMemo(() => getProviderPreset(presetId) ?? PROVIDER_PRESETS[0]!, [presetId]);
  const [modelId, setModelId] = useState<string>(() => preset.recommendedModels[0]?.id ?? '');
  const [customBaseUrl, setCustomBaseUrl] = useState<string>('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [masterPassword, setMasterPassword] = useState('');
  const [busy, setBusy] = useState(false);

  // When preset changes, reset model + baseURL to that preset's defaults.
  const onPresetChange = (next: string) => {
    setPresetId(next);
    const p = getProviderPreset(next);
    if (p && p.recommendedModels.length > 0) {
      setModelId(p.recommendedModels[0]!.id);
    } else if (p) {
      setModelId(''); // custom preset has no recommended models
    }
  };

  const submit = async () => {
    if (!masterPassword) { toast.warning('主密码必填', '需要主密码加密这个 key'); return; }
    if (!apiKey.trim()) { toast.warning('API Key 必填'); return; }
    if (!modelId.trim()) { toast.warning('Model 必填'); return; }
    if (preset.baseURLEditable && !customBaseUrl.trim()) {
      toast.warning('Base URL 必填', '自定义 Provider 必须填 baseURL');
      return;
    }
    setBusy(true);
    try {
      const baseURL = preset.baseURLEditable ? customBaseUrl.trim() : preset.baseURL;
      // Compose a friendly display name: "OpenAI · gpt-4o-mini" / "DeepSeek · deepseek-chat"
      const displayName = `${preset.displayName} · ${modelId}`;
      const payload: {
        displayName: string;
        provider: 'anthropic' | 'openai-compatible';
        modelId: string;
        baseURL?: string;
        plainKey: string;
        masterPassword: string;
        setAsDefault: boolean;
      } = {
        displayName,
        provider: preset.protocol,
        modelId: modelId.trim(),
        plainKey: apiKey.trim(),
        masterPassword,
        setAsDefault: true,
      };
      if (baseURL) payload.baseURL = baseURL;
      await sendBg({ type: 'llmConfig.add', payload });
      toast.success('已添加', `${displayName}`);
      // Clear sensitive inputs after success
      setApiKey('');
      setMasterPassword('');
      setShowKey(false);
    } catch (err) {
      toast.error('添加失败', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-md border border-border p-4 flex flex-col gap-3">
      <h3 className="text-sm font-medium">添加新模型</h3>
      <p className="text-xs text-muted-foreground -mt-2">
        {hasExistingConfigs
          ? '加新 Provider 需要用之前添加 config 时设的同一个主密码。'
          : '第一次添加请记好主密码 —— 它用于加密所有 API key，丢了之后所有 key 都得重添加。'}
      </p>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">主密码（必填）</span>
        <input
          type="password"
          value={masterPassword}
          onChange={(e) => setMasterPassword(e.target.value)}
          className="px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">Provider</span>
        <select
          value={presetId}
          onChange={(e) => onPresetChange(e.target.value)}
          className="px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {PROVIDER_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.displayName}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">Model</span>
        {preset.recommendedModels.length > 0 ? (
          <select
            value={preset.recommendedModels.some((m) => m.id === modelId) ? modelId : '__custom__'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__custom__') {
                setModelId(''); // user will type
              } else {
                setModelId(v);
              }
            }}
            className="px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {preset.recommendedModels.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
            <option value="__custom__">自定义（输入完整 model ID）</option>
          </select>
        ) : null}
        {/* Show free-form input when the preset has no curated list (custom) OR
            the user selected the "自定义" option above. */}
        {(preset.recommendedModels.length === 0 || !preset.recommendedModels.some((m) => m.id === modelId)) && (
          <input
            type="text"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="如：gpt-4o-mini / deepseek-chat / claude-sonnet-4-6"
            className="px-3 py-2 border border-border rounded-md text-sm font-mono bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        )}
      </label>

      {/* Base URL field — only shown for "Custom" preset since other presets have fixed URLs. */}
      {preset.baseURLEditable && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Base URL</span>
          <input
            type="text"
            value={customBaseUrl}
            onChange={(e) => setCustomBaseUrl(e.target.value)}
            placeholder="https://your-llm-proxy.example.com/v1"
            className="px-3 py-2 border border-border rounded-md text-sm font-mono bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">API Key</span>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="请输入 API Key"
            className="w-full px-3 py-2 pr-9 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            title={showKey ? '隐藏' : '显示'}
            aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
          >
            {showKey ? '🙈' : '👁'}
          </button>
        </div>
      </label>

      <button
        onClick={submit}
        disabled={busy}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        {busy ? '添加中...' : '添加为默认'}
      </button>

      <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
        ℹ️ {preset.description}
        {preset.apiKeyUrl && (
          <a
            href={preset.apiKeyUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline ml-1"
          >
            点击获取 API KEY ↗
          </a>
        )}
      </div>
    </section>
  );
}

/**
 * V2.2 — "已接入的模型" list. Each row:
 *   - Click body → set as default
 *   - Click ▶ → expand to show config details
 *   - Click 🗑 → delete (with confirmation)
 */
function LLMConfigList({ configs }: { configs: LLMConfig[] }) {
  const toast = useToast();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (configs.length === 0) {
    return (
      <section className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        还没添加任何模型 —— 上方"添加新模型"开始。
      </section>
    );
  }

  const setActive = async (id: string) => {
    try {
      await sendBg({ type: 'llmConfig.setActive', payload: { id } });
      const cfg = configs.find((c) => c.id === id);
      toast.success('已切为默认', cfg?.displayName ?? id);
    } catch (err) {
      toast.error('切换默认失败', err instanceof Error ? err.message : String(err));
    }
  };

  const onDelete = async (cfg: LLMConfig) => {
    if (!confirm(`删除"${cfg.displayName}"？\n\n删除后这个 API key 会从加密存储中清除，不可恢复。`)) return;
    try {
      await sendBg({ type: 'llmConfig.delete', payload: { id: cfg.id } });
      toast.success('已删除', cfg.displayName);
    } catch (err) {
      toast.error('删除失败', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">已接入的模型</h3>
      <p className="text-xs text-muted-foreground -mt-1">
        点行 = 设为默认（sidepanel 用这个生成）· 点 ▶ 看细节 · 点 🗑 删除
      </p>
      <div className="rounded-md border border-border divide-y divide-border">
        {configs.map((cfg) => {
          const isOpen = !!expanded[cfg.id];
          return (
            <div key={cfg.id} className={cfg.isDefault ? 'bg-primary/5' : ''}>
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setExpanded((s) => ({ ...s, [cfg.id]: !s[cfg.id] }))}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={isOpen ? '收起' : '展开'}
                >
                  {isOpen ? '▼' : '▶'}
                </button>
                <button
                  type="button"
                  onClick={() => !cfg.isDefault && void setActive(cfg.id)}
                  disabled={cfg.isDefault}
                  className={`flex-1 text-left text-sm ${
                    cfg.isDefault ? 'cursor-default' : 'hover:text-primary cursor-pointer'
                  }`}
                  title={cfg.isDefault ? '已是默认' : '点击设为默认'}
                >
                  <span>{cfg.displayName}</span>
                </button>
                {cfg.isDefault && (
                  <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                    当前默认
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void onDelete(cfg)}
                  className="text-muted-foreground hover:text-red-500 px-1"
                  title="删除"
                  aria-label="删除"
                >
                  🗑
                </button>
              </div>
              {isOpen && (
                <div className="px-9 py-2 text-xs text-muted-foreground space-y-1 font-mono bg-muted/30">
                  <div><span className="opacity-70">Provider:</span> {cfg.provider}</div>
                  <div><span className="opacity-70">Model:</span> {cfg.modelId}</div>
                  {cfg.baseURL && (
                    <div className="break-all"><span className="opacity-70">Base URL:</span> {cfg.baseURL}</div>
                  )}
                  <div><span className="opacity-70">Key:</span> ••••••••（加密存储 / 不可显）</div>
                  <div className="opacity-50">id: {cfg.id}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BackupPane() {
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const onExport = async () => {
    setBusy('export');
    setStatus(null);
    try {
      const res = (await sendBg({ type: 'backup.export' })) as { json: string; sizeBytes: number; counts: Record<string, number> };
      // Save via download — same data-URL trick we use for Q&A markdown so it
      // works in the service-worker context.
      const utf8 = new TextEncoder().encode(res.json);
      let binary = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < utf8.length; i += CHUNK) binary += String.fromCharCode(...utf8.subarray(i, i + CHUNK));
      const dataUrl = `data:application/json;charset=utf-8;base64,${btoa(binary)}`;
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `applyforge-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      const summary = Object.entries(res.counts).map(([k, v]) => `${k}: ${v}`).join(' · ');
      setStatus(`✅ 已导出 ${(res.sizeBytes / 1024).toFixed(1)} KB（${summary}）`);
    } catch (err) {
      setStatus(`❌ 导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm(
      `⚠️ 这会替换你现在所有的数据（项目档案、文档、Q&A 经验库、设置、资产）。\n\n` +
      `从备份恢复后，原有数据无法找回（除非你已经导出过）。\n\n` +
      `继续吗？`,
    )) {
      e.target.value = '';
      return;
    }
    setBusy('import');
    setStatus(null);
    try {
      const jsonText = await file.text();
      const res = (await sendBg({ type: 'backup.import', payload: { jsonText } })) as { counts: Record<string, number> };
      const summary = Object.entries(res.counts).map(([k, v]) => `${k}: ${v}`).join(' · ');
      setStatus(`✅ 已恢复（${summary}）。刷新页面以看到新数据。`);
    } catch (err) {
      setStatus(`❌ 恢复失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
      e.target.value = '';
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <h2 className="text-xl font-semibold">备份 / 恢复</h2>
      <p className="text-sm text-muted-foreground">
        所有数据本地存在浏览器 IndexedDB 里 —— 换电脑、清浏览器或重装插件都会丢。
        定期导出一份保存到云盘 / U 盘，需要时一键恢复。
      </p>

      <section className="rounded-md border border-border p-4 flex flex-col gap-3">
        <h3 className="text-sm font-medium inline-flex items-center gap-1"><Download className="w-3.5 h-3.5" />导出</h3>
        <p className="text-xs text-muted-foreground">
          导出一份 JSON 备份，包含：项目档案、上传的文档、文档解析片段、活动背景、Q&A 经验库、项目资产（图片/PPT 二进制）、API key（保持加密 — 只有用主密码才能解）。
        </p>
        <button
          onClick={onExport}
          disabled={busy !== null}
          className="self-start px-4 py-2 bg-primary text-primary-foreground rounded text-sm disabled:opacity-50"
        >
          {busy === 'export' ? '导出中...' : '📤 导出备份到本地'}
        </button>
      </section>

      <section className="rounded-md border border-red-500/40 p-4 flex flex-col gap-3">
        <h3 className="text-sm font-medium text-red-300 inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />从备份恢复（覆盖当前数据）</h3>
        <p className="text-xs text-muted-foreground">
          选一份之前导出的 JSON 备份文件，<strong>当前所有本地数据会被替换</strong>。建议先点上面"导出备份"留个底再操作。
        </p>
        <label className="self-start">
          <input
            type="file"
            accept="application/json,.json"
            onChange={onImport}
            disabled={busy !== null}
            className="hidden"
          />
          <span className="inline-block px-4 py-2 border border-red-500/60 text-red-300 rounded text-sm cursor-pointer hover:bg-red-500/10">
            {busy === 'import' ? '恢复中...' : '📥 选 JSON 备份文件恢复'}
          </span>
        </label>
      </section>

      {status && (
        <div className={`rounded-md p-3 text-sm ${
          status.startsWith('✅') ? 'border border-green-500/40 bg-green-500/10 text-green-300' : 'border border-red-500/40 bg-red-500/10 text-red-300'
        }`}>
          {status}
        </div>
      )}
    </div>
  );
}
