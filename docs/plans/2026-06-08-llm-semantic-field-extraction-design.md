# 产品规格 / 设计文档 — 字段识别 LLM 语义提取混合管线

> AutoDev 阶段 2b 产出 · 2026-06-08 · 源需求 `docs/PRD.md §10`
> 输入：`*-ideation.md`（P1-P7/W1-W4、失败模式 F1-F11） + MECE 能力清单（本文 §1） + `*-oss-scan.md`（复用决策）
> 范围决策（PM 2026-06-08）：**§10 完整混合管线**（落地路径 1-2 步 + 为第 3 步「主路径化」铺架构）
> 架构事实来源：实地勘探现有代码（带 `file:line` 引用，已核对）

---

## 1. MECE 能力分解（维度：系统能力）

> 单一维度（系统能力）· 互斥 · 穷尽。交叉验证见 §1.3。

### 1.1 必需能力（R）

| 编号 | 能力 | 一句话 |
|---|---|---|
| **R1** | DOM 打标引擎 | 遍历被扫描页 DOM，给每个候选可交互元素挂稳定 `data-af-id`；幂等可重入 |
| **R2** | 控件清单蒸馏 | 把已打标控件转成精简记录（afId + tag/type/placeholder/附近可见文字/可见性 + **DOM 硬约束**），仅可见元素、不发原始 HTML |
| **R3** | LLM 语义提取 | 一次 LLM 调用，输入控件清单，输出「人会填的字段」（afIds / label / type / 是否敏感 / 多控件合一），排除后端/隐藏/动作控件 |
| **R4** | afId 回填 + 硬约束校验 | LLM 结果按 afId 对回控件清单：校验 afId 真存在（剔幻觉）、硬约束信 DOM 不信 LLM，产出标准 `DetectedField[]` |
| **R5** | 混合编排 | 启发式 `scanFields` 先跑（快路径）→ LLM 补差异 → 按 afId/selector 合并去重 → **LLM 失败退回纯启发式**（离线兜底） |
| **R6** | 扫描模式开关 | `scanMode: heuristic\|hybrid\|llm` 三态；默认 `heuristic`，新路径 flag 后；`llm` 为「主路径化」预留 |
| **R7** | 扫描结果缓存 | 按 `URL + DOM 签名` 缓存提取结果，重复访问不重复调 LLM |
| **R8** | dogfood 语料 + recall 基准 | 把已 dogfood 的真实表单存离线 HTML fixture + 标注真实字段数，量 recall（检出/真实），做回归基准 |
| **R9** | 字段来源透明化 UI | provenance 新增 `llm-semantic` 来源；FieldExplainer 显示「LLM/启发式/两者一致」；诚实标注「本页静态字段」边界 |

### 1.2 可选能力（O，MVP 可后置）

| 编号 | 能力 | 一句话 |
|---|---|---|
| **O1** | recall 对比可视化 | 扫描后 UI 显示 heuristic vs hybrid 检出数对比（让 PM 看见「LLM 多捞了几个」）—— ideation W4 🟡增强 |
| **O2** | 纯 LLM 模式 UI 开关 | 在设置/sidepanel 暴露 `llm` 模式切换 —— 架构由 R6 就绪，UI 暴露为可选打磨 |

### 1.3 MECE 交叉验证

| 检查项 | 通过条件 | 结果 |
|--------|---------|------|
| 核心价值链每个环节都有能力覆盖？ | 全覆盖 | ✅ 打标(R1)→蒸馏(R2)→提取(R3)→回填(R4)→编排(R5)，支撑 R6/R7/R8/R9 |
| ideation 失败模式（F1-F11）都有防护能力？ | 全覆盖 | ✅ 见 §12 失败模式→防护映射表 |
| 能力条目之间有重叠？ | 无重叠 | ✅ R1-R4 是 4 个串行管线段；R5 是编排控制流；R6/R7 是配置/性能横切；R8 测量；R9 表现层 |
| 是否混用维度？ | 单一维度 | ✅ 全部在「系统能力」维度 |

> 边界澄清（防 R4/R9 重叠）：**R4 产出数据**（含正确的 `provenance.source`），**R9 是表现层**（FieldExplainer 渲染 + 诚实文案）。数据层 vs 表现层，互斥。

