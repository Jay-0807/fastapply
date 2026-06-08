// Provider catalog — the curated registry of LLM providers ApplyForge knows
// about out of the box. V2.2 added; replaces the hand-rolled provider/model
// pickers that lived in components/ModelPicker.tsx for V2.1.
//
// Each preset is a complete bundle of (protocol, baseURL, recommended models,
// metadata) so the Settings "Add new model" form just needs the user to pick
// a preset + paste their key. Custom OpenAI-compatible endpoints (self-hosted
// vLLM, local Ollama, anything else) are covered by the 'custom' preset.
//
// To add a new provider:
//   1. Append a ProviderPreset to PROVIDER_PRESETS below.
//   2. Recommended-model list updates flow automatically through the picker.
//   3. No code changes needed elsewhere.

import type { LLMProviderType } from '@/lib/db/types';

export interface PresetModel {
  /** Wire-level model ID, e.g. "gpt-4o-mini" / "claude-sonnet-4-6". */
  id: string;
  /** Human-readable label shown in the dropdown. */
  label: string;
  /** Short description shown under the dropdown when this model is selected. */
  description?: string;
}

export interface ProviderPreset {
  /** Stable preset id, e.g. "openai", "deepseek", "anthropic", "custom". */
  id: string;
  /** Friendly name shown in the Provider dropdown. */
  displayName: string;
  /** Which wire protocol this preset uses. */
  protocol: LLMProviderType;
  /**
   * Fixed base URL for this preset. Empty for 'anthropic' (SDK handles it)
   * and 'custom' (user fills in their own).
   */
  baseURL: string;
  /** Whether the user needs to fill in baseURL themselves (only true for 'custom'). */
  baseURLEditable: boolean;
  /** Curated model list — what the Model dropdown shows. User can also type a custom ID. */
  recommendedModels: PresetModel[];
  /** Short description shown under the picker; helps the user pick. */
  description: string;
  /** Direct link to "where do I get an API key" — opens in a new tab. */
  apiKeyUrl?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    displayName: 'Anthropic（Claude）',
    protocol: 'anthropic',
    baseURL: '',
    baseURLEditable: false,
    description: '由 Anthropic 直接提供的 Claude 模型。需要 Anthropic 账号 + 信用卡（暂不支持中国大陆地址）。',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    recommendedModels: [
      { id: 'claude-opus-4-7', label: 'Opus 4.7（最强 / 最贵）', description: '最高质量，深度推理。约 $5/M in, $25/M out。' },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6（推荐 · 平衡）', description: '1M context, adaptive thinking。约 $3/M in, $15/M out。' },
      { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5（legacy 但稳）', description: '上一代 Sonnet。建议升级到 4.6。' },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5（最快 / 最便宜）', description: '简单字段或高频调用。约 $1/M in, $5/M out。' },
    ],
  },
  {
    id: 'openai',
    displayName: 'OpenAI',
    protocol: 'openai-compatible',
    baseURL: 'https://api.openai.com/v1',
    baseURLEditable: false,
    description: 'OpenAI 系列模型，全球开发者使用最广泛的模型之一，适合代码生成、复杂推理与 Agent 开发场景。',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    recommendedModels: [
      { id: 'gpt-4o', label: 'gpt-4o（旗舰多模态）', description: '约 $2.50/M in, $10/M out。' },
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini（便宜版）', description: '约 $0.15/M in, $0.60/M out。' },
      { id: 'gpt-4-turbo', label: 'gpt-4-turbo', description: '上一代旗舰，仍稳定。' },
      { id: 'o1-mini', label: 'o1-mini（推理）', description: 'OpenAI 推理款，适合复杂逻辑。' },
    ],
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    protocol: 'openai-compatible',
    baseURL: 'https://api.deepseek.com/v1',
    baseURLEditable: false,
    description: '深度求索（DeepSeek）系列。极高性价比的国产模型，V3 通用 + R1 推理。',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    recommendedModels: [
      { id: 'deepseek-chat', label: 'deepseek-chat（V3）', description: '通用对话，¥1/M in, ¥2/M out。' },
      { id: 'deepseek-reasoner', label: 'deepseek-reasoner（R1）', description: '深度推理，¥4/M in, ¥16/M out。' },
    ],
  },
  {
    id: 'moonshot',
    displayName: 'Moonshot AI（Kimi）',
    protocol: 'openai-compatible',
    baseURL: 'https://api.moonshot.cn/v1',
    baseURLEditable: false,
    description: '月之暗面 Kimi。长上下文专精（128K / 200K）。',
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
    recommendedModels: [
      { id: 'moonshot-v1-8k', label: 'moonshot-v1-8k', description: '8K 上下文，便宜。' },
      { id: 'moonshot-v1-32k', label: 'moonshot-v1-32k', description: '32K 上下文，平衡。' },
      { id: 'moonshot-v1-128k', label: 'moonshot-v1-128k', description: '128K 上下文，长文档。' },
    ],
  },
  {
    id: 'zhipu',
    displayName: '智谱 GLM',
    protocol: 'openai-compatible',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    baseURLEditable: false,
    description: '智谱 AI GLM 系列。中文优化好，flash 款几乎免费。',
    apiKeyUrl: 'https://bigmodel.cn/usercenter/apikeys',
    recommendedModels: [
      { id: 'glm-4-plus', label: 'glm-4-plus（旗舰）', description: '约 ¥50/M。' },
      { id: 'glm-4-air', label: 'glm-4-air', description: '平衡。' },
      { id: 'glm-4-flash', label: 'glm-4-flash（几乎免费）', description: '极便宜。' },
    ],
  },
  {
    id: 'doubao',
    displayName: '豆包（字节）',
    protocol: 'openai-compatible',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    baseURLEditable: false,
    description: '字节跳动豆包。模型 ID 需要在 volcano ark 控制台开通"接入点"后填入。',
    apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    recommendedModels: [
      // Doubao uses "endpoint IDs" rather than fixed model names — user typically
      // pastes the endpoint they configured. We list a couple of known patterns.
      { id: 'doubao-pro-32k-241215', label: 'doubao-pro-32k', description: '需要在控制台开通对应接入点。' },
      { id: 'doubao-lite-32k-241215', label: 'doubao-lite-32k', description: '便宜款。' },
    ],
  },
  {
    id: 'qwen',
    displayName: '阿里 通义千问',
    protocol: 'openai-compatible',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    baseURLEditable: false,
    description: '阿里云 DashScope · 通义千问。OpenAI 兼容模式接入。',
    apiKeyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    recommendedModels: [
      { id: 'qwen-max', label: 'qwen-max（旗舰）', description: '通义最强款。' },
      { id: 'qwen-plus', label: 'qwen-plus', description: '平衡款。' },
      { id: 'qwen-turbo', label: 'qwen-turbo', description: '便宜款。' },
    ],
  },
  {
    id: 'custom',
    displayName: 'OpenAI-Compatible（自定义）',
    protocol: 'openai-compatible',
    baseURL: '',
    baseURLEditable: true,
    description: '任何兼容 OpenAI /v1/chat/completions 协议的端点，包括自部署 vLLM / Ollama / Llama.cpp / 兼容代理服务。',
    recommendedModels: [],
  },
];

export function getProviderPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

/**
 * Best-effort: given an existing LLMConfig (which doesn't store its preset ID
 * since presets are version-dependent), find the most-likely preset by matching
 * protocol + baseURL. Used by Settings to display "edit" context (which preset
 * this config was created from).
 */
export function inferPreset(provider: LLMProviderType, baseURL: string | undefined): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => {
    if (p.protocol !== provider) return false;
    if (p.id === 'custom') return false; // never match custom by default
    // Anthropic preset has empty baseURL by design
    if (p.protocol === 'anthropic') return true;
    return (p.baseURL || '').replace(/\/$/, '') === (baseURL || '').replace(/\/$/, '');
  });
}
