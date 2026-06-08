# 字段识别 LLM 语义提取 — API / 契约设计

> 基于：`*-design.md`（数据模型/架构） + `*-ui.md`（数据需求汇总）
> 本产品无 HTTP 后端：**「API」= Chrome 扩展消息总线契约**（`chrome.runtime.sendMessage` + `{ok,data,error}` 信封）+ SW 内部函数契约 + LLM 提取契约 + Dexie 迁移契约。
> 设计原则：**零新增运行时依赖**；复用现有 `Message` union / `callLLM` / `parseBatchResponse`；下游 `DetectedField[]` 消费方零改动。

---

## 1. 数据模型（TypeScript 契约）

> 放置位置见 `*-design.md §4` 映射表。`exactOptionalPropertyTypes`：可选字段省略 key，不赋 `undefined`。

### 1.1 新类型（`src/lib/fields/semantic/types.ts`）

```ts
export type ScanMode = 'heuristic' | 'hybrid' | 'llm';

/** R2 蒸馏产出：每个已打标控件的精简记录（仅可见元素；不含原始 HTML） */
export interface ControlManifestEntry {
  afId: string;                 // 'af-0' 'af-1' ...（R1 打标，DOM 唯一）
  tag: string;                  // 'input' | 'select' | 'textarea' | 'button' | 'div' ...
  inputType?: string;           // <input> 的 type：'text'|'radio'|'checkbox'|'file' ...
  role?: string;                // aria role（若有）
  placeholder?: string;
  nearbyText: string;           // 附近可见标签文字，截断 ≤ 120 字
  groupHint?: string;           // 最近 row/fieldset 容器签名（给 LLM 分组提示）
  domConstraints: {             // DOM 真值 —— R4 硬约束权威来源（BR3）
    maxLength?: number;
    required?: boolean;
    options?: string[];         // select / radio / checkbox 组
    accept?: string;            // file
    pattern?: string;
  };
}

/** R3 LLM 提取产出：人类视角的一个字段（可由多个控件合一） */
export interface LlmExtractedField {
  afIds: string[];              // 1+ 个控件 afId（多控件合一，如 手机=区号+号码）
  label: string;
  type: FieldType;              // LLM 猜测；DOM 已知类型由 R4 覆盖（BR3）
  sensitive?: 'otp' | 'personal' | null;
}

/** R5 编排产出：扫描结果 + 元数据（recall 对比 O1 + 兜底标记） */
export interface ScanResult {
  fields: DetectedField[];      // 与启发式同形，下游零改动
  meta: ScanResultMeta;
}

export interface ScanResultMeta {
  mode: ScanMode;               // 实际执行的模式（降级后可能 ≠ 请求模式）
  heuristicCount: number;       // 启发式检出数
  llmCount?: number;            // LLM 检出数（hybrid/llm）
  mergedCount: number;          // 合并去重后最终数
  llmFallback?: boolean;        // true = LLM 失败已退回启发式（F8/BR7）
  llmError?: string;            // 降级原因（给 UI 提示 + 重试）
  cacheHit?: boolean;           // true = 命中缓存，未调 LLM（BR6）
  fromCacheSignature?: string;
}
```

### 1.2 现有类型扩展（`src/lib/db/types.ts`）

```ts
// DetectedFieldProvenance.source：
//   现：'html-input' | 'aria-group' | 'shadow-dom' | 'drop-zone'
//   新： | 'llm-semantic' | 'heuristic+llm'
// DetectedFieldProvenance.labelSource：
//   现 7 值，新增： | 'llm-semantic'
// （FieldConstraints 无需改：noAiFill/sensitiveKind/maxLength/options 已存在，R4 复用）
```

### 1.3 AppSettings 扩展（`src/lib/db/types.ts` + `schema.ts`）

```ts
interface AppSettings {
  /* ...现有字段... */
  scanMode?: ScanMode;          // 缺省读作 'heuristic'（BR1）；migration v5→v6 注入
}
```

---

## 2. API 端点（消息总线契约）

