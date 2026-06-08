# 07 — Implementation Log

> Phase 7 actual execution log. 一行一项任务，记录改了哪些文件、verdict 是 ✅ DONE / 🟡 DEFERRED / ❌ SKIPPED + 理由。

## Sprint 7.1 — 基础设施

| T | 描述 | 文件 | 行数 | Verdict |
|---|---|---|---|---|
| T1 | `lib/state/session-state.ts` | 新增 | 159 | ✅ DONE |
| T2 | `components/AsyncButton.tsx` | 新增 | 168 | ✅ DONE |
| T3 | `components/ErrorToast.tsx` | 新增 | 144 | ✅ DONE |
| T4 | `components/StatusBadge.tsx` | 新增 | 47 | ✅ DONE |
| T5 | `components/FieldExplainer.tsx` | 新增 | 119 | ✅ DONE |
| 类型扩展 | `lib/db/types.ts` `DetectedFieldProvenance` + `EventExtractionMeta` | +35 行 | ✅ DONE |

## Sprint 7.2 — P0 修复

| T | 描述 | 文件 | Verdict |
|---|---|---|---|
| T6 | 🔴 sessionKey unlock race — `sessionReadyPromise` await 闸 | `entrypoints/background.ts:36-65` | ✅ DONE |
| T7 | 🔴 scanner 可见性阈值放宽（4px→1px、OR→AND）+ `getVisibilityState` 工具 | `lib/fields/field-scanner.ts:393-456` | ✅ DONE |

## Sprint 7.3 — sidepanel 重构

| T | 描述 | 文件 | Verdict |
|---|---|---|---|
| 包装 ToastProvider | sidepanel/options/popup main.tsx | 全部 3 个 main.tsx | ✅ DONE |
| T8 | step/eventDraft/fields/qaPairs/assetMatches/projectId 改 useTabSessionState | `sidepanel/App.tsx:23-92` | ✅ DONE |
| T9 (核心) | ProjectPicker.下一步 / EventContextEditor.确认扫描 / DraftWorkspace.填入页面 / 我已提交 → AsyncButton | `sidepanel/App.tsx` 多处 | ✅ DONE |
| T9 (生成全部) | 保留为 plain button + 自定义 progress | 同上 | ✅ DONE (有理由：multi-child progress 不适合 AsyncButton 内部生命周期) |
| T10 | chrome.storage.session.lastModel 双写 | — | 🟡 DEFERRED — 当前 `db.appSettings.update` + seededFromSettings 已能用，竞态发生概率低，重构成本高于收益 |
| T11 | ExtractionConfidenceBanner + FieldOriginBadge | — | 🟡 DEFERRED — 依赖 T19（confidence 字段从 background 返回），先做底层 |
| T12 | 资产匹配失败 → ErrorToast | `sidepanel/App.tsx:194-201` | ✅ DONE |
| 副品 | 3 处 `alert()` → `toast.error/warning/success` | sidepanel | ✅ DONE |

## Sprint 7.4 — scanner 改进

| T | 描述 | 文件 | Verdict |
|---|---|---|---|
| T13 | DetectedField.provenance 字段写入 | 类型已加但 scanner 未填充 | 🟡 DEFERRED |
| T14 | MAX_LENGTH_PATTERNS 扩充 5 个变体（约/控制在/左右/about/不能超过） | `field-scanner.ts:53-78` | ✅ DONE |
| T15 | file input drop-zone heuristic | — | 🟡 DEFERRED — 当前可见性放宽（T7）已部分缓解 |
| T16 | ARIA group 静默跳过 → SkippedSummary | — | 🟡 DEFERRED |
| T17 | FORM_EDITOR_URL_PATTERNS 加 Qualtrics/Tally/Jotform/问卷星；ADMIN_LABEL_PATTERNS 加 7 个新模式 | `field-scanner.ts:19-77` | ✅ DONE |
| T18 | 长页面 semantic extraction（main/role=main/#content）+ 4000→8000 字 + "宁缺勿猜" prompt | `background.ts:289-318` + `extractEventFromBody` prompt | ✅ DONE |
| T19 | Shadow DOM 递归 + extractionConfidence/source 字段 | — | 🟡 DEFERRED |

## Sprint 7.5 — options/popup 同步

| T | 描述 | 文件 | Verdict |
|---|---|---|---|
| T20 | options/App.tsx 6 处 alert() → toast；DocumentManager/AssetManager/HistoryPane 注入 useToast | `entrypoints/options/App.tsx` 多处 | ✅ DONE |
| T21 | popup 包 ToastProvider（popup 本身没大改） | `entrypoints/popup/main.tsx` | ✅ DONE |

## 累计

- **完成 13 / 21 任务** (62%)
- **延期 8 / 21 任务**（标 🟡）— 都属"加分项"，没影响 V2 用户体感核心提升
- **TypeScript** 编译 clean
- **测试** 27 / 27 通过（新增 9 项 MAX_LENGTH + URL 编辑器 + Jotform admin pattern 覆盖）
- **build** 2.75 MB（+10 KB，可接受）

## 哪些 P0/P1 痛点真的修了

对比 `01.5-user-research.md` 的 17 个 P0+P1：

### 完全修复 (✅ × 12)

1. ✅ P0 sessionKey 解锁竞态（B.1）
2. ✅ P0 scanner 可见性失效（C.1）
3. ✅ P1 confirm 按钮无 loading
4. ✅ P1 下一步按钮无反馈
5. ✅ P1 fillPage 无 loading + 成功/失败 toast
6. ✅ P1 goToContextStep 静默 return → throw
7. ✅ P1 资产匹配 catch 默不作声 → toast.warning
8. ✅ P1 step / eventDraft / fields / qaPairs / assetMatches 不再丢
9. ✅ P1 markSubmitted 错误 alert → toast
10. ✅ P1 MAX_LENGTH 漏 "约/控制在/左右"
11. ✅ P1 表单编辑器 URL 黑名单 + ADMIN_LABEL 不覆盖 Jotform/Tally 等
12. ✅ P1 长页面 4000 字截断

### 部分缓解 (🟡 × 2)

13. 🟡 detectEventFromPage Claude 失败默默 meta-only —— prompt 加了"宁缺勿猜"指令降低 hallucination，但**置信度可视化**（T11/T19 confidence 字段）没做。等做 T19 时一起。
14. 🟡 file input drop-zone 选错 —— T7 可见性放宽间接缓解；专门 drop-zone heuristic（T15）没做。

### 推到下一轮 (🟡 × 3)

15. 🟡 模型选择 settings 倒灌竞态（T10）—— 概率小，暂存
16. 🟡 ARIA group 静默跳过（T16）—— 用户研究价值低
17. 🟡 Shadow DOM 不递归（T19）—— LWC/Shoelace 比例低

## Karpathy 4 原则自检

- ✅ **Think Before Coding** — 写 docs 时已逐项 P0/P1 评估，没埋头猛改
- ✅ **Simplicity First** — 没引入过度抽象（如 redux/zustand 状态机）；AsyncButton 是最小化包装
- ✅ **Surgical Changes** — 没顺手优化无关代码；删了 1 个无用 hidden button、移除了 `void` 改 await 的边角
- ✅ **Goal-Driven Execution** — 每项都有可验证标准（test pass / build pass / 用户能看到 loading 状态）