---

## 2. 方案发散与收敛（brainstorming）

> 本节为架构方案的发散-评估-收敛（`superpowers:brainstorming` 未安装于本环境，按 autodev 红线由本阶段直接综合；候选方案对比 + 收敛理由完整保留）。

### 2.1 三个候选架构

| 方案 | 描述 | 优 | 劣 | 评分 |
|---|---|---|---|---|
| **A. 纯 LLM 替换** | 删掉启发式，所有表单走 LLM 提取 | 代码最简、概念最纯 | F2（LLM 漏检 recall 反降）/ F8（LLM 挂=白屏）/ F11（旧表单回归风险）全暴露；旧的 4 张 dogfood 表单可能变差 | 2/5 |
| **B. 混合 completeness-pass**（启发式快路径 + LLM 补漏，flag 后） | 启发式先跑出结果，LLM 只「对差异/补漏」，合并去重；默认仍启发式 | 低风险（启发式兜底）；与 PRD landing-path 1-2 步**逐字吻合**；旧表单零回归；LLM 收窄为增量活，更省更准 | 编排稍复杂；合并去重要设计 | **5/5** |
| **C. LLM 主路径 + 启发式校验** | LLM 先跑，启发式只做交叉校验 | 直奔「换表单不改代码」终态 | recall 未经基准证明就当主路径 = 赌；landing-path 第 3 步的前提（「LLM 稳超启发式」）尚未量化 | 3/5 |

### 2.2 收敛

**选 B（混合 completeness-pass），并让 R6 模式开关把 C 作为 `llm` 模式预留（架构就绪、默认不开）。**

依据：① PRD §10 落地路径明写「第 1 步：留启发式；加 LLM completeness pass，置于 feature flag 后」「第 3 步：LLM pass recall **稳超**纯启发式 → 才设主路径」——B 是第 1-2 步，C 是第 3 步的**结果**而非起点。② 失败模式 F2/F8/F11 只有 B 全防住。③ R8 recall 基准是「B 何时能升级到 C」的客观闸门——**先量化，再决策**，不盲签。

> 一句话：**B 做现在，R6 给 C 留门，R8 给「B→C」发通行证。**

---

## 3. 复用决策表（红线 #5）

> 详细候选/淘汰见 `*-oss-scan.md`。总基调：**零新增运行时 npm 依赖**。

| R | 决策 | 主依据 | 复用的现有资产 |
|---|------|--------|---------------|
| R1 打标 | 🔨 自研（借 Set-of-Mark 思路） | 开源框架（browser-use/Stagehand/Skyvern）全需 Playwright 外部运行时，**无法注入 MV3 content-script**；Skyvern 还 AGPL | `field-scanner.ts:158 scanFields` 的 DOM 遍历骨架 + `buildSelector:1462` |
| R2 蒸馏 | 🔨 自研（借 DOM-downsampling 思路） | 输出 schema 与 R3/R4 强耦合；隐私粒度需自控 | `detectEventFromPage`（background.ts:296）的「页面→精简文本」姿态 |
| R3 LLM 提取 | ♻️ 复用自有 + SDK 原生 | `detectEventFromPage` 已是同款（页面→LLM→JSON）；引第三方结构化库与现有双 SDK 路由重复 | `callLLM`（client.ts:337）+ `parseBatchResponse`/`structuredExtract`（prompts.ts:405/364） |
| R4 回填校验 | 🔨 自研 | 绑定项目 `DetectedField`/`FieldConstraints` schema，无通用库 | `db/types.ts:57` 的 DetectedField 形状 |
| R5 混合编排 | 🔨 自研 | 产品级扫描策略控制流，无开源市场 | `scanFieldsOnTab`（background.ts:483）注入入口 |
| R6 模式开关 | 🔨 自研（`AppSettings.scanMode`） | 远程 flag 服务（Unleash/Flagsmith）违 PRD §8.3「零外发」 | Dexie schema migration 机制 |
| R7 缓存 | 🔨 自研（内存 Map / `storage.session`） | 数据小、生命周期短，依赖无收益 | `session-state.ts` / `chrome.storage.session` |
| R8 语料+recall | ♻️ 复用 Vitest+happy-dom，语料自建 | 测试栈齐备（^2.1.5/^15.11.7）；无现成开源语料 | `field-scanner.test.ts` 的 `document.body.innerHTML` fixture 模式 |
| R9 来源 UI | ♻️ 复用 `FieldExplainer`+lucide | V2 已交付组件延伸 | `FieldExplainer.tsx` + lucide-react |

