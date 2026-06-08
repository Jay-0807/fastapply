# 开源方案扫描清单 — 字段识别 LLM 语义提取混合管线

> AutoDev 阶段 2a.5 产出 · 2026-06-08 · 红线 #5（优先复用开源）
> 输入：`docs/plans/2026-06-08-llm-semantic-field-extraction-ideation.md`（P1-P7 / W1-W4）
> 方法说明：本扫描以 **WebSearch（2026 近期结果）+ GitHub WebFetch（实时 stars/license/release）** 为主管道。`last30days` 技能定位社交舆情扫描，对「可注入 MV3 content-script 的开发库评估」适配度低，故按 step 2a.5「fallback 到 WebSearch」执行，并对每个候选取**实时 GitHub 数据**（star/license/release 日期均为 2026-06 查证）。

---

## 0. MECE 能力清单（维度：系统能力）—— 本扫描的索引

> 完整 MECE 分解 + 交叉验证见 `*-design.md §1`；此处仅列 R 编号供逐能力扫描。

| 编号 | 能力 | 对应 ideation |
|---|---|---|
| **R1** | DOM 打标引擎（`data-af-id`） | P1 |
| **R2** | 控件清单蒸馏（精简清单，非原始 HTML） | P2 |
| **R3** | LLM 语义提取（一次调用，结构化输出） | P3 |
| **R4** | afId 回填 + 硬约束校验（产出 `DetectedField[]`） | P4 |
| **R5** | 混合编排（启发式快路径 + LLM 补漏 + 合并去重 + 离线兜底） | W1 |
| **R6** | 扫描模式开关 / feature flag（heuristic\|hybrid\|llm） | P6 / W2 |
| **R7** | 扫描结果缓存（URL + DOM 签名） | P5 |
| **R8** | dogfood 语料 + recall 回归基准 | P7 |
| **R9** | 字段来源透明化 UI（provenance `llm-semantic` + 诚实边界标注） | W3 |

---

## 淘汰规则（硬性，先声明）

按 step 2a.5：① License 不兼容（**AGPL/GPL** 对自托管+未来可能上架的扩展有传染风险）② 最近 commit > 12 个月（abandonware）③ Stars < 100 且非新项目 ④ 适配度 ≤ 2。

**贯穿全表的结构性事实**：本产品是 **Chrome MV3 扩展的 content-script / service-worker**，新代码必须能**注入实时页面**或在 SW 内运行。**所有 LLM 浏览器自动化框架（browser-use / Stagehand / Skyvern）都是 Node/Python + Playwright/CDP 的「外部驱动浏览器」架构，无法作为依赖塞进 content-script**——它们是**参考架构（验证方法论），不是可复用依赖**。这条对 R1/R2/R3/R4 一致适用。

---

## R1: DOM 打标引擎（`data-af-id`）

关键词：`set-of-mark prompting`、`interactive element detection`、`DOM element labeling for LLM`

### 候选方案