> 「端点」= `Message` union 的成员（`src/lib/messages/types.ts`）。所有响应走现有信封 `{ ok: boolean; data?: T; error?: string }`（background.ts onMessage）。

### 2.1 `fields.scan`（扩展现有端点）

| 项 | 内容 |
|---|---|
| 方向 | sidepanel → background |
| 请求（改） | `{ type: 'fields.scan'; payload: { tabId: number; mode?: ScanMode } }` |
| 响应（改） | `ScanResult`（原 `DetectedField[]` → `{ fields, meta }`） |
| 语义 | `mode` 省略时读 `AppSettings.scanMode`（缺省 heuristic）；按 mode 走启发式 / 混合 / 纯 LLM |
| 兼容 | 2 个调用点（`scanCurrentTab`、`enterDraftWithFields`，sidepanel App.tsx:144/152）改为解构 `result.fields`；heuristic 模式 `meta.mode='heuristic'` 保持零行为变化 |

**请求示例**
```ts
sendMessage({ type: 'fields.scan', payload: { tabId, mode: 'hybrid' } })
// → ScanResult
```

**响应示例（hybrid 成功）**
```jsonc
{ "ok": true, "data": {
  "fields": [ /* DetectedField[]，部分 provenance.source = 'llm-semantic' / 'heuristic+llm' */ ],
  "meta": { "mode": "hybrid", "heuristicCount": 12, "llmCount": 14, "mergedCount": 15, "cacheHit": false }
}}
```

**响应示例（hybrid LLM 失败兜底，BR7）**
```jsonc
{ "ok": true, "data": {
  "fields": [ /* 纯启发式 DetectedField[] */ ],
  "meta": { "mode": "heuristic", "heuristicCount": 12, "mergedCount": 12,
            "llmFallback": true, "llmError": "LLM 超时（120s）" }
}}
```
> 注意：LLM 失败**不返回 `ok:false`**——退回启发式属正常降级，`meta.llmFallback` 让 UI 提示 + 重试（流程 2）。

### 2.2 `settings.setScanMode`（新端点，或复用现有 settings 更新）

| 项 | 内容 |
|---|---|
| 方向 | options/sidepanel → background |
| 请求 | `{ type: 'settings.setScanMode'; payload: { mode: ScanMode } }` |
| 响应 | `{ ok: true }` |
| 语义 | 写 `AppSettings.scanMode`（Dexie）；幂等 |
| 复用替代 | 若已有通用 `settings.update` 端点，则并入其 payload，不新增 message type |

### 2.3 SW 内部函数契约（非 message，但定义跨上下文边界）

```ts
// in-page（content-script，executeScript 注入）
function tagInteractiveControls(root: Document | ShadowRoot): void;           // R1，幂等
function distillManifest(root: Document | ShadowRoot): ControlManifestEntry[];// R2

// service-worker
async function extractFieldsViaLLM(                                           // R3
  manifest: ControlManifestEntry[],
  llmConfig: { provider: 'anthropic'|'openai-compatible'; apiKey: string; baseURL: string; model: string },
): Promise<LlmExtractedField[]>;                                              // 失败抛错 → R5 兜底

function backfillAndValidate(                                                 // R4
  llmFields: LlmExtractedField[],
  manifest: ControlManifestEntry[],
): DetectedField[];                                                          // 纯函数，无副作用

async function scanHybrid(tabId: number, mode: ScanMode): Promise<ScanResult>;// R5 编排
```

**注入返回契约**（`scanFieldsOnTab` 改造，background.ts:483）：hybrid/llm 模式的 `executeScript` 在同一次注入里跑 `tagInteractiveControls` + `distillManifest`（+ heuristic 模式额外 `scanFields`），返回 `{ manifest: ControlManifestEntry[]; heuristicFields: DetectedField[] }`。

---

## 3. LLM 提取契约（R3）

### 3.1 输入（喂给 `callLLM` 的 userPrompt 结构）