---

## 4. 能力-组件映射表

> 每个 R 由**唯一主责组件**实现（防多组件覆盖同能力无主次）。新模块统一收在 `src/lib/fields/semantic/`。

| 能力 | 主责组件（新建/改） | 路径 | 运行上下文 |
|---|---|---|---|
| R1 打标 | `tagger.ts` · `tagInteractiveControls(root)` | `src/lib/fields/semantic/tagger.ts`（新） | content-script（in-page） |
| R2 蒸馏 | `distill.ts` · `distillManifest(root)` | `src/lib/fields/semantic/distill.ts`（新） | content-script（in-page） |
| R3 提取 | `extract.ts` · `extractFieldsViaLLM(manifest, llmConfig)` | `src/lib/fields/semantic/extract.ts`（新） | service-worker |
| R4 回填校验 | `backfill.ts` · `backfillAndValidate(llmFields, manifest)` | `src/lib/fields/semantic/backfill.ts`（新） | service-worker |
| R5 编排 | `orchestrate.ts` · `scanHybrid(tabId, mode, llmConfig)` | `src/lib/fields/semantic/orchestrate.ts`（新） | service-worker |
| R6 模式开关 | `AppSettings.scanMode` + 读取点 | `db/types.ts`（改）+ `db/schema.ts` migration v5→v6 | 全局 |
| R7 缓存 | `scan-cache.ts` · `getCached/setCached(signature)` | `src/lib/fields/semantic/scan-cache.ts`（新） | service-worker |
| R8 语料+recall | recall 回归测试 + fixture 语料 | `src/lib/fields/semantic/__fixtures__/*.html` + `semantic-recall.test.ts`（新） | 测试 |
| R9 来源 UI | `FieldExplainer.tsx`（改）+ sidepanel 标注 | `src/components/FieldExplainer.tsx` / `sidepanel/App.tsx` | UI |
| 共享类型 | `ControlManifestEntry` / `LlmExtractedField` / `ScanMode` | `src/lib/fields/semantic/types.ts`（新） | 全局 |
| 注入入口（改） | `scanFieldsOnTab` 按 mode 分流 | `background.ts:483` | service-worker |
| 消息（改） | `fields.scan` payload 加 `mode?` | `messages/types.ts` | 全局 |

---

## 5. 功能详细规格（展开 P/W 为可验收行为）

### R1 — DOM 打标（`tagger.ts`）
- 遍历 `root`（Document/ShadowRoot，递归 Shadow DOM，复用现有深度上限 5 + 节点预算）。
- 候选元素：`input, select, textarea, [role], [contenteditable], button, a[onclick], [tabindex]` 中**可见**者（复用现有可见性判定，**容忍 opacity:0**——HiCool 教训，记忆 `hicool-two-column-scanner`）。
- 给每个候选 `el.setAttribute('data-af-id', 'af-' + idx)`；**幂等**：已有 `data-af-id` 则跳过（可重入，不重复编号）。
- 验收：注入两次结果一致；styled `<button>` / opacity:0 input 都被打标；纯展示文本不被打标。

### R2 — 蒸馏（`distill.ts`）
- 输入已打标 `root`，输出 `ControlManifestEntry[]`（schema 见 §8.2）。
- 每条含：afId、tag、inputType、role、placeholder、`nearbyText`（**截断 ≤120 字**控体积）、groupHint（最近 row/fieldset 签名，给 LLM 分组提示）、`domConstraints`（maxLength/required/options/accept/pattern——**从 DOM 抽真值**）。
- **只发可见控件元信息，绝不发原始 HTML**（隐私护栏 F7）。
- 验收：清单体积 < 原始 HTML 的 10%；每条 afId 在 DOM 中可 `querySelector` 命中。

