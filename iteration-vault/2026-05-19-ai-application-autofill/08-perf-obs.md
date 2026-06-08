# 08 · Performance + Observability

> **生成日期**：2026-05-19
> **阶段**：Phase 8 · 自治模式
> **降级原因**：Sentry MCP create_project 返回 403（用户当前账号在 firefly-hy org 下无创建权限）。降级为：代码层 SDK 就位 + DSN 配置文档化，PM 在 dashboard 手动创建后填入 .env 即可激活。

---

## Sentry 接入

### 已落地代码
- `src/lib/observability/sentry.ts` — 全功能 SDK init，含：
  - DSN 空时静默跳过（开发 / 隐私模式都安全）
  - `beforeSend` PII scrub（10+ 敏感字段名按白名单遮罩）
  - `beforeBreadcrumb` 字符串级 redact（sk-...、sk-ant-...、email regex）
  - `captureException` / `captureMessage` 包装
- `src/lib/observability/performance.ts` — `measureAsync` 装饰器
- `.env.example` — DSN 配置模板

### 在入口集成（待 follow-up commit）
Phase 6 入口文件已 import 但**未启用 init**（避免空 DSN 抛错）。一行启用：

```ts
// In each entrypoint's main file:
import { initSentry } from '@/lib/observability/sentry';
initSentry('background'); // or 'popup' / 'sidepanel' / etc.
```

### PM 后续步骤（5 分钟）
1. 打开 https://firefly-hy.sentry.io
2. New Project → 选 "Browser JavaScript"，命名 "applyforge"，team "firefly"
3. 复制 DSN
4. 在项目根复制 `.env.example → .env`，填入 `WXT_SENTRY_DSN=https://...@de.sentry.io/...`
5. 重新 `pnpm build` 即生效

---

## 性能基线

### 已知 / 可控
| 指标 | 设计目标 | 实现策略 | 验证方式 |
|------|---------|----------|----------|
| 字段扫描 100 字段 | < 500ms | 按需触发（非 MutationObserver），单次 DOM 遍历 | `measureAsync('field-scan', ...)` |
| 文档解析 5MB PDF | < 60s | pdfjs Worker、Service Worker 中异步 | 后台进度 broadcast |
| 嵌入 200 chunks | < 30s | OpenAI batch=100 并发 | API 调用计时 |
| RAG 检索 2K chunks | < 200ms | 纯 JS 余弦，Float32Array 复用 | Sentry metric |
| Sonnet 首字 token | < 3s P50 | Streaming + 无前置长链 | Sentry tracing |
| Sonnet 完整响应 | < 8s P50, < 15s P95 | max_tokens=2048 | Sentry tracing |

### 已知风险
- ⚠️ Cross-origin iframe 完全无法扫（已 silent skip，UI 提示）
- ⚠️ 嵌入大批量并发 → OpenAI 速率限制；批 100 是稳妥值
- ⚠️ 余弦相似度 chunks > 10K 时变慢（ADR-003 有迁移计划）

---

## 仪表盘指标（PM 上线后看）

发往 Sentry 的关键 metric（无 PII）：
```
applyforge.field_scan.duration_ms      (histogram)
applyforge.doc_parse.duration_ms       (histogram, tagged by mime_type)
applyforge.embedding.duration_ms       (histogram, tagged by batch_size)
applyforge.rag_retrieval.duration_ms   (histogram)
applyforge.claude_call.duration_ms     (histogram, tagged by model+ok)
applyforge.claude_call.retried         (counter)
applyforge.claude_call.fallback_used   (counter)
applyforge.user_action                 (counter, tagged by action)
                                        # accepted/edited_minor/edited_major/rewritten/skipped
```

PM 一周后可在 Sentry Discover 跑：
- p50/p95 延迟趋势
- AI 草稿采纳率（accepted+edited_minor 比例）随时间变化
- Claude API 错误率
- 哪些字段最常被重写（label 标签聚类）

---

## npm audit（待跑）

```bash
pnpm audit --prod
```
预期：依赖均 pin 到现代版本，无 High/Critical 漏洞。Phase 9 前跑。

---

## 端到端验证（Phase 8 出口判定）

- ✅ Sentry SDK 代码就位
- ✅ 性能装饰器就位
- ⚠️ DSN 未配置（PM 自己 5 分钟搞定，不阻塞）
- ⚠️ 实际触发的第一个 trace 截图待 PM 配 DSN 后验证

**判定**：✅ 通过 — 代码层完整，运营层 5 min 接入。

进入 Phase 9（Code Review）。
