# INDEX — 字段识别 LLM 语义提取（开发地图）

> 给开发 subagent 的「信息在哪」地图（按需取，别全量加载设计文档）。配套 `*-rules.md`（始终加载）。

## 设计文档（按需查）
| 要找 | 看 |
|---|---|
| 为什么做 / 失败模式 F1-F11 | `*-ideation.md` |
| MECE R1-R9 / 复用决策 / 数据流 / 数据模型 | `*-design.md`（§4 组件映射 / §6 数据流 / §8 数据模型） |
| 开源候选 / 自研理由 | `*-oss-scan.md` |
| UI 面 / 图标清单 / 交互 4 态 | `*-ui.md` |
| 消息契约 / LLM 提取契约 / 业务规则 BR1-11 / migration | `*-api.md` |
| 任务 + 验收标准 | `*-plan.md`（T1-T12） |

## 新模块文件图（全在 `src/lib/fields/semantic/`）
| 文件 | 能力 | 上下文 |
|---|---|---|
| `types.ts` | 共享类型（ScanMode/ControlManifestEntry/LlmExtractedField/ScanResult/ScanResultMeta） | 全局 |
| `tagger.ts` | R1 打标 `tagInteractiveControls` | content-script |
| `distill.ts` | R2 蒸馏 `distillManifest` | content-script |
| `extract.ts` | R3 提取 `buildSemanticPrompt`+`extractFieldsViaLLM` | SW |
| `backfill.ts` | R4 回填校验 `backfillAndValidate`（纯函数） | SW |
| `orchestrate.ts` | R5 编排 `scanHybrid` | SW |
| `scan-cache.ts` | R7 缓存 `computeDomSignature`/`get/setCached` | SW |
| `__fixtures__/*.html` + `semantic-recall.test.ts` | R8 语料+recall | 测试 |

## 现有资产（复用，别重写）—— file:line 已核对
| 资产 | 位置 | 用途 |
|---|---|---|
| `scanFields(root): DetectedField[]` | `field-scanner.ts:158` | R5 启发式快路径/兜底 |
| `fillField(selector)` | `field-scanner.ts:1522` | 填充（[data-af-id] 走标准路径，零改） |
| `detectEventFromPage(tabId)` | `background.ts:296` | R3 prompt 模式范本（页面→LLM→JSON） |
| `scanFieldsOnTab(tabId)` | `background.ts:483` | R9 注入入口（T9 按 mode 分流） |
| `callLLM(args: CallArgs)` | `client.ts:337` | R3 调用（provider 分流+429 backoff） |
| `parseBatchResponse`/`structuredExtract` | `prompts.ts:405/364` | R3 容错解析 |
| `Message` union + `{ok,data,error}` 信封 | `messages/types.ts` / `background.ts:56` | T9 消息扩展 |
| `DetectedField`/`FieldConstraints`/`provenance` | `db/types.ts:57` | T1 扩展 provenance union |
| `AppSettings` + Dexie schema | `db/schema.ts` / `db/types.ts` | T8 v5→v6 migration |
| `FieldExplainer.tsx` | `components/FieldExplainer.tsx` | R9 来源徽章扩展 |
| `scanCurrentTab`/`enterDraftWithFields` | `sidepanel/App.tsx:144/152` | T10 解构 result.fields |
| 测试模式 `document.body.innerHTML=html` | `field-scanner.test.ts` | R8/单测 fixture 模式 |

## 关键类型锚点（实现时对齐）
- `FieldType = 'text'|'textarea'|'select'|'checkbox'|'radio'|'number'|'email'|'url'|'tel'|'date'|'file'|'unknown'`
- `provenance.source` 现 `'html-input'|'aria-group'|'shadow-dom'|'drop-zone'` → 加 `'llm-semantic'|'heuristic+llm'`
- `FieldConstraints` 已有 `maxLength/options/required/noAiFill/sensitiveKind/manualUploadOnly`（R4 直接用，别新造）

## 命令
`pnpm compile`（tsc --noEmit）· `pnpm lint`（eslint，0 warning）· `pnpm test`（vitest）· `pnpm build`（wxt）

## 执行顺序（详见 plan §4）
T1 → {T2→T3→T4→T5, T6, T8} → T7 → T9 → T10；T11 依赖 T2/T3/T5/T7；T12 最后。