### R3 — LLM 提取（`extract.ts`）
- 复用 `callLLM`（client.ts:337）；prompt 模式借 `detectEventFromPage`。
- system prompt 要求：返回「人会填的字段」，每字段给 `afIds`（**支持多控件合一**，如手机=区号+号码两个 afId）、`label`、`type`、`sensitive`（otp/personal/null）；**显式排除**后端/隐藏/动作控件（提交/取消/导航）。
- 输出 JSON，走 `parseBatchResponse`/`structuredExtract` 容错解析（prompts.ts:405）。
- 失败（429 超 backoff / 超时 / 解析全失败）→ 抛错给 R5 兜底。
- 验收：HiCool 第 2 页清单喂入，返回 ~9 个人类字段、排除 12 个 hidden 状态控件。

### R4 — 回填校验（`backfill.ts`）
- 对每个 `LlmExtractedField`：① 每个 afId 必须在 manifest 中存在，否则**整条剔除**（防幻觉 F1）；② `label`/`type`/`sensitive` 取 LLM；③ **`maxLength`/`options`/`required`/`accept`/`pattern` 取 manifest（DOM 真值，覆盖 LLM）**（F5）；④ `type` 调和：DOM 已知控件类型（select/file/radio…）以 DOM 为准，纯视觉控件用 LLM 的 type。
- 产出 `DetectedField`：`domSelector = '[data-af-id="' + primaryAfId + '"]'`（自挂、最稳，**顺带提升填充可靠性**）；`provenance.source = 'llm-semantic'`、`labelSource = 'llm-semantic'`；`constraints.noAiFill/sensitiveKind` 由 sensitive 推导（对齐 V2.8 G5）。
- 验收：LLM 返回不存在 afId → 该字段不出现在结果；maxLength 始终等于 DOM 值。

### R5 — 混合编排（`orchestrate.ts`）
- `mode='heuristic'`：仅 `scanFields`（现状，零行为变化）。
- `mode='hybrid'`（默认新路径）：并行/串行跑 `scanFields`（启发式）+ R1→R4（LLM）；按 afId 与 selector 重叠**合并去重**：两者都检出 → `provenance.source='heuristic+llm'`（consensus）；仅 LLM → `'llm-semantic'`；仅启发式 → 保持原 source。**LLM 任一步失败 → 退回纯启发式结果，绝不白屏**（F8/F11）。
- `mode='llm'`：仅 R1→R4（W2，架构就绪，landing-path 第 3 步预留）。
- 验收：mode=hybrid 下 LLM 强制抛错 → 返回的字段集 == 纯启发式集（兜底证明）。

### R6 — 模式开关（`AppSettings.scanMode`）
- `db/schema.ts` migration v5→v6：`appSettings` 加 `scanMode`，缺省 `'heuristic'`（老用户零感知，landing-path 第 1 步）。
- `scanFieldsOnTab` 读取 `scanMode` 决定走哪条路径。
- 验收：未设置过的库读出 `'heuristic'`；改 schema 三件套（§6 + migration + tests）齐。

### R7 — 缓存（`scan-cache.ts`）
- 键 = `url + domSignature`（domSignature = 控件数 + 标签文本 hash 的轻量签名）；值 = `DetectedField[]`；会话级内存 Map，可选落 `chrome.storage.session`。
- 同页 DOM 未变 → 命中，不调 LLM（F6）；DOM 变（翻页/展开）→ 签名变 → 重算。
- 验收：同 tab 连续扫两次，第二次无 LLM 网络调用。

### R8 — 语料 + recall 基准（`__fixtures__` + `semantic-recall.test.ts`）
- 4 张已 dogfood 表单存 `.html` fixture + `expected.json`（标注真实字段数 + 关键字段 label）。
- 测试：对每个 fixture 跑 heuristic / hybrid，断言 `recall = 检出/真实 ≥ 基准阈值`，且 hybrid ≥ heuristic（不退化）。
- 验收：4 fixture recall 全部记录；hybrid 不低于 heuristic。

