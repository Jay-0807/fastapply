# RULES — 字段识别 LLM 语义提取（始终加载的编码约束）

> 开发任何 task 前必读。违反任一条 = Code/UI GAN 直接 FAIL。

## 项目耐久铁律（CLAUDE.md）
1. **非 git 仓库** —— 不跑 git log/blame；改动只在磁盘；交付无 PR。
2. **图标一律 lucide-react，禁 emoji** —— JSX/template text 节点禁写 emoji unicode（白名单仅 i18n JSON 值/注释/文档/UGC）。
3. **`exactOptionalPropertyTypes: true`** —— 可选字段要么给值要么省略 key，**绝不显式赋 `undefined`**（如 `x?: T`，没值就别写 `x: undefined`）。
4. **改完回写文档**（T12，闭合学习回路）。

## 本功能业务规则（api.md BR1-13，硬约束）
- **BR3 DOM 是硬约束唯一真相**：maxLength/options/required/accept/pattern 一律取 DOM（manifest），LLM 给的忽略。
- **BR4 afId 存在性校验**：LLM 返回的 afId 不在 manifest → 整条字段剔除（防幻觉）。
- **BR5 敏感字段**：sensitive≠null → `constraints.noAiFill=true` + `sensitiveKind`（AI 不代写，对齐 V2.8 G5）。
- **BR7 LLM 失败兜底**：hybrid 模式 LLM 任一步失败 → 退回启发式结果 + `meta.llmFallback=true`，**返回 ok:true，不白屏**；纯 llm 模式才 ok:false。
- **BR9 隐私**：蒸馏只发可见控件元信息，**绝不发原始 HTML**。
- **BR12 不发已填值（Plan GAN）**：distill **不发** input/textarea 的已填写 `value`（防已填 PII 外泄）；只发 placeholder/nearbyText/options 元信息。
- **BR10 打标幂等**：已挂 data-af-id 跳过，可重入不重复编号。
- **BR11 domSelector**：一律 `[data-af-id="..."]`。
- **BR13 防误填（Plan GAN）**：fill 前复校 `[data-af-id]` 命中元素 tag/标签与扫描时一致，不一致**跳过标 failed**（React 重排 afId 漂移会静默写错框，比写不上更危险）。
- **BR1 默认 heuristic**：scanMode 缺省/老用户/未设 = heuristic（发布即旧行为）。

## 红线（autodev quality-redlines）
- **禁占位**：无 TODO / pass / 空函数体 / `throw new Error('not implemented')`。
- **禁 Mock 生产逻辑**：生产代码全真实；**仅单测可在 `callLLM` 网络边界注入假响应**（这是正当单测，不算降阶）；不得 mock distill/backfill/orchestrate 本身。
- **禁降阶**：R7 缓存、R8 recall、R5 兜底都是 MVP 必做，不许「先不做」；fixture 用代表性结构但 recall 断言要真。
- **禁过时**：零新增运行时依赖；只用 messages.create + chat.completions（0.30/4.73 已稳定的 API）。
- **复用优先**：scanFields/callLLM/parseBatchResponse/FieldExplainer/Dexie 全复用，别重写。

## 类型对齐（别新造已有的）
- 复用 `FieldType` / `FieldConstraints`（已含 noAiFill/sensitiveKind/options/maxLength）/ `DetectedField` —— 见 db/types.ts:57。
- 新 provenance 值只加 `'llm-semantic'`、`'heuristic+llm'`（source）和 `'llm-semantic'`（labelSource）。

## 每个含代码 task 的完成闸（缺一不可）
1. `pnpm compile` 0 error（exactOptionalPropertyTypes 下尤其检查可选字段）
2. `pnpm lint` 0 warning（eslint --max-warnings 0）
3. `pnpm test` 全绿（现有 79 测试不退 + 新增测试通过）
4. 新增/改动有对应单测（行为可测）

## 风格
- 跟随现有代码风格：中文注释惯例、TS strict、函数式纯函数优先（backfill/distill 无副作用）。
- Shadow DOM/可见性判定：容忍 opacity:0（HiCool 教训），只拒 display:none/visibility:hidden/aria-hidden。
- 新代码注释密度、命名与 field-scanner.ts 一致。
