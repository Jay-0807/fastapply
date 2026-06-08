# 实施计划 — 字段识别 LLM 语义提取混合管线

> AutoDev 阶段 5 产出 · 2026-06-08 · 输入：ideation + design + ui + api 四文档
> 执行方式：**subagent-driven**（config.yaml planning.execution_style=subagent）
> 上下文载体：`*-index.md`（地图）+ `*-rules.md`（编码规则）+ 本文件对应 task 章节
> 范围：§10 完整混合管线（落地路径 1-2 步 + R6 给第 3 步留门）

---

## 🔍 plan_review_history（Plan GAN · autodev §5.9）

> GAN 3 处之第 1 处：代码开发前的方案对抗审查。独立 context reviewer，4 维度打分。

### Round 1 — NEEDS_IMPROVEMENT（2026-06-08）
- 打分：需求覆盖度 **9** / 技术合理性 **7** / 任务可执行性 **8** / 风险识别 **7**（全 ≥7、无 FAIL，但因 #1 风险 T9 验收闸太松判 NEEDS_IMPROVEMENT）
- reviewer 实地核对全部准确（scanFields@field-scanner.ts:158、fillField@:1522、callLLM@client.ts:337、schema v5@schema.ts:72、host `<all_urls>`@wxt.config.ts:32、测试基线 exactly 79）。
- 5 findings：① T9 注入错配（`files:` 注入不收 args、tagger/distill 需进 bundle、返回契约未进验收）② `callLLM` 未 export ③ 隐私：可能外发已填 PII ④ afId 漂移 → fill 静默写错框 ⑤ UI 护栏（F9 文案/recall 渲染/外发提示）未进验收。

### Round 2 — PASS（2026-06-08，修正后独立再审）
- 5 findings 全 RESOLVED，依赖图无新断裂：① T9 改方案 B（content.ts 暴露 `__applyforge_tag_distill__` + 第二次 func 注入，对齐 `__applyforge_fill__`）+ 注入返回契约进 T9 最高风险验收 ② T4 加 client.ts + export callLLM ③ T3 加「不发已填 value」+ BR12 ④ 新增 T9b afId 一致性守卫 + BR13 ⑤ T10 加 F9/recall 渲染 + 外发提示验收。
- 残留 cosmetic：rules.md BR 编号非自然序（不影响引用）。

**plan_review_result = PASS → 进入 Phase 6。**

---

## ✅ 实现完成总结（2026-06-08 · Phase 6）

T1-T11 + T9b 全部实现。验收闸全绿：`pnpm compile` 0 error · `pnpm lint` 0 warning · `pnpm test` **131 通过**（基线 79 + 新增 52）· `pnpm build` 2.93 MB（**零新增运行时依赖**，+0.02MB）· content.js bundle 含 `__applyforge_tag_distill__`（Method B 注入验证）。

**Code GAN（2 轮，独立 context reviewer + 一次性探针实测）：**
- **Round 1 = NEEDS_IMPROVEMENT** —— 测出 4 个真 bug：① 缓存污染（transient LLM 失败后整 session 不再调 LLM）② 假共识（`First Name`/`Last Name` 误合并丢 LLM 字段）③ Shadow DOM afId 重排碰撞 ④ 相邻 contenteditable PII 泄露（BR12）；+ 次要（纯 llm 解析失败语义 / ARIA options / T8 测试缺 / 2 fixture 缺）。
- 全部已修 + 回归测试锁定（每个 bug 一条新测试）+ 次要项补齐。**Round 2 = PASS**（独立再审，无新破坏，strongLabelMatch 不过紧）。

**UI GAN：** `ui_review_result: static_review_pass`（运行时跳过 —— Chrome MCP 驱动不了扩展自身 sidepanel/options UI，CLAUDE.md 约束）。静态审查：5 个 UI 面全实现（Options 扫描模式 3 选 / FieldExplainer 来源徽章 / 静态边界提示 / recall 对比条 / 外发提示），图标全 lucide-react（Code GAN 维度 4 确认 JSX 零 emoji），4 态覆盖。