### R9 — 来源透明化（`FieldExplainer` + sidepanel）
- FieldExplainer 新增 `source` 文案：`llm-semantic`→「🔵 LLM 语义识别」、`heuristic+llm`→「✅ 启发式+LLM 一致」（图标用 lucide：`Sparkles`/`CheckCircle2`，**禁 emoji** 铁律 #2）。
- sidepanel 扫描结果顶部诚实标注：「本页静态字段；条件展开/分页字段需翻页后重扫」（F9，复用 V2.7「继续下一页」）。
- 验收：LLM 识别的字段卡可在 FieldExplainer 看到来源=LLM；动态字段不谎称已扫到。

---

## 6. 架构设计

### 6.1 管线数据流（跨 content-script / SW 两上下文）

```
sidepanel ──fields.scan{tabId, mode}──▶ background.scanFieldsOnTab(tabId)
                                              │ 读 AppSettings.scanMode（mode 缺省时）
                                              ▼
                              ┌─ mode=heuristic ─▶ executeScript(scanFields) ─▶ DetectedField[]（现状）
                              │
                              ├─ mode=hybrid/llm ▼
                              │   executeScript(in-page):
                              │     R1 tagInteractiveControls(document)  // 挂 data-af-id
                              │     R2 distillManifest(document)          // → ControlManifestEntry[]
                              │     [hybrid 额外] scanFields(document)     // 启发式快路径
                              │   ◀── { manifest, heuristicFields }
                              │   R7 cache.get(url+sig) ── 命中 ─▶ 直接返回
                              │   R3 extractFieldsViaLLM(manifest, llmConfig)  // callLLM
                              │        └─ 失败 ─▶ R5 退回 heuristicFields（hybrid）/ 报错（llm）
                              │   R4 backfillAndValidate(llmFields, manifest) // → DetectedField[]（llm-semantic）
                              │   R5 merge(heuristicFields, llmFields)        // 去重 + consensus 标注
                              │   R7 cache.set(sig, merged)
                              ▼
                        DetectedField[] ──▶ sidepanel（R9 provenance UI）──▶ 下游 draft 生成/填入（不变）
```

### 6.2 关键集成点（实地核对，file:line）

| 集成点 | 现状 | 改动 |
|---|---|---|
| 注入入口 | `scanFieldsOnTab`（background.ts:483）`executeScript({files:['/content-scripts/content.js']})` | 按 `scanMode` 分流；hybrid/llm 注入 tag+distill+scanFields，返回 `{manifest, heuristicFields}` |
| LLM 调用 | `callLLM(args: CallArgs)`（client.ts:337） | R3 直接复用，`systemPrompt`/`userPrompt` 新建 |
| 容错解析 | `parseBatchResponse`/`structuredExtract`（prompts.ts:405/364） | R3 复用解析多字段 JSON |
| 字段类型 | `DetectedField`/`FieldConstraints`/`provenance`（db/types.ts:57） | provenance.source/labelSource union 加 `llm-semantic`、`heuristic+llm` |
| 消息 | `{type:'fields.scan', payload:{tabId}}`（messages/types.ts） | payload 加 `mode?: ScanMode` |
| 填充 | `fillField(selector)`（field-scanner.ts:1522） | **零改动**——`[data-af-id]` selector 本就走标准 querySelector 路径 |
| UI | `FieldExplainer.tsx` / `enterDraftWithFields`（sidepanel App.tsx:152） | 来源文案 + 诚实标注 |

> **下游零改动论证**：R4 产出标准 `DetectedField[]`，与启发式同形 → draft 生成 / 一键填入 / tabSession 持久化 / QARecord 沉淀**全部不动**。这是方案 B 低风险的核心。

---

## 7. 技术选型 + 鲜度验证（红线 #4）

> 核心决策：**本功能零新增运行时 npm 依赖**。下表为「新代码直接依赖的现有栈」鲜度核对（WebSearch 2026-06-08 查证）。

