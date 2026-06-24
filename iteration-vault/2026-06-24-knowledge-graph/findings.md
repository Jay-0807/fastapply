# 深档案 — 结构化知识图谱（人员 + 项目 + 赛事关联检索）V0.4.0

> 2026-06-24 · universal-coding-project-development-skill v5 · 🐢 重型 lane（L + RISK：数据完整性 + PII）
> 单一权威源：耐久铁律看 `CLAUDE.md`，产品真相看 `docs/PRD.md §6/§9/§10`，本文件只记**过程 + 对抗审查发现**。

## 一句话

把"扁平 chunk + keyword 检索"升级为"**实体 + 关系 + 图谱感知检索**"：新增 Person 实体、项目结构化 facts、赛事相似度调取历史答案、个人信息确定性回填。Dexie v6→v7 零丢数据。160 测试、build 2.96 MB。

## 三个 PM 决策（关卡前确认）

| # | 决策 | 选择 |
|---|---|---|
| 范围 | 一次性 vs 分阶段 | **一次性完整重型** |
| 本地数据 | 文件/表格/现有文档 | **PM 直接丢文件** → 解析 + LLM 结构化抽取 |
| 个人信息 | 反转 G5 `noAiFill` 的边界 | **建人员档案 + 自动回填本人真实信息**；AI 永不代写个人信息；OTP 永不存不填；提交前人工核对 |

## 交付清单

- **数据层**：`Person` 实体 + `persons` 表；`Project.facts/memberIds`、`EventContext.eventType/topicTags`、`QARecord.personIds`。Dexie **v7 迁移**（幂等回填、零丢老数据、`*personIds` multiEntry 索引）。
- **图谱检索** `rag/retrieval.ts`：`retrieveGraphAware` —— QA 答案按"赛事相似度（主题/主办方/类型/地点）"重排，keyword 仍为主项（0.7 vs 0.3，保证非退化）；文档检索字节不变。`graph/event-similarity.ts` 提供 `deriveEventType/deriveTopicTags/scoreEventSimilarity`。
- **个人信息回填** `graph/person-fields.ts`：`mapLabelToPersonFieldKey` + `resolvePersonalFills`（只回填本人已存真实值，OTP 永不碰，无匹配则留手填）。sidepanel `fillPage` 合并、写回 qaPairs + 标记。
- **项目 facts 注入** `prompts.ts`：`formatProjectFacts` 高优先块（空 facts → 空串，老项目 prompt 字节不变）。
- **结构化抽取** `background.extractProjectFactsFromText`：丢文件 → LLM 抽 facts + 人员候选 → **返回候选，UI 确认后才入库**（不盲信）。
- **UI**：Options「人员档案」tab（CRUD + 从文件导入）；sidepanel `PersonPicker`（勾选参与人 + 主联系人）；FieldCard 个人字段回填后显示绿色"已回填请核对"。
- **备份**：export/import 含 `persons`（formatVersion 2，兼容 v1 老备份）。

## 对抗式 GAN（本档案核心价值 —— 别处不留）

两路独立 reviewer，diverse lens（数据完整性/迁移/检索 vs 隐私/PII）。

### 数据完整性 GAN → **PASS**
实测验证（真 Dexie 4 + fake-indexeddb 一次性探针）：
- v7 `.stores()` 只重定义变更表、未重定义的 projects/documents/chunks **不会被 Dexie 丢弃**（carry-forward 规则确认）；row 数 + Float32Array embedding 全存活。
- `*personIds` multiEntry 在 upgrade 内回填 `[]` 后建索引 **不抛不损**；`where('personIds').equals()` 可查。
- 迁移**幂等**（`=== undefined` 守卫；二次开库不重跑 modify）。
- `retrieveGraphAware` 文档结果与 baseline **字节一致**；无事件元信息时 QA 排序**塌回 keyword baseline**；bulkGet 的 undefined 已过滤（删了 qaRecord 的孤儿 chunk → sim=0 不崩）。
- 备份 import 单事务原子：坏备份抛错会**回滚 clear**，不会把用户库清空。

### 隐私/PII GAN → **FAIL（1 critical）→ 修复后 PASS**
**致命发现（真 bug，端到端验证）**：个人字段自动回填的真实值写进 `qaPairs[].finalValue` → `markRecordSubmitted` **无差别**把所有 qaPairs 种进 RAG chunk（`excludedFromRag:false`）→ 这些 chunk 成为**未来所有草稿生成**的"历史 Q&A"上下文 → **用户真实手机/邮箱/身份证泄露进未来 LLM prompt**。违反契约"个人信息绝不发给草稿生成器"。
- **修复**（在种子边界，GAN 给的精确位置）：新增 `rag/qa-seed.ts` `isSeedableQaPair`，`markRecordSubmitted` 过滤掉 `noAiFill`/`sensitiveKind` 的 QA 对，**绝不入 RAG 语料**（仍留在 QARecord + 本地 markdown）。5 条回归测试锁定。
- 其余 PASS：`resolvePersonalFills` 不碰 OTP、不编造、非个人字段不进；无 Person 对象被直塞 prompt；`extractProjectFactsFromText` 与既有 `detectEventFromPage` 外发姿态一致且只返回候选不落库。

> 教训（沉淀）：**新增"存 PII + 回填"功能时，PII 的扩散面不止填充点——任何把 finalValue 二次持久化/索引的下游（RAG 种子、缓存、日志）都要在边界上挡。** 与 V0.3.0「相邻 contenteditable PII 泄露」同源：隐私边界要守的是**数据流的每一跳**，不是单点。

## 诚实边界（不可越界）

- 检索按**结构化属性相似度**，不引入 embeddings（保持 ADR-003 本地无后端姿态）；keyword-overlap 仍是底层排序。
- 本地文件抽取**需人工确认**（不盲签 LLM 输出）。
- 个人信息**只回填本人已存真实值**，AI 永不代写，OTP 永不存不填，提交前人工复核闸保留。
- **真实表单 recall / 回填准确度真值留人工真机 dogfood**（与 V2.3-V2.8 / V0.3.0 一致）：本轮验证了 compile/lint/160 测试/build + 双路对抗 GAN；UI 交互需 reload 扩展真机点。
- 多人表单的"队员1/队员2"逐字段映射**未做**（MVP 用主联系人 + 回退；未命中留手填）。

## 验收闸
`pnpm compile` 0 · `pnpm lint` 0 warning · `pnpm test` **160**（基线 131 + 新增 29）· `pnpm build` 2.96 MB · 双路 GAN PASS（隐私路修复后）。