> **诚实记录**：sidepanel **per-scan 模式下拉覆盖（O2）未实现** —— 模式由 Options 全局设置控制、sidepanel 读 `meta.mode` 显示（R6 完整可用）。O2 是 ideation 标注的可选增强，诚实后置，非降阶 R6。

T12（文档回写）在 Phase 8 执行。

---

## 0. 红线合规摘要（贯穿所有 task）

| 红线 | 本计划如何守住 |
|---|---|
| 1 禁占位 | 无 TODO/pass/空函数体；每个 task 的 acceptance_criteria 含「行为可测」断言 |
| 2 禁 Mock | 生产逻辑全真实；**单测在网络边界 mock `callLLM` 属正当**（不是 mock 功能本身）；extract.ts 的 prompt 构建 + 解析为真实代码 |
| 3 禁降阶 | 见 §2 降阶信号词扫描——每个「可能被偷懒跳过」的点显式标注「必须实现」 |
| 4 禁过时 | 见 §1 依赖版本标注；零新增运行时依赖 |
| 5 优先复用 | 已执行 oss-scan；R3 复用 callLLM+parseBatchResponse、R7/R8/R9 复用现有基建；自研项均有 oss-scan 差距说明 |
| 6 禁 emoji 图标 | UI task（T10）图标一律 lucide-react（Sparkles/CheckCircle2/Info/BarChart2/Wrench/Bot/Loader2/ChevronDown/RotateCw/X）；JSX text 节点禁 emoji |

## 1. 依赖版本标注（红线 4）

| 依赖 | 版本（项目锁定） | 最新稳定 | 查证 | 处置 |
|---|---|---|---|---|
| @anthropic-ai/sdk | ^0.30.1 | 0.100.1 | 2026-06-08 | 复用现有 callLLM，不升级（独立维护任务） |
| openai | ^4.73.0 | 6.42.0 | 2026-06-08 | 同上 |
| zod | ^3.23.8 | 4.4.3（zod/v4 子路径） | 2026-06-08 | 新 schema 用 zod3，与项目一致 |
| wxt / dexie / vitest / happy-dom | 项目锁定 | 维持 | 2026-06-08 | 复用 |
| **新增运行时依赖** | **0** | — | — | 核心管线 MV3 专有逻辑 |

## 2. 降阶信号词扫描（红线 3）

> 列出本功能「最容易自我降阶」的点 + 反制。Plan GAN 维度 2/3 会复核。

| 易降阶点 | 偷懒写法（禁止） | 必须实现 |
|---|---|---|
| R8 recall 语料 | 「拿不到真实 HTML 就跳过 R8」 | 用 CLAUDE.md/PRD 已详述的结构（两列 t-row/t-col、opacity:0 radio、form-row 扁平、按钮组）**构造代表性 fixture**（诚实标注「representative，建模文档结构」），写真实 recall 断言 |
| R3 extract | 「LLM 难测，整体 mock」 | 生产代码真实（prompt 构建 + parseBatchResponse 解析 + 映射）；**仅单测在 `callLLM` 边界注入假响应** |
| R4 回填 | 「先用 LLM 给的 selector」 | 必须 `[data-af-id]` 回填 + afId 存在性校验 + DOM 硬约束覆盖 |
| R7 缓存 | 「MVP 先不缓存」 | MVP 必须（失败模式 F6）；最简内存 Map 也要落地 + 测命中 |
| R5 兜底 | 「LLM 失败抛错给 UI」 | hybrid 必须退回启发式结果（ok:true + llmFallback），不白屏 |
| migration | 「scanMode 直接读默认，不写 migration」 | 必须 v5→v6 migration + schema.test，符合 CLAUDE.md 三件套 |

---

## 3. 任务分解

> 顺序 = 依赖拓扑。每个 task 自含 acceptance_criteria（契约式，可由 verify 阶段断言）+ status。
> 命令：`pnpm compile`（tsc）/ `pnpm lint`（0 warning）/ `pnpm test`（vitest）—— 每个含代码的 task 完成后必须三绿。

