# 01 Clarified Requirement — 结构化知识图谱

> 2026-06-24 · 🐢 重型 lane · 3 个 PM 决策已锁

## PM 决策（关卡前确认）

| # | 决策 | 选择 |
|---|---|---|
| 1 | 范围与节奏 | **一次性做完整重型**（数据层 + 图谱检索 + UI 一轮交付） |
| 2 | 本地项目数据形式 | **PM 直接丢文件**（PDF/Word/MD/TXT…）→ 走增强版文档解析 + LLM 结构化抽取 |
| 3 | 个人信息策略 | **建独立人员档案 + 自动回填本人真实信息**；AI 生成草稿仍绝不碰个人信息；OTP/验证码永不存不填；提交前人工确认闸保留 |

## 目标（可验证成功标准）

1. **人员图谱**：每个参赛人有独立档案（结构化个人信息 + 角色）；一次报名记录显式关联 `Person ↔ Event ↔ 该赛事里实际填写的字段答案`；下次类似赛事能按人/字段直接调取本人历史答案与个人信息。
2. **项目图谱**：项目有结构化事实（赛道/阶段/地点/团队/指标…），来自本地文件抽取 + 历史报名沉淀；每条历史报名记录明确带 **主办方 / 地点 / 主题 / 赛事类型** 标签。
3. **图谱感知检索**：草稿生成时，按"赛事相似度（主题/主办方/地点/类型）"召回最相似的历史报名，再按字段相似度调取历史答案；个人字段走人员档案确定性回填——取代现在"扁平 keyword 拉全量 chunk"。
4. **不丢数据 + 不破坏现有行为**：Dexie v7 迁移现有 projects/eventContexts/qaRecords/chunks 零丢失；备份导入导出含新表；默认行为对老用户无回归。

## 设计骨架（详见 02-PRD-delta / 04-architecture）

### 实体（图谱节点）
- **Person（新）**：`id, displayName, role, fields{ name/phone/email/wechat/idNumber/title/bio/… }, notes, isPii`
- **Project（增强）**：现有 + `facts{ sector/stage/location/teamSize/metrics/… }` + `memberIds[]`
- **EventContext（增强）**：现有 theme/organizer/location + `eventType（黑客松/创投/加速器/政策申报/路演…）` + `topicTags[]`
- **QARecord（增强）**：现有 + `personIds[]`（哪些人参与/用了谁的信息）

### 关系（图谱边）
`Person —memberOf→ Project` · `Project —appliedTo→ Event`（经 QARecord）· `Person —participatedIn→ Event` · `QARecord` 承载 (Person, Event, 字段答案) 三元关联

### 检索改造（`src/lib/rag/`）
新增 graph-aware 层：(project, currentEvent, field) →
1. 按属性相似度给历史 Event 打分（主题/主办方/类型/地点）
2. 从最相似 Event 的 QARecord 里按字段相似度调取历史答案（最高价值复用）
3. 个人字段 → 活动选定 Person 档案确定性回填（非 AI）
4. 项目结构化 facts 作高优先上下文
> 保留 keyword-overlap 作语料内排序（embeddings 仍按 ADR 延后）；"图谱"= 显式实体+关系+属性相似度遍历。

### 迁移（Dexie v7）
新增 `persons` 表；qaRecords 加 `personIds`；eventContexts 加 `eventType/topicTags`；projects 加 `facts/memberIds`。`upgrade()` 回填空值/最佳努力派生，零丢失。

### 个人信息回填（按决策 3）
fill 时 `sensitiveKind:'personal'` 不再一律跳过：若活动选定 Person 有匹配字段 → 确定性回填本人真实值；无匹配仍跳过标"请你自己填"。`otp` 永远跳过。AI 草稿生成永不碰个人字段。

### 本地文件结构化抽取（按决策 2）
PM 丢文件 → 复用 parsers + `callLLM` → 抽取项目 facts/人员候选 → 入图谱（人工确认后落库，不盲信 LLM）。

## 风险面（强制 GAN 覆盖）
- 数据迁移正确性（v6→v7，不丢老数据、幂等）
- PII 落盘 + 自动回填（只回填本人真实值、绝不 AI 编造、OTP 永不碰、本地不外发）
- 检索非退化（hybrid 图谱检索 ≥ 现有 keyword baseline，老用户无回归）

## 用户研究（轻量 · 复用现有画像）
主画像不变（创业团队 PM/创始人，非技术，每周 1-3 次报名）。本需求直击其 #1 痛点"重复填类似内容 + 每次翻 BP 找数据 + 个人信息每次手填"。新增隐含画像：**多成员团队**（不同赛事派不同人/不同人填联系人），故 Person 需多档案 + 报名时可选。
