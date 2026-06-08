# 06 — Task Breakdown for UX Iteration

> 把 05a 的 21 项任务拆成可执行的 sprint。每个 T 对应一个 commit。

## Sprint 划分

| Sprint | 任务 | 入口可改文件 | 估时 | 状态 |
|---|---|---|---|---|
| **7.1 基础设施** | T1-T5 | 新建 lib/state + components | 1.5h | 进行中 |
| **7.2 P0 修复** | T6-T7 | background.ts + field-scanner.ts | 0.5h | pending |
| **7.3 sidepanel 重构** | T8-T12 | sidepanel/App.tsx | 1.5h | pending |
| **7.4 scanner 改进** | T13-T19 | field-scanner.ts + background.ts | 1.5h | pending |
| **7.5 options/popup 同步** | T20-T21 | options/App.tsx + popup/App.tsx | 0.5h | pending |
| **9-10 审查 & 验证** | — | pnpm test + pnpm build | 0.5h | pending |

## T1-T21 任务清单

### Sprint 7.1 — 基础设施（共享依赖）

- [ ] **T1** 新建 `src/lib/state/session-state.ts` —— `useTabSessionState<T>(key, defaultValue, tabId?)` hook，基于 `chrome.storage.session` + onChanged 订阅
- [ ] **T2** 新建 `src/components/AsyncButton.tsx` —— idle/busy/done/error 四态 + 内置超时/冷却
- [ ] **T3** 新建 `src/components/ErrorToast.tsx` —— 全局 toast 队列 + 错误日志写入 db.errorLog
- [ ] **T4** 新建 `src/components/StatusBadge.tsx` —— 提取已有 fieldState 徽章逻辑为可复用组件
- [ ] **T5** 新建 `src/components/FieldExplainer.tsx` —— provenance 折叠展示器

### Sprint 7.2 — P0 修复

- [ ] **T6** 🔴 `background.ts:39` `sessionReadyPromise` await 闸 + 所有 handler 入口 await
- [ ] **T7** 🔴 `field-scanner.ts:403-406` 移除 `docHasLayout` 短路 + 区分 file/aria input 处理

### Sprint 7.3 — sidepanel 重构

- [ ] **T8** sidepanel/App.tsx 的 step/eventDraft/fields/qaPairs/assetMatches 改 `useTabSessionState`
- [ ] **T9** 所有按钮换 `AsyncButton`（包含 next/confirm/fillPage/markSubmitted/changeProject）
- [ ] **T10** 模型选择改 chrome.storage.session.lastModel 双写 + 移除 seededFromSettings 竞态
- [ ] **T11** ExtractionConfidenceBanner + FieldOriginBadge（依赖 T19 background 输出）
- [ ] **T12** 资产匹配失败用 ErrorToast 提示

### Sprint 7.4 — scanner 改进

- [ ] **T13** DetectedField 加 provenance 字段 + 全 scanner 写入
- [ ] **T14** MAX_LENGTH_PATTERNS 扩充（限/约/控制在/不少于/左右 + 英文）
- [ ] **T15** file input drop-zone 启发式（找可见 drop zone 容器）
- [ ] **T16** ARIA group 静默跳过 → scanResult.skippedGroups + SkippedSummary
- [ ] **T17** 表单编辑器 URL 黑名单 + ADMIN_LABEL_PATTERNS 扩充
- [ ] **T18** background.ts:268 长页面 semantic 取文（main/role=main/#content）+ 4000→8000
- [ ] **T19** Shadow DOM 递归（traverseShadowRoots BFS 深度 5）+ background.ts extractEventFromBody 增 confidence

### Sprint 7.5 — options/popup 同步

- [ ] **T20** options/App.tsx 文档/资产上传/备份导入/导出按钮换 AsyncButton
- [ ] **T21** options 错误改 ErrorToast；popup 同步

### Sprint 9-10 — 验证

- [ ] pnpm test （新增 12 项 + 更新 6 项）
- [ ] pnpm build 体积无显著回归
- [ ] manual happy-path: 装入 chrome → 解锁 → 建项目 → 扫表单 → 看 FieldExplainer

## 依赖图

```
T1 (session-state hook)
 └→ T8, T10

T2 (AsyncButton)
 └→ T9, T20

T3 (ErrorToast)
 └→ T12, T21

T5 (FieldExplainer) ← T13 (provenance)
 └→ shown in sidepanel field cards

T6, T7 独立，P0 优先做
T8-T12 依赖 T1-T3
T13-T19 同时间可做（field-scanner 不同区域）
T11 等 T19 完成
T20-T21 最后
```

## 执行顺序

1. T1 → T2 → T3 → T4 → T5（5 个基础设施串行做，避免互相 import 冲突）
2. T6 → T7（P0 优先）
3. T13 + T14 + T15 + T16 + T17 + T18 + T19（scanner 并行，单文件改不同段）
4. T8 → T9 → T10 → T11 → T12（sidepanel 串行，避免 merge 冲突）
5. T20 → T21（options/popup）
6. 测试 + build