### T1 — 共享类型 + provenance 扩展　【foundational】
- **文件**：`src/lib/fields/semantic/types.ts`（新）；`src/lib/db/types.ts`（改 provenance union）
- **依赖**：无
- **内容**：`ScanMode` / `ControlManifestEntry` / `LlmExtractedField` / `ScanResult` / `ScanResultMeta`（api.md §1.1）；`DetectedFieldProvenance.source` 加 `'llm-semantic'|'heuristic+llm'`、`labelSource` 加 `'llm-semantic'`；`AppSettings.scanMode?: ScanMode`。
- **acceptance_criteria**：
  - [ ] `pnpm compile` 通过（exactOptionalPropertyTypes 下可选字段省略 key，不赋 undefined）
  - [ ] 所有新类型 export；`ControlManifestEntry.domConstraints` 形状与 `FieldConstraints` 对齐
  - [ ] provenance union 扩展不破坏现有 field-scanner 的赋值点（现有 source 值仍合法）
- **status**: completed · code_review: pass (Code GAN 2 轮)

### T2 — R1 DOM 打标引擎
- **文件**：`src/lib/fields/semantic/tagger.ts`（新）；`tagger.test.ts`
- **依赖**：T1
- **内容**：`tagInteractiveControls(root: Document|ShadowRoot): void`——遍历候选可交互元素（input/select/textarea/[role]/[contenteditable]/button/[tabindex]），可见者挂 `data-af-id='af-N'`；递归 Shadow DOM（复用现有深度上限思路）；**幂等**（已有 data-af-id 跳过）；**容忍 opacity:0**（HiCool 教训，只拒 display:none/visibility:hidden/aria-hidden）。
- **acceptance_criteria**：
  - [ ] 注入两次，afId 编号不变、不重复（幂等测试）
  - [ ] styled `<button>` 与 opacity:0 `<input>` 都被打标
  - [ ] 纯展示文本 / `display:none` 元素不被打标
  - [ ] Shadow DOM 内控件被打标
  - [ ] `pnpm test` 新测试通过
- **status**: completed · code_review: pass (Code GAN 2 轮)

### T3 — R2 控件清单蒸馏
- **文件**：`src/lib/fields/semantic/distill.ts`（新）；`distill.test.ts`
- **依赖**：T1, T2
- **内容**：`distillManifest(root): ControlManifestEntry[]`——对每个 `data-af-id` 控件产出精简记录；`nearbyText` ≤120 字；`domConstraints` 从 DOM 抽真值（maxLength/required/options/accept/pattern）；`groupHint`=最近 row/fieldset 签名；**仅可见**；**绝不含原始 HTML**（BR9）。
- **acceptance_criteria**：
  - [ ] 每条 entry 的 afId 可被 `querySelector('[data-af-id=...]')` 命中
  - [ ] select/radio/checkbox 的 `options` 被正确抽取
  - [ ] file 控件 `accept` 被抽取
  - [ ] `nearbyText` 截断 ≤120；输出不含 `<` `>` 原始标签
  - [ ] **（隐私 F7/BR12，Plan GAN）** manifest 不含任何 input/textarea 的**已填写 value**——只发 placeholder/nearbyText/options 等元信息，不发用户已输入内容（防已填 PII 外泄）
  - [ ] `pnpm test` 通过
- **status**: completed · code_review: pass (Code GAN 2 轮)

### T4 — R3 LLM 语义提取
- **文件**：`src/lib/claude/client.ts`（**改：export 现有私有 `callLLM`**，client.ts:337）；`src/lib/fields/semantic/extract.ts`（新）；`extract.test.ts`
- **依赖**：T1, T3
- **内容**：**先导出 `callLLM`**（Plan GAN 实证：现为模块私有 `async function callLLM`@client.ts:337，未 export，仅被 client.ts 内部 generateDraft/generateBatchDrafts 调用；加 `export` 或 `export { callLLM }`，**不改其逻辑**）。`buildSemanticPrompt(manifest)` + `extractFieldsViaLLM(manifest, llmConfig): Promise<LlmExtractedField[]>`——复用 `callLLM`；prompt 借 detectEventFromPage 模式（api.md §3）；输出走 `parseBatchResponse`/`structuredExtract`（prompts.ts）容错解析；解析全失败抛错。
- **acceptance_criteria**：
  - [ ] `callLLM` 已 export 且现有内部调用点（generateDraft/generateBatchDrafts）不受影响、现有 client/prompts 测试不退
  - [ ] prompt 含「只用清单里的 afId，不编造」「排除动作/隐藏控件」「sensitive 分类」指令
  - [ ] 单测注入假 LLM JSON 响应（mock `callLLM`），断言正确映射为 `LlmExtractedField[]`
  - [ ] 单测覆盖含裸换行/ASCII 引号的脏响应（走 structuredExtract）仍解析成功
  - [ ] LLM 抛错时本函数向上抛（不吞）
  - [ ] `pnpm test` 通过