```
[系统指令] 你是表单字段识别器。给定页面可交互控件清单，返回「人类会填的字段」。
[规则]
  - 每个字段给 afIds（数组，多控件合一，如手机=区号+号码）、label、type、sensitive
  - 排除：提交/取消/导航等动作控件、隐藏/装饰元素、后端状态控件
  - sensitive: 'otp'(验证码/captcha) | 'personal'(姓名/手机/邮箱/微信/身份证) | null
  - 只用清单里出现的 afId，不要编造
  - type 取值：text|textarea|select|checkbox|radio|number|email|url|tel|date|file|unknown
[输出] 严格 JSON：{ "fields": [ { "afIds": ["af-3"], "label": "...", "type": "...", "sensitive": null } ] }
[控件清单]
  af-0 | input/text | placeholder="" | 附近="申请人姓名" | required | 限20字
  af-3 | div/role=radio×3 | 附近="是否成立公司" | 选项=[是,否]
  ...（ControlManifestEntry 精简渲染，仅可见，BR9）
```

### 3.2 输出解析契约

- 复用 `parseBatchResponse`/`structuredExtract`（prompts.ts:405/364）容错解析（去 ```json``` 包裹 / 去尾逗号 / escape 控制符 / 按键切分 / 正则兜底）。
- 解析全失败 → 抛错 → R5 兜底（BR7）。
- 输出映射为 `LlmExtractedField[]` 交给 R4。

### 3.3 调用参数

- 复用 `callLLM({ provider, apiKey, baseURL, model, systemPrompt, userPrompt, maxTokensOverride })`（client.ts:337）。
- `maxTokensOverride`：按清单规模给足（如 2048），避免字段被截断。
- 429 自动 backoff（callLLM 内置 60s 重试 1 次）；超 backoff 仍失败 → 抛错。

---

## 4. 业务规则（不可违反）

| # | 规则 | 落点 |
|---|---|---|
| BR1 | `scanMode` 缺省 = `heuristic`（新装/老用户/未设置均如此）—— landing-path 第 1 步「发布即旧行为」 | R6 / migration |
| BR2 | `hybrid`/`llm` 需 ≥1 可用 LLMConfig；无则降级 `heuristic` + UI 禁用提示 | R5 / UI 面 1·2 |
| BR3 | **硬约束（maxLength/options/required/accept/pattern）一律取 DOM**，LLM 给的忽略 | R4 backfill |
| BR4 | LLM 返回的 afId 必须在 manifest 存在，否则该字段整条剔除（防幻觉 F1） | R4 backfill |
| BR5 | 敏感字段（sensitive≠null）→ `constraints.noAiFill=true` + `sensitiveKind`（对齐 V2.8 G5，AI 不代写） | R4 backfill |
| BR6 | 缓存键 = `url + domSignature`（控件数 + 标签文本 hash）；命中不调 LLM | R7 cache |
| BR7 | LLM 任一步失败（429 超限/超时/解析失败）→ `hybrid` 退回启发式结果（`ok:true` + `llmFallback`）；`llm` 模式才 `ok:false` | R5 orchestrate |
| BR8 | 合并去重：启发式 + LLM 字段按 afId/selector 重叠合并；重叠 → `source='heuristic+llm'`，仅 LLM → `'llm-semantic'`，仅启发式 → 原 source | R5 orchestrate |
| BR9 | 蒸馏只发**可见控件元信息**，绝不发原始 HTML（隐私 F7，姿态同 detectEventFromPage 已发正文） | R2 distill |
| BR10 | `data-af-id` 打标幂等：已挂则跳过，可重入不重复编号 | R1 tagger |
| BR11 | `domSelector` 一律用 `[data-af-id="..."]`（自挂最稳，顺带提升 fillField 可靠性） | R4 backfill |
| BR12 | 蒸馏**不发已填 value**（input/textarea 用户已输入内容），只发元信息（隐私 F7，Plan GAN 补强） | R2 distill |
| BR13 | fill 前复校 afId 命中元素 tag/标签与扫描一致，不一致跳过标 failed（防 React 重排 afId 漂移写错框） | T9b / fill 路径 |

---

## 5. 错误处理契约

