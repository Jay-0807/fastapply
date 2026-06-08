// Reusable model picker — used in both the options Settings tab and the
// side panel's per-session model override.
//
// V2.1 (2026-05-24): provider-aware. When provider='anthropic', shows a
// curated Claude list. When provider='openai-compatible', shows a free-form
// text input with popular model-ID suggestions (because each provider —
// DeepSeek / Moonshot / GLM / etc. — has its own naming convention; one
// curated list would be wrong everywhere).
//
// We deliberately don't call /v1/models at runtime — that would require
// unlocking the API key inside the picker, and we want this component to
// stay pure-presentational.

import { useState } from 'react';
import type { LLMProviderType } from '@/lib/db/types';

export interface ModelOption {
  /** Wire-level model ID, e.g. "claude-opus-4-7" or "deepseek-chat". */
  id: string;
  /** Human-readable label shown in the dropdown. */
  label: string;
  /** Short description shown under the dropdown when this model is selected. */
  description?: string;
}

/**
 * Curated list of currently-recommended Anthropic models (as of 2026-05).
 * Update when Anthropic ships a new generation — but the "custom" option
 * means an outdated list is never blocking; users can always type the new ID.
 */
export const RECOMMENDED_MODELS: ModelOption[] = [
  {
    id: 'claude-opus-4-7',
    label: 'Opus 4.7（最强 / 最贵）',
    description: '最高质量，适合需要深度推理的复杂字段。约 $5/M input, $25/M output。',
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6（推荐 · 平衡）',
    description: '1M context, adaptive thinking, 更新的 instruction following。约 $3/M input, $15/M output。',
  },
  {
    id: 'claude-sonnet-4-5',
    label: 'Sonnet 4.5（legacy 但稳）',
    description: '上一代 Sonnet。能跑，但建议升级到 4.6。',
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5（最快 / 最便宜）',
    description: '简单字段或高频调用。约 $1/M input, $5/M output。',
  },
];

/**
 * V2.1: common OpenAI-compatible model IDs. Shown as quick-pick buttons
 * under the free-form input. Not exhaustive — user can type any model their
 * configured base URL supports.
 */
export const OPENAI_COMPAT_SUGGESTIONS: ModelOption[] = [
  { id: 'gpt-4o', label: 'gpt-4o', description: 'OpenAI · 主力 ~$2.50/M in, $10/M out' },
  { id: 'gpt-4o-mini', label: 'gpt-4o-mini', description: 'OpenAI · 便宜版 ~$0.15/M in, $0.60/M out' },
  { id: 'deepseek-chat', label: 'deepseek-chat', description: 'DeepSeek · V3 ¥1/M in, ¥2/M out（人民币）' },
  { id: 'deepseek-reasoner', label: 'deepseek-reasoner', description: 'DeepSeek · R1 推理 ¥4/M in, ¥16/M out' },
  { id: 'moonshot-v1-32k', label: 'moonshot-v1-32k', description: 'Kimi · 32K 上下文 ¥24/M in/out' },
  { id: 'glm-4-plus', label: 'glm-4-plus', description: '智谱 GLM · 旗舰 ¥50/M' },
  { id: 'glm-4-flash', label: 'glm-4-flash', description: '智谱 GLM · 便宜款，几乎免费' },
  { id: 'qwen-max', label: 'qwen-max', description: '阿里 · 通义旗舰' },
  { id: 'qwen-plus', label: 'qwen-plus', description: '阿里 · 通义平衡款' },
];

const CUSTOM_SENTINEL = '__custom__';