| 依赖 | 选用版本（项目锁定） | 最新稳定版 | 查证日期 | 选型理由 |
|---|---|---|---|---|
| @anthropic-ai/sdk | ^0.30.1 | 0.100.1 | 2026-06-08 | 复用现有 `callLLM`；`messages.create` + tool-use API 在 0.30.1 已稳定且非废弃。**不并入 major 升级**（0.30→0.100 会冲击全扩展现有 LLM 路径，回归风险）→ 列为独立维护任务 |
| openai | ^4.73.0 | 6.42.0 | 2026-06-08 | 同上；`chat.completions.create({stream})` 在 4.73 稳定。major 升级独立处理 |
| zod | ^3.23.8 | 4.4.3（subpath `zod/v4`） | 2026-06-08 | zod3 当前受支持；zod4 仍以 `zod/v4` 子路径与 zod3 并存，无须迁移；新 schema 用 zod3 与项目一致 |
| wxt | ^0.19.13 | 0.19.x（项目锁定） | 2026-06-08 | CLAUDE.md 铁律锁 WXT 0.19；功能内不升框架 |
| dexie | ^4.0.10 | 4.x | 2026-06-08 | schema migration v5→v6 用现有 Dexie，版本当前 |
| vitest / happy-dom / fake-indexeddb | ^2.1.5 / ^15.11.7 / ^6.0.0 | 维持 | 2026-06-08 | 复用现有测试栈（R8） |
| **新增运行时依赖** | **0 个** | — | — | 核心管线为 MV3 content-script 专有逻辑，开源框架运行时不兼容（见 `*-oss-scan.md`） |

> ⚠️ **维护旗标（不在本功能范围）**：`@anthropic-ai/sdk` 0.30→0.100、`openai` 4.73→6.42 的 major 升级是独立技术债，应单开任务评估（影响全扩展 LLM 路径），不混入本旗舰功能以免放大回归面。

---

## 8. 数据模型概要

### 8.1 `DetectedField` provenance 扩展（db/types.ts）

```ts
// DetectedFieldProvenance.source 现：'html-input'|'aria-group'|'shadow-dom'|'drop-zone'
//                              新增： | 'llm-semantic' | 'heuristic+llm'
// labelSource 现 7 值，新增：       | 'llm-semantic'
```
（`exactOptionalPropertyTypes` 铁律 #3：可选字段省略 key，不赋 undefined）

### 8.2 新类型（`semantic/types.ts`）

```ts
export type ScanMode = 'heuristic' | 'hybrid' | 'llm';

export interface ControlManifestEntry {
  afId: string;                 // 'af-0' ...
  tag: string;                  // 'input'|'select'|'textarea'|'button'|'div'...
  inputType?: string;           // <input> 的 type
  role?: string;                // aria role
  placeholder?: string;
  nearbyText: string;           // 附近可见标签文字，≤120 字
  groupHint?: string;           // 最近 row/fieldset 签名（分组提示）
  domConstraints: {             // DOM 真值——R4 的硬约束权威来源
    maxLength?: number;
    required?: boolean;
    options?: string[];         // select/radio/checkbox
    accept?: string;            // file
    pattern?: string;
  };
}

export interface LlmExtractedField {
  afIds: string[];              // 1+ 个控件 afId（多控件合一）
  label: string;
  type: FieldType;              // LLM 猜测；DOM 已知类型由 R4 覆盖
  sensitive?: 'otp' | 'personal' | null;
}
```

### 8.3 `AppSettings.scanMode`（db/schema.ts migration v5→v6）

```ts
interface AppSettings { /* ...现有... */ scanMode?: ScanMode; }  // 缺省读作 'heuristic'
```

### 8.4 缓存

会话级 `Map<string /*url+domSig*/, DetectedField[]>`；可选镜像 `chrome.storage.session`。无 IndexedDB 表（数据瞬态）。

---

## 9. 部署策略

| 项 | 决策 |
|---|---|
| 形态 | Chrome MV3 扩展，load-unpacked（PRD §1 自托管，不上 Web Store） |
| 部署平台 | **无**（`env-capabilities.yaml`：vercel/docker 与本产品无关） |
| 交付物 | `pnpm build`（wxt）产物 `.output/chrome-mv3`；`pnpm compile`（tsc）+ `pnpm lint`（0 warning）+ `pnpm test`（vitest）全绿 |
| 自动部署 | `config.yaml: deployment.auto_deploy=false`——扩展无自动部署 |
| 版本管理 | **非 git 仓库**（铁律 #1）：改动只在磁盘；交付阶段回写 3 处文档（CLAUDE.md / PRD.md / 自动记忆）+ vault 深档案 |
| feature flag | `scanMode` 默认 `heuristic`——发布即默认旧行为，零风险灰度 |

