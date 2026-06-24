# 10 Verification Report — 知识图谱 V0.4.0

> 2026-06-24 · 🐢 重型 lane 验收

## 五层验收

| 层 | 结果 |
|---|---|
| L1 契约 | 消息总线新增 persons.* / projectFacts.extract，背景 handler 全实现；类型贯通 |
| L2 红线 | lucide-only ✅；exactOptionalPropertyTypes ✅；PII 三红线落地（见下）✅ |
| L3 静态 | `pnpm compile` 0 错；`pnpm lint` 0 warning |
| L4 运行时 | `pnpm test` **160 通过**（基线 131 + 新增 29）；`pnpm build` 2.96 MB |
| L5 acceptance | 见下"需求映射" + 双路对抗 GAN |

## 需求映射（PM 三句话 → 交付）

1. "人员单独存 + 关联每次赛事填写信息 + 类似赛事直接调取" → `Person` 实体 + `QARecord.personIds` 边 + `retrieveGraphAware` 按赛事相似度调取历史答案 ✅
2. "项目信息：本地供给数据 + 历史记录标明主办方/地点/主题，新赛事快速调取" → `Project.facts`（文件 LLM 抽取 + 手填）+ QA 历史 chunk 显式带主办方/地点/主题/类型 + 图谱检索 ✅
3. "没有结构化知识图谱、调不到本地与历史数据" → 实体 + 关系 + 属性相似度遍历取代扁平 keyword ✅

## 对抗式 GAN（RISK 强制）

- **数据完整性/迁移/检索路** → PASS（实测 v7 零丢数据 + 幂等 + multiEntry + 非退化 + 备份原子）。
- **隐私/PII 路** → FAIL（1 critical：个人值经 QA 种子漏进未来 prompt）→ **修复**（`rag/qa-seed.ts` 种子边界过滤 + 5 回归测试）→ PASS。

## 新增测试（29）

- `db/schema.test.ts`：v7 迁移 4 条（facts/eventType/personIds 回填 + persons 表 + multiEntry 查询）
- `graph/event-similarity.test.ts` 8 · `graph/person-fields.test.ts` 9 · `rag/retrieval.test.ts` 3（含非退化）· `rag/qa-seed.test.ts` 5（PII 不入语料）

## 诚实边界

无 embeddings（属性相似度）；文件抽取需人工确认；真实表单回填准确度 / recall 真值留人工真机 dogfood；多人逐字段映射 MVP 用主联系人 + 回退；Chrome MCP 驱不动扩展 UI，UI 交互需 reload 真机点。
