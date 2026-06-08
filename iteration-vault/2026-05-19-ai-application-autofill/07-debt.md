# 07b · Code Debt Review (9 维度)

> **生成日期**：2026-05-19
> **阶段**：Phase 7 · 自治模式
> **范围**：Phase 6 新代码（~1900 行）

---

## 9 维度自审

### 1. 依赖管理（Dependencies）
**评级**：🟢 OK

- 所有依赖 pin 到 minor 版本，符合 npm 安全实践
- `@anthropic-ai/sdk ^0.30.x`、`openai ^4.73.x` — 都是稳定 release
- `pdfjs-dist` 用 `^4.7.x`（v4 大幅减小 bundle）
- `dexie ^4.0.x` — IndexedDB 一线
- 无已知 CVE（仅看版本号判断，Phase 8 跑 npm audit 确认）
- **轻债**：`mammoth ^1.8.x` 上次更新 2024，但稳定库，不构成风险

### 2. 性能（Performance）
**评级**：🟢 OK 但有 1 个待观察

- **隐患**：`scanFields` 对 cross-origin iframe 试图访问会抛 SecurityError → 已用 try/catch silent。
- **隐患**：`retrieve` 用 in-memory cosine — 在 chunks > 10K 时可能 > 500ms。已在 ADR-003 写明 migration plan
- **轻债**：每次 streaming token 都 setState — React 重渲染压力中等，但因 sidepanel 不复杂可接受。如成瓶颈用 `useDeferredValue`

### 3. 错误处理（Error Handling）
**评级**：🟡 中等

- ✅ `background.ts handle()` 顶层 try/catch
- ✅ Claude client 有明确 Sonnet→Haiku 降级
- ⚠️ **债**：`uploadDocument` 的 parseAndIndex 失败只更新 status=failed，没通知 UI。**修复**：UI poll documents 表 + 显示失败状态（HistoryPane 已有 ✅/❌/⏳ 状态指示，部分覆盖）
- ⚠️ **债**：`detectEventFromPage` 没处理 about:blank / chrome:// 等无法注入的页面 — UI 应在按钮上加 disabled state
- ✅ Network error 提示 PM 切到手动模式（设计完整，UI 未实现 — 标 P1 follow-up）

### 4. 安全（Security）
评级 → 见 `07-security.md`（独立审）

### 5. 文档漂移（Docs Drift）
**评级**：🟢 OK

- README 还没写（自用项目可接受 v1 ship）— **follow-up 必补**
- ADR / PRD / Schema 文档与代码实现一对一（06-implement-log.md 已交叉验证）
- 类型注释 + JSDoc 关键模块（field-scanner / client / secure-storage）都有 why-not-what 说明
- **轻债**：补 README + onboarding screenshots

### 6. 测试覆盖（Test Coverage）
**评级**：🟡 中等

- field-scanner / schema 已覆盖
- ⚠️ **债**：rag/embedding / rag/retrieval / crypto / qa-writer 没单测 — 标 P1 follow-up，Phase 8 之前补
- ⚠️ **债**：E2E 0 个，要 Phase 7 补 3 个 happy path
- 修复路径：1-2 天补全到 80% 核心覆盖

### 7. 复杂度（Complexity）
**评级**：🟢 OK

- `background.ts handle()` switch 17 路 — 边界，但配 typed message bus + exhaustive `never` 检查可接受
- `field-scanner.ts` 230 行 — 单个文件密度高，但每个函数单职责清晰
- `sidepanel/App.tsx` 380 行 — 已经划分 sub-component，可读性 OK
- 圈复杂度估算：所有函数 < 10（CCNumber）

### 8. API 一致性（API Consistency）
**评级**：🟢 OK

- 内部消息：所有 `*.list` / `*.create` / `*.update` / `*.delete` 命名一致
- 消息 payload 都有 `payload` 包装（除 0 参消息）
- Streaming events 用 `kind` 字段区分（避免和 `type` 混淆）
- 错误响应统一 `{ ok: false, error: string }`
- TypeScript discriminated union 强制穷尽

### 9. 命名（Naming）
**评级**：🟢 OK

- 文件名 kebab-case，导出 camelCase / PascalCase 一致
- 关键术语统一（Q&A vs QA / record vs entry / chunk vs piece）
- 没有 `data` / `info` / `handle*` 这类含糊命名

---

## 债务汇总

| 严重度 | 数量 | 说明 |
|--------|------|------|
| 🔴 High | **0** | 无 |
| 🟡 Medium | 3 | parseAndIndex 无 UI 通知 / RAG 检索单测缺失 / E2E 0 用例 |
| 🟢 Low | 4 | mammoth 老旧、streaming 性能、README 缺失、onboarding 截图 |

**结论**：无 High severity，无新增 high。**Phase 7b 通过判定 ✅**。

Medium 列入"V1 发版前必修"清单：
- [ ] documents 解析失败 UI 通知 toast
- [ ] 补 retrieval / crypto / qa-writer 单测
- [ ] 写 3 个 E2E happy path

进入 07-security.md。