---

## 10. 自研理由汇总

完整候选/淘汰见 `*-oss-scan.md`。一句话：**核心管线（R1/R2/R4/R5）是 MV3 content-script 专有逻辑**，所有 LLM 浏览器框架（browser-use/Stagehand/Skyvern）是 Node/Python+Playwright「外部驱动浏览器」架构，**无法注入 content-script**（Skyvern 还 AGPL 不兼容）；它们的价值是**验证方法论**（DOM-first + Set-of-Mark + DOM-downsampling 是 2026 行业共识），非可复用依赖。R3 复用现有 `callLLM`+容错解析（`detectEventFromPage` 已是同模式）；R6/R7/R8/R9 复用现有基建（Dexie/storage.session/Vitest/FieldExplainer）。

---

## 11. 设计验证自检

| 检查 | 结果 |
|---|---|
| 每个 R 编号在设计中有对应主责组件？ | ✅ §4 映射表，R1-R9 各有唯一主责 |
| 有组件覆盖多能力但无主次说明？ | ✅ 无——`orchestrate.ts` 调度 R1-R4，但各段主责明确（R5 仅编排，不实现段内逻辑） |
| 某能力被多组件覆盖是否说明关系？ | ✅ R4 数据 vs R9 表现（§1.3 边界澄清）；provenance 由 R4 写、R9 渲染 |
| 部署策略是否明确？ | ✅ §9（无部署，交付=build 产物 + 3 处回写） |
| 复用决策表是否每 R 有结论 + 自研有差距说明？ | ✅ §3 + `*-oss-scan.md` |

---

## 12. 失败模式 → 防护映射（ideation F1-F11 全覆盖）

| 失败模式 | 防护能力 | 落点 |
|---|---|---|
| F1 LLM 幻觉 afId | R4 afId 存在性校验 | `backfill.ts` 剔除不存在 afId 的字段 |
| F2 LLM 漏检 recall 反降 | R5 启发式交叉校验 + R8 recall 基准闸门 | `orchestrate.ts` + `semantic-recall.test.ts` |
| F3 后端/隐藏/动作控件当字段 | R2 只发可见 + R3 prompt 排除 + R4 复校可见性 | `distill.ts` + `extract.ts` prompt + `backfill.ts` |
| F4 纯视觉控件对不回 input | R1 `data-af-id` 打标 | `tagger.ts`（方案支点） |
| F5 硬约束猜错 | R4 DOM 真值覆盖 LLM | `backfill.ts` |
| F6 每次调 LLM 成本爆炸 | R7 缓存 + R2 控清单体积 | `scan-cache.ts` + `distill.ts` |
| F7 隐私（清单发 LLM） | R2 只发可见控件元信息（非完整 HTML），姿态同 `detectEventFromPage` | `distill.ts` |
| F8 LLM 不可用/超时/429 | R5 启发式离线兜底 | `orchestrate.ts` |
| F9 时间类字段被当「已全」 | R9 诚实 UI 标注 + 复用 V2.7 翻页；**不在范围声称解决** | `FieldExplainer`/sidepanel |
| F10 AX 树漏 opacity:0 | R1/R2 用原始 DOM，容忍 opacity:0 | `tagger.ts`/`distill.ts` |
| F11 推倒启发式重来 | R5 启发式保留为快路径+校验+兜底 | `orchestrate.ts`（方案 B 收敛） |

---

**阶段 2 产出完成。** 产物：`*-oss-scan.md`（复用决策）+ 本 `*-design.md`（能力-组件映射 + 复用决策表 + 鲜度验证 + 数据模型 + 部署）。
下一步：阶段 3 UI/UX 设计（扫描模式开关 / 来源透明化 / recall 对比的交互与视觉规范，图标库锁 lucide-react）。