| 名称 | Stars | 最近 release | License | 热度 | 适配度 | 集成成本 | 链接 |
|------|-------|------------|---------|------|--------|----------|------|
| browser-use（interactive element detection） | 97.6k | v0.12.9 · 2026-05-26 | MIT | 🔥 | 2/5 | high | [github](https://github.com/browser-use/browser-use) |
| Stagehand（a11y-tree + element map） | 23k | 0.8.3 · 2026-06-05 | MIT | 🔥 | 2/5 | high | [github](https://github.com/browserbase/stagehand) |
| GPT-4V-Act（JS 标注 interactable + 数字标签） | ~1k | 较旧 | MIT | — | 3/5 | medium | [github](https://github.com/ddupont808/GPT-4V-Act) |
| Set-of-Mark（技术/论文，非库） | — | — | 技术 | 🔥 | 5/5（思路） | low（自实现） | [arxiv 2310.11441](https://arxiv.org/abs/2310.11441) |

### 推荐

**自研，借用 Set-of-Mark 技术思路。** browser-use/Stagehand 验证了「DOM-first + 给每个可交互元素挂唯一 id」是行业标准（且 DOM-first 比纯视觉可靠 12-17pp），但它们的打标逻辑深嵌在 Node/Python+Playwright 运行时里，**无法注入 MV3 content-script**（适配度 2/5）。GPT-4V-Act 是纯 JS、思路最贴近（遍历 DOM→标数字 id），可作**实现参考**，但它面向 vision-overlay（画 bounding box）、且已不活跃。**唯一适配 5/5 的是 Set-of-Mark *技术本身***（给每个可交互元素挂稳定唯一 id），实现是 ~50 行 DOM 遍历，无需依赖。

### 自研保留理由

- **运行环境硬约束**：候选全部需 Node/Playwright 外部运行时；本产品打标必须发生在**被扫描页面的 content-script 上下文**，无第三方库满足。
- **已有基建**：现有 `field-scanner.ts:158 scanFields(root)` 已在遍历 DOM、判定可见性、生成 selector（`buildSelector` :1462），打标只是在同一遍历里多挂一个 `el.setAttribute('data-af-id', id)`——**复用现有扫描骨架**比引入任何库都省。

---

## R2: 控件清单蒸馏

关键词：`DOM downsampling for LLM`、`accessibility tree serialization`、`compact DOM representation`

### 候选方案

| 名称 | Stars | 最近 release | License | 热度 | 适配度 | 集成成本 | 链接 |
|------|-------|------------|---------|------|--------|----------|------|
| browser-use（DOM tree → structured text） | 97.6k | 2026-05-26 | MIT | 🔥 | 2/5 | high | [github](https://github.com/browser-use/browser-use) |
| "Beyond Pixels: DOM Downsampling for LLM Web Agents"（方法） | — | 2025-08 | 技术 | 🔥 | 4/5（思路） | low | [arxiv 2508.04412](https://arxiv.org/html/2508.04412v1) |
| dom-to-semantic-markdown | ~500 | 活跃 | MIT | — | 3/5 | medium | [github](https://github.com/romansky/dom-to-semantic-markdown) |

### 推荐

**自研蒸馏函数，借用 DOM-downsampling 思路。** 蒸馏的本质是「把每个 `data-af-id` 控件转成 `{afId, tag, type, placeholder, nearbyVisibleText, visibility, domConstraints}` 的精简记录」——这是**项目特定的数据形状**（要和下游 `DetectedField` 对齐、要带 DOM 硬约束）。`dom-to-semantic-markdown` 把整页转 markdown，粒度不对（我们只要可交互控件 + 元信息，不要正文）。DOM-downsampling 论文的「只保留对决策有用的节点」原则直接采纳。

### 自研保留理由

- 蒸馏输出 schema 必须与 R3 prompt / R4 回填**强耦合**（afId 必须可回写），任何通用库的输出都要二次改造，集成成本 ≥ 自研。
- **隐私护栏**（失败模式 F7）：蒸馏只发「可见控件元信息」而非完整 HTML——这是产品决策，需自己控制粒度，与 `detectEventFromPage`（background.ts:296，已只发正文前 8000 字）姿态一致。

---

## R3: LLM 语义提取（结构化输出）

关键词：`LLM structured output TypeScript`、`Anthropic tool use`、`OpenAI structured outputs`、`zod schema LLM`

### 候选方案

| 名称 | Stars | 最近 release | License | 热度 | 适配度 | 集成成本 | 链接 |
|------|-------|------------|---------|------|--------|----------|------|
| **现有 `callLLM` + `parseBatchResponse`/`structuredExtract`**（项目自有） | — | 在用 | 自有 | — | 5/5 | none | `client.ts:337` / `prompts.ts:405` |
| Anthropic tool-use / OpenAI structured outputs（**SDK 原生**，已装） | — | 0.30.1 / 4.73.0 | 自有 SDK | 🔥 | 5/5 | low | 官方文档 |
| Vercel AI SDK（`ai` + `@ai-sdk/anthropic`/`openai`） | 16k+ | 活跃 | Apache-2.0 | 🔥 | 3/5 | medium | [github](https://github.com/vercel/ai) |
| zod-gpt | 627 | 活跃（72 commits） | MIT | — | 3/5 | medium | [github](https://github.com/dzhng/zod-gpt) |
| instructor-js | ~700 | 活跃 | MIT | — | 3/5 | medium | [github](https://github.com/instructor-ai/instructor-js) |

### 推荐

**复用项目自有 `callLLM` + 容错解析（适配度 5/5、集成成本 0）；结构化可选用 SDK 原生 tool-use 加固。** 2026 结构化输出基准：OpenAI Structured Outputs 99.9%、**Anthropic tool-use 99.8%** 合规率——但项目**已经**装了 `@anthropic-ai/sdk` + `openai` + `zod`，且 `prompts.ts` 的 `parseBatchResponse`（6 层容错：去 ```json``` 包裹→去尾逗号→escape 控制符→`structuredExtract` 按键切分→正则兜底）是**专门为 LLM 脏输出打磨过的资产**（V2.3/V2.6 踩坑沉淀）。引入 Vercel AI SDK / zod-gpt / instructor 会**与现有双 SDK 路由重复**，且 Vercel AI SDK 的 provider 抽象会和现有 `provider: 'anthropic' | 'openai-compatible'` 分流打架。

### 自研保留理由（实为「复用自有 + SDK 原生」，非新自研）

- `detectEventFromPage`（background.ts:296）**已经在做同一件事**（页面正文→LLM→JSON 解析），字段提取是其延伸，复用其 prompt+parse 模式零摩擦。
- 引入第三方结构化库 = 多一层 provider 抽象 + 多一个依赖，**违背「零新增运行时依赖」**决策；SDK 原生 tool-use 已能给 99.8% 合规，无需中间层。

---

## R4: afId 回填 + 硬约束校验

关键词：`LLM action grounding`、`element index mapping`、`DOM constraint extraction`

### 候选方案

| 名称 | Stars | License | 适配度 | 说明 |
|------|-------|---------|--------|------|
| browser-use（by-index action grounding） | 97.6k | MIT | 2/5 | 思路：LLM 返回 index → 框架按 index 找元素点击。本质同 afId 回填，但绑死其运行时 |
| （无通用库） | — | — | — | 「LLM 返回 id → 校验 id 存在 → 抽 DOM 硬约束覆盖 LLM 值」是产品特定逻辑 |

### 推荐

**自研。** 回填校验的三件事——① `document.querySelector('[data-af-id="..."]')` 精确对回（解决纯视觉对不上，失败模式 F4）② 校验 afId 真存在、不存在即剔除（防幻觉 F1）③ `maxLength/options/accept` **信 DOM 不信 LLM**（F5）——全是与本项目 `DetectedField`/`FieldConstraints` 形状强绑定的逻辑，无通用库。browser-use 的 by-index grounding 印证了「LLM 给符号、宿主按符号定位」是正确模式，但实现绑死其运行时。

### 自研保留理由

产出物是项目专有的 `DetectedField[]`（`db/types.ts:57`）+ `provenance`（`source: 'llm-semantic'` 新增枚举），与下游 draft 生成 / 一键填入 / FieldExplainer 全部对接——任何外部库都对不上这个 schema。

---

## R5: 混合编排（启发式 + LLM 合并去重 + 离线兜底）

### 候选方案

| 名称 | 适配度 | 说明 |
|------|--------|------|
| （无通用库） | — | 「先跑启发式 → LLM 补差异 → 按 afId/selector 合并去重 → LLM 失败退回纯启发式」是产品级控制流 |

### 推荐

**自研编排层。** 这是把 R1-R4 串起来、并保留现有 `scanFields` 启发式做**快路径 + 交叉校验 + 离线兜底**（失败模式 F2/F8/F11）的控制流——本质是产品的「扫描策略」，无开源市场。

### 自研保留理由

属于产品核心业务逻辑（扫描编排），不是通用技术问题；复用现有 `scanFieldsOnTab`（background.ts:483）作为注入入口。

---

## R6: 扫描模式开关 / feature flag

关键词：`feature flag TypeScript`、`feature toggle`

### 候选方案

| 名称 | Stars | License | 适配度 | 集成成本 | 说明 |
|------|-------|---------|--------|----------|------|
| Unleash（client SDK） | 12k+ | Apache-2.0 | 1/5 | high | 需服务端 flag 服务，本地优先扩展不适用 |
| Flagsmith | 5k+ | BSD | 1/5 | high | 同上，需后端 |
| **本地配置字段**（`AppSettings.scanMode`，自研） | — | 自有 | 5/5 | none | 三态枚举存 IndexedDB，零依赖 |

### 推荐

**自研：`AppSettings` 加一个 `scanMode: 'heuristic' | 'hybrid' | 'llm'` 字段**（默认 `heuristic`，与 landing-path 第 1 步一致）。Unleash/Flagsmith 都是「远程 flag 服务」，与本产品**零外发、本地优先**的架构根本冲突（适配度 1/5，淘汰）。

### 自研保留理由

远程 flag 服务违背 PRD §8.3「数据本地化、零外发」；本地 setting 字段是唯一合架构的方案，且复用现有 Dexie schema migration 机制（CLAUDE.md：改 schema 走 §6 + migration + tests 三件套）。

---

## R7: 扫描结果缓存（URL + DOM 签名）

关键词：`lru cache javascript`、`url keyed cache`

### 候选方案

| 名称 | Stars | 最近 release | License | 适配度 | 集成成本 | 链接 |
|------|-------|------------|---------|--------|----------|------|
| lru-cache（isaacs） | 5.4k | 活跃 | ISC | 4/5 | low | [github](https://github.com/isaacs/node-lru-cache) |
| quick-lru | 1k+ | 活跃 | MIT | 4/5 | low | [github](https://github.com/sindresorhus/quick-lru) |
| **内存 Map + 现有 Dexie**（自研） | — | — | 自有 | 5/5 | none | — |

### 推荐

**自研轻量缓存（内存 `Map<signature, DetectedField[]>`，会话级）。** 缓存键 = `URL + DOM 结构签名`，值 = 提取结果；扫描本不频繁（一次报名扫几次），SW 生命周期内的内存 Map 足够，**不值得引依赖**。如需跨 SW 重启持久化，复用现有 `chrome.storage.session`（已用于 tabSession）。lru-cache 适配度高但对「会话内几十次扫描」属杀鸡用牛刀。

### 自研保留理由

数据量极小（单页扫描结果），生命周期短（会话级），引入 lru-cache 的淘汰策略无收益；复用现有 `chrome.storage.session` 基建（session-state.ts）。

---

## R8: dogfood 语料 + recall 回归基准

关键词：`vitest html fixtures`、`dom test fixtures`、`recall regression test`

### 候选方案

| 名称 | Stars | License | 适配度 | 集成成本 | 说明 |
|------|-------|---------|--------|----------|------|
| **Vitest + happy-dom**（项目已装 ^2.1.5 / ^15.11.7） | — | MIT | 5/5 | none | 现有 `field-scanner.test.ts` 已用 `document.body.innerHTML = html` |
| Playwright（项目已装，test:e2e） | — | Apache-2.0 | 3/5 | medium | 真浏览器但慢，recall 回归用不上 |
| jsdom | 22k | MIT | 4/5 | low | 与 happy-dom 重复，无理由换 |

### 推荐

**复用现有 Vitest + happy-dom 测试栈；语料 = 离线 HTML fixture 自建。** 现状**无离线 fixture 语料库**（架构勘探确认），需把已 dogfood 的 4 张表单（科大硅谷 / HiCool / Epic Connector / 上海创业营）存成 `.html` fixture + 标注「真实字段数」，写 recall 断言（检出/真实 ≥ 阈值）。测试基建零新增依赖。

### 自研保留理由

语料是项目专有资产（自己 dogfood 的真实表单），无现成开源语料；测试栈已齐备。

---

## R9: 字段来源透明化 UI（provenance + 诚实边界）

### 候选方案

| 名称 | 适配度 | 说明 |
|------|--------|------|
| **现有 `FieldExplainer.tsx` + lucide-react**（项目已有） | 5/5 | V2 已建的 provenance 展示组件，扩展 `source: 'llm-semantic'` 分支即可 |

### 推荐

**复用现有 `FieldExplainer` 组件 + lucide-react 图标**（耐久铁律 #2：图标一律 lucide，禁 emoji）。新增 `provenance.source = 'llm-semantic' | 'heuristic+llm'` 分支 + 「本页静态字段，动态字段需翻页」诚实标注（失败模式 F9）。

### 自研保留理由

provenance UI 是 V2 已交付资产的延伸，无需任何外部库。

---

## 交叉验证

| 检查项 | 结果 |
|--------|------|
| 每个 R 能力是否至少扫描了 3 个候选？ | R1/R2/R3/R6/R7/R8 ≥3；R4/R5/R9 为**产品特定逻辑（极小众，无开源市场）**，已列最接近的参考 + 说明，符合 step「除非该能力极小众」豁免 |
| 每个 R 能力是否有「推荐」结论？ | ✅ 全部有 |
| 自研的 R 能力是否填写了差距说明？ | ✅ 全部有「自研保留理由」 |
| 淘汰规则是否执行？ | ✅ Skyvern（AGPL-3.0）+ Unleash/Flagsmith（需后端，违本地优先）已淘汰 |

## 一页结论（喂给 brainstorming 的默认立场）

| R | 决策 | 一句话依据 |
|---|------|-----------|
| R1 打标 | **自研**（借 Set-of-Mark 思路） | 候选全需 Playwright 外部运行时，无法注入 MV3 content-script；复用现有 `scanFields` 遍历骨架 |
| R2 蒸馏 | **自研**（借 DOM-downsampling 思路） | 输出 schema 与下游强耦合 + 隐私粒度需自控 |
| R3 LLM 提取 | **复用自有 `callLLM`+容错解析 / SDK 原生 tool-use** | `detectEventFromPage` 已是同款模式；零新增依赖 |
| R4 回填校验 | **自研** | 绑定项目 `DetectedField`/`FieldConstraints` schema，无通用库 |
| R5 混合编排 | **自研** | 产品级扫描策略控制流 |
| R6 模式开关 | **自研**（`AppSettings.scanMode`） | 远程 flag 服务违「零外发」；本地 setting 唯一合架构 |
| R7 缓存 | **自研**（内存 Map / `storage.session`） | 数据小、生命周期短，依赖无收益 |
| R8 语料+recall | **复用 Vitest+happy-dom**，语料自建 | 测试栈齐备；无现成开源语料 |
| R9 来源 UI | **复用 `FieldExplainer`+lucide** | V2 资产延伸 |

> **总基调**：本旗舰功能**零新增运行时 npm 依赖**——核心管线（R1/R2/R4/R5）是 MV3 content-script 专有逻辑（开源框架架构不兼容），R3 复用现有 SDK+容错解析，R6/R7/R9 复用现有基建。开源价值在于**验证方法论**（DOM-first + Set-of-Mark + DOM-downsampling 是 2026 行业共识）与**反向确认**（重量级框架因运行时/License 不可复用），而非提供可直接 import 的依赖。