| 场景 | 端点行为 | UI 响应（ui.md） |
|---|---|---|
| LLM 429 超 backoff / 超时（hybrid） | `ok:true` + `meta.llmFallback=true` + `llmError` | recall 条降级「LLM 补漏未完成」+ warning toast + 重试 |
| LLM 失败（llm 纯模式） | `ok:false` + error | ErrorToast error + 回退建议切 hybrid/heuristic |
| 解析全失败 | 同 LLM 失败路径 | 同上 |
| 无 LLMConfig 选了 hybrid/llm | 降级 heuristic（`meta.mode='heuristic'`） | 模式选项禁用 + 提示「需先添加模型」 |
| executeScript 注入失败（页面 CSP/特权页） | `ok:false` + error（现有行为） | 现有错误提示「请打开公开链接」 |
| 缓存命中 | `ok:true` + `meta.cacheHit=true` | 加载态一闪而过，不显示 LLM 进度段 |
| 写 scanMode 失败 | `ok:false` + error | ErrorToast error，选中态回滚 |

---

## 6. 数据迁移契约（Dexie v5 → v6）

| 项 | 内容 |
|---|---|
| 触发 | `db.version(6).stores({...}).upgrade(tx => ...)` |
| 变更 | `appSettings` 单例：若 `scanMode` 缺失 → 注入 `'heuristic'`（BR1） |
| 表结构 | **无新增表 / 无索引变更**（scanMode 是 singleton 上的标量字段，Dexie 不需声明非索引字段） |
| 幂等 | 重复迁移安全：已有 scanMode 不覆盖 |
| 无损 | 不动 projects/documents/chunks/eventContexts/qaRecords/projectAssets |
| 三件套 | 改 schema → §6 数据模型 + migration + schema.test.ts 同步（CLAUDE.md 约定） |
| 缓存 | R7 缓存为内存/`storage.session` 瞬态，**不入 IndexedDB**，无 migration |

---

## 7. 端到端时序（hybrid 成功）

```
sidepanel  ──sendMessage{fields.scan, {tabId, mode:'hybrid'}}──▶ background.handle
background ── requireScanMode（payload.mode ?? AppSettings.scanMode）
           ── requireLLMConfig（无则降级 heuristic，BR2）
           ── executeScript(tabId): tagInteractiveControls + distillManifest + scanFields
           ◀── { manifest, heuristicFields }
           ── cache.get(url+sig) ── 命中 ─▶ return ScanResult{cacheHit:true}
           ── extractFieldsViaLLM(manifest, cfg) ──callLLM──▶ LlmExtractedField[]
                 └─ 抛错 ─▶ return ScanResult{ fields:heuristicFields, meta:{llmFallback:true} } (BR7)
           ── backfillAndValidate(llmFields, manifest) ─▶ DetectedField[]（BR3/4/5/11）
           ── merge(heuristicFields, llmFields) ─▶ 去重 + consensus（BR8）
           ── cache.set(sig, merged)
           ──▶ { ok:true, data: ScanResult{ fields, meta } }
sidepanel  ── enterDraftWithFields(result.fields) + 渲染 meta（recall 条 O1 + 来源徽章）
           ── 下游 draft 生成 / 一键填入 / 沉淀 —— 不变
```

---

## 8. 自检

- [x] 含「API 端点」章节（§2 消息总线契约）
- [x] 每个 UI 数据需求（ui.md §数据需求汇总）都有对应契约：scanMode（§1.3/§2.2）、fields.scan+mode（§2.1）、provenance 扩展（§1.2）、recall meta（§1.1 ScanResultMeta）、LLMConfig 可用性（BR2）
- [x] 请求/响应 schema 明确（§2 示例 + §1 类型）
- [x] 业务规则显性化（§4 BR1-BR11）
- [x] 错误处理覆盖异常路径（§5）
- [x] 数据迁移契约 + 三件套（§6）
- [x] 零新增运行时依赖；复用 Message union / callLLM / parseBatchResponse
- [x] 下游 DetectedField[] 消费方零改动（仅 2 个 scan 调用点解构 result.fields）

---

**阶段 4 产出完成。** 下一步：阶段 5 规划（autodev-plan 契约式验收标准 + 降阶扫描）→ 5.5 index+rules → 5.9 Plan GAN。