- **status**: completed · code_review: pass (Code GAN 2 轮)

### T5 — R4 afId 回填 + 硬约束校验
- **文件**：`src/lib/fields/semantic/backfill.ts`（新）；`backfill.test.ts`
- **依赖**：T1, T3, T4
- **内容**：`backfillAndValidate(llmFields, manifest): DetectedField[]`——纯函数；①afId 必须在 manifest 存在否则剔除（BR4）②label/type/sensitive 取 LLM，**maxLength/options/required/accept/pattern 取 manifest（BR3）**③type 调和（DOM 已知类型优先）④`domSelector='[data-af-id="..."]'`（BR11）⑤sensitive→noAiFill+sensitiveKind（BR5）⑥provenance.source='llm-semantic'。
- **acceptance_criteria**：
  - [ ] LLM 返回不存在 afId → 该字段不出现在结果（防幻觉测试）
  - [ ] LLM 给的 maxLength 与 manifest 不同 → 结果取 manifest 值（DOM 权威测试）
  - [ ] sensitive='personal' → 结果 `constraints.noAiFill===true && sensitiveKind==='personal'`
  - [ ] 多 afId 字段 → domSelector 用 primary afId
  - [ ] `pnpm test` 通过
- **status**: completed · code_review: pass (Code GAN 2 轮)

### T6 — R7 扫描结果缓存
- **文件**：`src/lib/fields/semantic/scan-cache.ts`（新）；`scan-cache.test.ts`
- **依赖**：T1
- **内容**：`computeDomSignature(manifestOrCounts)` + `getCached(sig)` / `setCached(sig, result)`——会话级内存 Map；键含 url + 控件数 + 标签文本 hash。
- **acceptance_criteria**：
  - [ ] 同签名第二次 get 命中返回缓存
  - [ ] DOM 变（控件数/标签变）→ 签名变 → 不命中
  - [ ] `pnpm test` 通过
- **status**: completed · code_review: pass (Code GAN 2 轮)

### T7 — R5 混合编排
- **文件**：`src/lib/fields/semantic/orchestrate.ts`（新）；`orchestrate.test.ts`
- **依赖**：T2,T3,T4,T5,T6
- **内容**：`scanHybrid(...)` 编排：heuristic 快路径 + R1→R4 + 合并去重（afId/selector 重叠→consensus `heuristic+llm`，BR8）+ **LLM 失败退回启发式**（BR7）+ 缓存（BR6）+ 产出 `ScanResult`（含 recall meta）。注：编排接收已注入返回的 `{manifest, heuristicFields}` + 调 extract/backfill（SW 侧）。
- **acceptance_criteria**：
  - [ ] mode=hybrid 且强制 LLM 抛错 → 返回 fields==纯启发式集 + `meta.llmFallback===true`（兜底测试，**核心**）
  - [ ] 启发式与 LLM 都检出同字段 → provenance.source==='heuristic+llm'
  - [ ] 仅 LLM 检出 → 'llm-semantic'；仅启发式 → 原 source
  - [ ] meta.heuristicCount/llmCount/mergedCount 正确
  - [ ] 缓存命中 → meta.cacheHit===true 且未调 extract
  - [ ] `pnpm test` 通过
- **status**: completed · code_review: pass (Code GAN 2 轮)

