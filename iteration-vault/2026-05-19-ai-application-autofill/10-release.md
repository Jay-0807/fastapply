# 10 · Release v0.1.0 — ApplyForge

> **生成日期**：2026-05-19
> **阶段**：Phase 10 · ⛳ PM 关卡 2
> **状态**：等待 PM 决策（Merge / Request changes / Hold）

---

## 本次 Release 内容

### 新增

#### 核心功能闭环
- **智能填表**：扫描页面字段 + Claude 生成草稿 + 一键填入
- **经验沉淀**：报名后自动生成 Q&A markdown，沉淀到本地文件 + RAG 向量库
- **活动背景驱动**：每次报名前确认活动主题/地点/主办方，让 AI 写出"针对性"内容

#### 关键差异化（vs Claude for Chrome 实测失败点）
- **字段约束完整识别**：支持中英文 "200 字以内" / "max 500 characters" / aria-describedby helper text / required 标记多源识别
- **本地优先**：所有数据 IndexedDB，仅 API 调用时数据出本地
- **PM 始终在 loop**：插件绝不自动提交

#### Chrome Extension 基础设施
- Manifest V3 + WXT 框架
- 4 个入口：Popup / Side Panel / Options / Content Script
- React 18 + TypeScript + Tailwind + shadcn/ui 风格

#### 数据 / 安全
- IndexedDB (Dexie) 7 张表：projects / documents / chunks / eventContexts / qaRecords / appSettings + Q&A 嵌套类型
- API key 加密：PBKDF2 600K 迭代 + AES-256-GCM + 主密码 session 缓存
- 主密码永不落盘

#### AI 集成
- Anthropic Claude Sonnet 4.5（默认） + Haiku 3.5（fallback）
- OpenAI text-embedding-3-small（512/1536 维向量化）
- Streaming UI + 字数约束 retry + 3 层降级（Sonnet → Haiku → 手动模式）

#### RAG
- 项目档案（top-5）+ Q&A 历史（top-3，更严阈值避免污染）混合召回
- 活动背景作为强 anchor 注入所有 prompt
- ADR-009 污染剔除机制（单字段 `excludedFromRag` 开关）

#### 可观测性
- Sentry 浏览器 SDK 就位（PII scrub + redact + 性能 metrics）
- `measureAsync` 装饰器
- 关键指标：field_scan / doc_parse / embedding / rag_retrieval / claude_call duration + 用户 action 分类

---

### 文档（iteration-vault/）

10 个 phase 文档：
```
01-canonical-query.md      # 需求澄清
02-prd.md                  # PRD（⛳ 关卡 1 已通过）
03-adr.md                  # 9 个架构决策
04-ui-context.md           # UI Flow 描述
05-schema-and-api.md       # DB schema + 内部消息总线
06-implement-log.md        # 实施记录
07-test.md                 # 测试计划
07-debt.md                 # 9 维代码债（Must-fix 0）
07-security.md             # OWASP + LLM Top10 安全审查（Must-fix 0）
08-perf-obs.md             # 性能 + Sentry 接入
09-review.md               # 代码审查
10-release.md              # 本文档
autonomous-decisions.md    # 自治期决策日志
```

---

## 代码统计

- TS/TSX 文件：**20 个**
- 测试文件：**2 个**（13 个用例，含 field-scanner 核心差异化的 7 个用例）
- 代码行数：约 **2000 行**

---

## 已知风险（PM 审 release 时知悉）

| Risk | 严重度 | 应对 |
|------|--------|------|
| Sentry DSN 未配置 | 低 | PM 5 分钟在 dashboard 创建 + 填 .env |
| Backup/Import 未实现 | 低 | 自用 V1 不阻塞；follow-up 一周内补 |
| 仅 field-scanner / db 有单测 | 中 | crypto / rag / claude 单测列入 V1 发版前补 |
| E2E 0 用例 | 中 | Phase 7 已写 3 个 E2E 设计，发版前补 |
| anZong/AutoFillForm 未参考实现 | 低 | 我们选了从零搭，所以无 License 风险 |
| 真实 5 平台兼容性未测 | 高 | **PM 必须在发版前手动跑 5 个真实平台** |

---

## 测试覆盖

| 类别 | 用例数 | 通过 |
|------|--------|------|
| field-scanner unit | 7 | ✅ 全过 |
| db schema unit | 2 | ✅ 全过 |
| E2E happy path | 0 | ⏳ 发版前补 |
| 真实平台兼容性 | 0/5 | ⏳ PM 手动验证 |

---

## V1 发版前必做（PM merge 前确认）

- [ ] 跑 `pnpm install && pnpm compile` 编译通过
- [ ] 跑 `pnpm test` 单元测试全过
- [ ] 跑 `pnpm build` 产出 dist
- [ ] Chrome unpacked 加载 + Onboarding 流程跑通
- [ ] 在 ≥ 2 个真实平台（建议金数据 + Devpost）实测填一次表
- [ ] Sentry DSN 配置 + 故意触发一次错误验证仪表盘收到

---

## 后续 (follow-up commits，1 周内)

按优先级：

**P0（V1 发版前）**
- [ ] 补 crypto / rag / qa-writer 单测覆盖到 80%
- [ ] 补 3 个 E2E happy path（onboarding / 文档上传 / 完整填表）
- [ ] documents 解析失败 UI 通知 toast
- [ ] documents parse failure 状态广播
- [ ] secure-storage ciphertext::iv 改 JSON 结构（07-security.md Should-fix #1）

**P1（V1.1）**
- [ ] Backup / Import 完整实现（jszip + Dexie dump）
- [ ] HistoryPane 详情页 + 单字段 RAG 排除按钮 UI
- [ ] SettingsPane 修改 API key 完整流程
- [ ] README + onboarding 截图

**P2（V1.2 / V2）**
- [ ] i18next 中英文切换
- [ ] Prompt injection sanitize 层
- [ ] AI 草稿信心度（基于 RAG 相似度）显示
- [ ] 敏感词检测 + 上传前确认
- [ ] AI 草稿的 levenshtein 改 token-level
- [ ] V2 考虑切到 nanobrowser 底座 + 多 LLM 支持 + 云端同步

---

## ⛳ PM 关卡 2

请你看完上面内容 + 浏览以下文件后决策：
- `iteration-vault/2026-05-19-ai-application-autofill/02-prd.md`（PRD，看实施有没有偏离）
- `iteration-vault/2026-05-19-ai-application-autofill/autonomous-decisions.md`（自治期 8 个关键决策）
- `iteration-vault/2026-05-19-ai-application-autofill/09-review.md`（代码审查结果）
- `src/lib/fields/field-scanner.ts`（核心差异化模块，看实现是否符合预期）

PM 选项：
- ✅ Approve — 进入发版前必做清单（5 项），然后 v0.1.0 ship
- 🔄 Request Changes — 描述具体哪里改
- ❌ Hold — 暂时不发，描述阻塞点

> 注意：这是自用版（不上 Chrome Web Store），所以"发版"= PM 自己装 unpacked 用。没有 release-please 自动 PR，本文档即 release notes。