export function ModelPicker({
  value,
  onChange,
  label = '默认模型',
  hint,
  provider = 'anthropic',
}: {
  value: string;
  onChange: (modelId: string) => void;
  label?: string;
  hint?: string;
  /**
   * V2.1: which protocol the picker is for. Determines whether to show the
   * Claude curated list (anthropic) or the OpenAI-compatible free-form input.
   */
  provider?: LLMProviderType;
}) {
  // Hooks must run in the same order every render — keep them above the
  // openai-compatible early return below. Both useStates are cheap and have
  // no side effects in the openai-compatible branch (the state simply goes
  // unused since OpenAICompatModelInput owns its own input state).
  const isRecommended = RECOMMENDED_MODELS.some((m) => m.id === value);
  // Local state for the dropdown selector + custom text input. We keep them
  // separated so that switching back from "Custom" to a known model doesn't
  // clobber whatever the user typed.
  const [mode, setMode] = useState<string>(isRecommended ? value : CUSTOM_SENTINEL);
  const [customId, setCustomId] = useState<string>(isRecommended ? '' : value);

  // V2.1: branching by provider. OpenAI-compatible uses a free-form input
  // with popular-suggestion chips, since "the right model list" is per-baseURL
  // and we'd be wrong for any individual user.
  if (provider === 'openai-compatible') {
    return <OpenAICompatModelInput value={value} onChange={onChange} label={label} hint={hint} />;
  }

  const onSelect = (next: string) => {
    setMode(next);
    if (next === CUSTOM_SENTINEL) {
      // Don't blow up the parent's value yet — wait for the user to type.
      // If they already had a custom value, keep it.
      if (customId) onChange(customId);
    } else {
      onChange(next);
    }
  };

  const onCustomChange = (next: string) => {
    setCustomId(next);
    if (mode === CUSTOM_SENTINEL) onChange(next);
  };

  const selected = RECOMMENDED_MODELS.find((m) => m.id === mode);

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs text-muted-foreground">
        {label}
        {hint && <span className="ml-1 text-muted-foreground/70">{hint}</span>}
      </span>
      <select
        value={mode}
        onChange={(e) => onSelect(e.target.value)}
        className="px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {RECOMMENDED_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
        <option value={CUSTOM_SENTINEL}>自定义（输入完整 model ID）</option>
      </select>

      {selected?.description && (
        <p className="text-[11px] text-muted-foreground">{selected.description}</p>
      )}

      {mode === CUSTOM_SENTINEL && (
        <>
          <input
            type="text"
            value={customId}
            onChange={(e) => onCustomChange(e.target.value)}
            placeholder="例如：claude-opus-4-7"
            className="px-3 py-2 border border-border rounded-md text-sm font-mono"
          />
          <p className="text-[11px] text-muted-foreground">
            输入你的 API key 能调用的任意 Anthropic 模型 ID（建议用裸 alias，不要带日期后缀）。
            查阅完整列表：
            <a
              href="https://docs.claude.com/en/docs/about-claude/models/overview"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline ml-1"
            >
              Anthropic 模型清单 ↗
            </a>
          </p>
        </>
      )}
    </div>
  );
}

/**
 * V2.1: OpenAI-compatible model input. Free-form text + quick-pick chips for
 * common providers. The chip clicks just dump the model ID into the input —
 * the user is expected to have already configured the matching Base URL in
 * Settings (e.g. choose deepseek-chat → make sure baseURL = api.deepseek.com/v1).
 */
function OpenAICompatModelInput({
  value,
  onChange,
  label,
  hint,
}: {
  value: string;
  onChange: (modelId: string) => void;
  label: string;
  hint: string | undefined;
}) {
  // Match the value against suggestions to highlight which chip is "active".
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs text-muted-foreground">
        {label}
        {hint && <span className="ml-1 text-muted-foreground/70">{hint}</span>}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="如：deepseek-chat / gpt-4o / moonshot-v1-32k"
        className="px-3 py-2 border border-border rounded-md text-sm font-mono"
      />
      <p className="text-[11px] text-muted-foreground">
        快速填入（点了直接覆盖上面输入）：
      </p>
      <div className="flex flex-wrap gap-1.5">
        {OPENAI_COMPAT_SUGGESTIONS.map((s) => {
          const active = s.id === value;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onChange(s.id)}
              className={`px-2 py-0.5 text-[11px] rounded border transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border hover:bg-muted'
              }`}
              title={s.description}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground/80 mt-0.5">
        ⚠️ 模型名必须和你设置的 Base URL 匹配。例如 <code className="font-mono">deepseek-chat</code> 配 <code className="font-mono">api.deepseek.com/v1</code>。
      </p>
    </div>
  );
}