### T8 — R6 scanMode + Dexie v5→v6 迁移
- **文件**：`src/lib/db/schema.ts`（改）；`src/lib/db/types.ts`（已在 T1）；`schema.test.ts`（改）
- **依赖**：T1
- **内容**：`db.version(6)` migration——appSettings.scanMode 缺失则注入 'heuristic'（BR1）；幂等；无损；无新表。
- **acceptance_criteria**：
  - [ ] 模拟 v5 库（无 scanMode）升级后读出 'heuristic'
  - [ ] 已有 scanMode='hybrid' 的库升级不被覆盖
  - [ ] 现有表数据无损（projects/documents/... 行数不变）
  - [ ] `pnpm test` schema 测试通过
- **status**: completed · code_review: pass (Code GAN 2 轮)

### T9 — 注入入口 + content.ts bundle + 消息总线改造
- **文件**：`src/entrypoints/content.ts`（**改：import tagger/distill，暴露 window helper**）；`src/entrypoints/background.ts`（改 scanFieldsOnTab + handle）；`src/lib/messages/types.ts`（改 payload）
- **依赖**：T2,T3,T7,T8
- **关键背景（Plan GAN 实证，必须先读真实代码）**：现有 `scanFieldsOnTab`（background.ts:483）用 `executeScript({files:['/content-scripts/content.js']})`，content.ts 的 `main()` 固定 `return win.__applyforge_scan__()`；`fillFieldsOnTab`（background.ts:497）用第二次 `executeScript({func})` 调 `window.__applyforge_fill__`。**`files:` 注入不接受 `args`** → mode 信号传不进 content.ts `main()`；tagger/distill **只有被 content.ts import 才会打进 content.js bundle**（标「运行上下文 content-script」不会自动成立）。
- **内容（方案 B，对齐现有 `__applyforge_fill__` 模式）**：
  ① content.ts import tagger/distill/scanFields，挂 `win.__applyforge_tag_distill__ = () => { tagInteractiveControls(document); return { manifest: distillManifest(document), heuristicFields: scanFields(document) }; }`。
  ② `scanFieldsOnTab(tabId, mode)` 按 mode 分流：heuristic → 现状（`__applyforge_scan__`）；hybrid/llm → 先 `files` 注入挂 helper，再 `executeScript({func: () => window.__applyforge_tag_distill__()})` 拿 `{manifest, heuristicFields}`，SW 侧调 `scanHybrid`（extract/backfill/merge），返回 `ScanResult`。
  ③ `fields.scan` payload 加 `mode?: ScanMode`；新增/复用 `settings.setScanMode`。
- **acceptance_criteria**：
  - [ ] **（最高风险，必断言）** mock `chrome.scripting.executeScript`，断言 hybrid 路径从注入回传对象形状 = `{ manifest: ControlManifestEntry[], heuristicFields: DetectedField[] }`，且 `scanHybrid` 正确解构二者
  - [ ] tagger/distill 被打进 content.js bundle（content.ts import 它们；`pnpm build` 后 content bundle 含 `__applyforge_tag_distill__`）
  - [ ] `fields.scan` 不传 mode → 读 AppSettings.scanMode（缺省 heuristic）
  - [ ] heuristic 模式响应 `meta.mode==='heuristic'`，行为与改造前一致（无回归）
  - [ ] `pnpm compile` + `pnpm lint`（0 warning）+ `pnpm build` 通过
  - [ ] 消息类型联合体扩展不破坏现有 30+ message handler
- **status**: completed · code_review: pass (Code GAN 2 轮)

### T9b — afId 漂移防误填守卫（Plan GAN 新增）
- **文件**：`src/lib/fields/semantic/backfill.ts` 或 `field-scanner.ts` fill 路径（导出 `verifyAfIdConsistency`）；content.ts 的 `__applyforge_fill__` 包装
- **依赖**：T5,T9
- **背景**：BR11 把 domSelector 钉死成 `[data-af-id]` 后，React 重排会让 `[data-af-id="af-3"]` 命中**另一个**控件 → fillField（field-scanner.ts:1522，纯 selector 驱动、不校验语义）**静默写错框**，比写不上更危险。
- **内容**：fill 前对 afId 命中元素做 tag/nearbyText 一致性复校（与扫描时 manifest 记录比对），不一致则**跳过该字段并标 failed**（不静默写错）。
- **acceptance_criteria**：
  - [ ] 模拟 afId 命中元素的 tag/标签与扫描时不一致 → 该字段被跳过且标记 failed（不写值）
  - [ ] 一致时正常写入
  - [ ] `pnpm test` 通过
- **status**: completed · code_review: pass (Code GAN 2 轮)

### T10 — R9 + O1 UI 实现
- **文件**：`src/components/FieldExplainer.tsx`（改）；`src/entrypoints/sidepanel/App.tsx`（改 scanCurrentTab/enterDraftWithFields + 控制区/提示条/对比条）；`src/entrypoints/options/App.tsx`（改 设置加扫描模式区块）
- **依赖**：T1,T9
- **内容**：FieldExplainer 来源徽章（lucide Sparkles/CheckCircle2）；sidepanel 扫描控制区模式 chip + 静态边界提示条（Info）+ recall 对比条（BarChart2）；Options 设置扫描模式 3 选区块（Wrench/Sparkles/Bot）；`scanCurrentTab`/`enterDraftWithFields` 解构 `result.fields`、读 `result.meta`。
- **acceptance_criteria**：
  - [ ] 图标全部 lucide-react；**JSX text 节点零 emoji**（UI GAN 维度 4 扫描）
  - [ ] source='llm-semantic'/'heuristic+llm' 在 FieldExplainer 正确显示对应徽章 + 文案
  - [ ] hybrid 结果显示 recall 对比条（meta.heuristicCount/llmCount 存在时确实渲染）；llmFallback 时显示降级文案 + 重试
  - [ ] **（F9 护栏，Plan GAN）** 诚实边界文案「本页静态字段，动态字段需翻页重扫」确实渲染（不谎称扫到动态字段）
  - [ ] **（隐私告知，Plan GAN）** hybrid/llm 模式显示一次性「本页可见控件文字将发送给你配置的模型」外发提示（host 权限 `<all_urls>`）
  - [ ] Options 扫描模式选择持久化（settings.setScanMode），无模型时 hybrid/llm 禁用
  - [ ] `pnpm compile` + `pnpm lint` 通过
- **status**: completed · code_review: pass (Code GAN 2 轮)

### T11 — R8 dogfood 语料 + recall 回归基准
- **文件**：`src/lib/fields/semantic/__fixtures__/*.html`（4 张代表性）+ `*.expected.json`；`semantic-recall.test.ts`（新）
- **依赖**：T2,T3,T5,T7
- **内容**：构造 4 张代表性 fixture（建模 CLAUDE.md 记录的结构：HiCool 两列 t-row/t-col+opacity:0 radio、上海创业营 form-row 扁平+native 单复选、Epic Connector 按钮组、科大硅谷多步）+ expected（真实字段数 + 关键 label）；recall 测试断言 heuristic/hybrid 的 recall 并验证 hybrid≥heuristic。**LLM 在测试中 mock**（确定性）。
- **acceptance_criteria**：
  - [ ] 4 fixture 各有 expected.json（标真实字段数 + 关键字段 label），fixture 顶部注释标「representative，建模 X 表单结构，非抓取真实 HTML」（诚实）
  - [ ] 测试输出每 fixture 的 heuristic recall 数值（基准记录）
  - [ ] 断言 hybrid recall ≥ heuristic recall（不退化）
  - [ ] `pnpm test` 通过
- **status**: completed · code_review: pass (Code GAN 2 轮)

### T12 — 文档回写（Phase 8 闭合学习回路，计划内预置）
- **文件**：`CLAUDE.md`（铁律/扫描器章节加 hybrid 路径）；`docs/PRD.md`（§10 提案→已交付 + 版本号 v0.2.8→v0.3.0 + §5/§13.4 同步）；自动记忆 + MEMORY.md；`iteration-vault/2026-06-08-llm-semantic-field-extraction/`
- **依赖**：T1-T11 全完成
- **acceptance_criteria**：
  - [ ] CLAUDE.md 含 hybrid 扫描器一条铁律/坑记录
  - [ ] PRD §10 状态从「提案·未交付」改为「已交付 V0.3.0」+ 迭代史加 V0.3.0 条目
  - [ ] 自动记忆新增 1 条 + MEMORY.md 索引
- **status**: completed（PRD §9 V0.3.0 + §10 状态 + CLAUDE.md 铁律 + 自动记忆 field-extraction-llm-direction + MEMORY.md + iteration-vault/2026-06-08-* 全回写）

---

## 4. 执行顺序与并行性

```
T1（类型）
 ├─ T2（打标）── T3（蒸馏）── T4（提取）── T5（回填）─┐
 ├─ T6（缓存）───────────────────────────────────┤
 ├─ T8（migration）──────────────────────────────┤
 └────────────────────────────────────────────── T7（编排，汇聚 T2-T6,T8）
                                                   └─ T9（注入/消息）── T9b（防误填）── T10（UI）
                                                   └─ T11（recall，依赖 T2/T3/T5/T7）
T1-T11 + T9b 全绿 → Phase 7 验证 → T12（文档回写，Phase 8）
```
- **可并行**：T2 链、T6、T8 在 T1 后可并行起步（不同文件，无交叉）。T9/T10 串行（UI 依赖消息）。
- **关键路径**：T1→T2→T3→T4→T5→T7→T9→T10。
- subagent 分配：每个 T 一个 subagent，传 index.md+rules.md+本 task 章节；T2-T5/T6/T8 可并行 spawn。

## 5. 风险与依赖识别（Plan GAN 维度 4）

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 注入机制（T9）与现有 content.js 不兼容（`files:` 注入不收 args、tagger/distill 需进 bundle） | 中 | 高 | **方案 B 已定**（T9：files 挂 helper + 第二次 func 调 `__applyforge_tag_distill__`，对齐现有 `__applyforge_fill__`）；**注入返回契约 `{manifest,heuristicFields}` 进 T9 验收闸** |
| `data-af-id` 被 React 重渲染清掉/漂移 → fill **写错框**（比写不上更危险） | 中 | 高 | **T9b afId 一致性复校**：fill 前比对命中元素 tag/标签，不一致跳过标 failed；fillField 已有 fallback |
| 隐私：蒸馏把已填 PII（input.value）外发给 LLM | 中 | 中 | **BR12**：distill 只发元信息不发已填 value（T3 验收钉死）；R9 外发提示（T10）；ideation F7 站点白/黑名单留后续 |
| LLM 提取 recall 实际不如启发式（F2） | 中 | 中 | hybrid 合并取并集（不会比启发式差）；R8 量化把关；默认 heuristic 不影响现有用户 |
| 代表性 fixture 不等于真实表单，recall 数字乐观 | 中 | 低 | 诚实标注 representative；真实 recall 留真机 dogfood（Phase 7 之后人工） |
| exactOptionalPropertyTypes 编译坑（可选字段 undefined） | 中 | 低 | rules.md 显式规则；每 task compile 闸 |
| SDK 版本旧（0.30 vs 0.100）缺新 API | 低 | 低 | 只用 messages.create + chat.completions（0.30/4.73 已稳定）；不依赖新 API |
| `callLLM` 当前未导出（T4 复用前置） | 已知 | 低 | T4 首步 export callLLM，不改逻辑（已入 T4 内容/验收） |

## 6. 验收总闸（Phase 7 引用）
- `pnpm compile` 0 error · `pnpm lint` 0 warning · `pnpm test` 全绿（现有 79 + 新增）
- `pnpm build` 产物 ≤ 目标体积（~2.9MB 基线，零新依赖不应显著增长）
- 红线 6 项全过；recall 回归 hybrid≥heuristic
- 兜底验证：hybrid 强制 LLM 失败 → 不白屏、退回启发式

---

**阶段 5 计划产出完成。** 下一步：5.5 生成 index.md + rules.md → 5.9 Plan GAN（autodev-review --target plan）。
