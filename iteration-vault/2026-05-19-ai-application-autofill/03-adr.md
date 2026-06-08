# 03 · ADR — Architecture Decisions

> **生成日期**：2026-05-19
> **阶段**：Phase 3 · 自治模式
> **格式**：MADR-lite（Context / Decision / Consequences / Alternatives）
> **状态**：Accepted（自治模式下 Claude 决策，PM 关卡 2 时可推翻）

---

## ADR-001：Chrome Extension 框架选 WXT

### Context
PRD 选定 V1 不复用 anZong 改成"从零搭"。现代 Chrome MV3 框架两个主流：WXT 和 Plasmo。

### Decision
**选 WXT**（https://wxt.dev/）。

### Consequences
- ✅ Vite-based 热重载比 Plasmo 快 3-5 倍（重要：开发体验）
- ✅ TypeScript 一等公民、React 支持原生
- ✅ 跨浏览器 ready（Edge/Firefox 后续要做时无痛切）
- ✅ 2025 年 GitHub 上活跃度超过 Plasmo（13k vs 11k stars，commits/week 也更多）
- ✅ 文档清晰、社区中文资料更多
- ⚠️ 比 Plasmo 略新（2022 启动 vs Plasmo 2021），生态 slightly 小

### Alternatives Considered
- **Plasmo**：成熟度更高，但 webpack 慢且未来不确定（团队商业转型后维护节奏不稳）
- **裸 chrome.* API**：开发体验灾难，对单人 MVP 不值得

---

## ADR-002：嵌入模型用 OpenAI text-embedding-3-small

### Context
PRD 验收要求 RAG 召回 < 500ms。两条路：(a) 调 OpenAI Embedding API；(b) 浏览器内跑 transformers.js。

### Decision
**选 OpenAI `text-embedding-3-small`**（dim=1536，可降到 512 维省空间）。

### Consequences
- ✅ 极便宜：$0.02 / 1M tokens（一个用户全年项目档案 + Q&A 撑死 50K tokens = $0.001）
- ✅ 中英文双语原生支持
- ✅ 浏览器零负担（不需要下载 600MB 模型）
- ✅ 嵌入质量 SOTA
- ⚠️ 需要 OpenAI API key（PM 一开始抗拒，但 embedding 用量极小，加一个 key 可接受）
- ⚠️ 数据出本地（但只是嵌入查询时，且无敏感信息可推断）

### Alternatives Considered
- **transformers.js `Xenova/multilingual-e5-small`**：完全本地、零成本，但首次加载 ~120MB、首次嵌入慢（CPU 10-30s），UX 灾难
- **Voyage AI / Cohere**：质量好但额外 vendor，没必要
- **不嵌入，纯 BM25 关键词召回**：简单但召回质量差，违反"经验库越用越准"承诺

### Implementation Note
PM 需在设置里同时填 Anthropic API key + OpenAI API key。文案明确："OpenAI key 仅用于嵌入，不传输敏感内容"。

---

## ADR-003：向量存储用 IndexedDB + 纯 JS 余弦相似度

### Context
V1 估算数据量：1 个项目 5 份文档 ≈ 200 chunks；每月 10 次报名 × 12 字段 ≈ 120 个 Q&A chunk。**一年累积 ≤ 2000 chunks**。

### Decision
**纯 IndexedDB（Dexie.js 封装）+ 内存中 O(N) 余弦相似度**。

### Consequences
- ✅ 零额外依赖、零 WASM 加载、bundle 体积小
- ✅ < 5K chunks 时 O(N) 余弦实测 < 100ms
- ✅ 易调试、易备份导出
- ⚠️ 超过 10K chunks 时性能开始下降 — 但 PM 自用 1 年都到不了
- ⚠️ 没有近似最近邻（ANN）优化

### Alternatives Considered
- **LanceDB-web (WASM)**：专业但 +5MB WASM 加载、+API 复杂度。**Over-engineering for V1**
- **Pglite (Postgres + pgvector in WASM)**：超强但 +25MB，过度设计
- **Voy / VectorStore-js**：小众，社区弱

### Migration Path
若一年后 chunks > 10K：迁到 LanceDB-web（schema 兼容），改动局限在 1 个 retrieval service 文件。

---

## ADR-004：Q&A markdown 落盘用 chrome.downloads + 可选 File System Access API

### Context
PRD 要求每次报名生成 markdown 文件到本地。两种 API：(a) `chrome.downloads`（每次下载弹个文件）；(b) File System Access API（一次授权一个目录，后续直接写）。

### Decision
**默认 `chrome.downloads`**（每次报名结束触发下载，文件名规范化）；**可选启用 File System Access**（PM 在设置里勾选 "选定 Vault 目录" 后用 FSA，体验更顺）。

### Consequences
- ✅ chrome.downloads 是 MV3 标准 API、任何 Chrome 用户都能用
- ✅ FSA 可选：PM 若用 Obsidian，可直接选 Obsidian vault 路径，markdown 立即出现在笔记里
- ✅ 双路径覆盖不同用户偏好
- ⚠️ FSA 在 Chrome 86+ 才有（用户基本都满足）
- ⚠️ FSA 授权握手要一次性

### Alternatives Considered
- **仅 chrome.downloads**：体验差，每次报名一个下载提示
- **仅 FSA**：FSA 在某些受限环境不可用（如 Linux Snap）
- **不落盘，仅 IndexedDB**：违反 PRD "经验库 markdown 文件" 承诺

---

## ADR-005：API key 加密存储用 Web Crypto API + 用户主密码

### Context
PRD 要求 API key 加密存 `chrome.storage.local`。需要决定密钥派生方式。

### Decision
**用户首次启动时设置一个"主密码"** → PBKDF2 派生 AES-256-GCM key → 加密存储 Anthropic key 和 OpenAI key。每次浏览器启动后第一次用插件时，弹窗要求输入主密码（session 内缓存，关浏览器消失）。

### Consequences
- ✅ 不依赖任何外部服务
- ✅ 即使 chrome.storage.local 文件被偷，没主密码也解不开
- ✅ Web Crypto API 是浏览器原生，零依赖
- ⚠️ PM 必须记住主密码（PRD 里要写醒目提示）
- ⚠️ 每次浏览器启动要输一次（session cache 缓解）

### Alternatives Considered
- **不加密 / 明文存**：API key 一旦泄露 = 财务损失，不可接受
- **用 chrome.identity 关联 Google 账号派生 key**：依赖 Google 登录，对国内用户不友好
- **存系统 keychain**：MV3 没有这个 API

---

## ADR-006：字段识别策略 — 按需扫描 + Shadow DOM 穿透 + iframe 处理

### Context
表单不是页面加载时全部 ready，可能：(a) 动态渲染（React/Vue）；(b) 在 Shadow DOM 里；(c) 在 iframe 里（典型：Typeform、金数据嵌入）。

### Decision
**按需扫描**：PM 主动点"扫描页面字段"按钮时执行：
1. 用 `document.querySelectorAll` 抓 input/textarea/select
2. 递归遍历 `shadowRoot`（如有）
3. 遍历 same-origin iframe；cross-origin iframe 提示 PM "无法跨域识别"
4. 对每个字段提取：label / placeholder / maxlength / required / pattern / type / helper（via aria-describedby 或邻近 div）

**不用 MutationObserver 持续监听** — 性能开销 + 复杂度不值得 V1。

### Consequences
- ✅ 用户控制扫描时机，避免动态表单未加载完就扫描
- ✅ 性能开销可控
- ⚠️ 用户得记得点扫描按钮（UI 用醒目提示弥补）
- ⚠️ Cross-origin iframe 完全不支持（提示用户手动填）

### Alternatives Considered
- **页面加载完自动扫描**：动态表单失败率高
- **MutationObserver 实时跟**：复杂、卡 PM 主线程

---

## ADR-007：RAG 召回策略 — 项目档案 top-5 + Q&A 经验库 top-3 + 活动背景全量

### Context
PRD 要求草稿基于"项目档案 + 历史 Q&A 经验库 + 活动背景"。需定 top-K 和混合策略。

### Decision

**Chunking**：
- 项目档案：chunk_size=800 tokens, overlap=100, 按段落优先切（保留语义边界）
- Q&A markdown：1 个 Q&A 对 = 1 个 chunk（不再切）

**召回**：
- 对每个字段生成 query embedding（query = 字段 label + placeholder + helper text）
- 项目档案库召回 top-5（threshold cosine > 0.3）
- Q&A 历史库召回 top-3（threshold cosine > 0.4，更严，避免污染）
- 活动背景全量注入（结构化 JSON，不走 RAG）

**Prompt 结构**：
```
[System]
你是 PM 的活动报名助手。基于以下材料生成 ONE 个字段的答案。
必须遵守字段约束（特别是字数）。

[活动背景]
{event_context_json}

[项目档案 - top 5 chunks]
{project_chunks}

[历史 Q&A - top 3 chunks]
{qa_chunks}

[要填的字段]
Label: {label}
Placeholder: {placeholder}
约束: 字数 ≤ {maxlength}, 必填: {required}, 类型: {type}
Helper: {helper}

[要求]
直接给答案，不要解释。不要超过字数。
```

### Consequences
- ✅ Token 用量可控：单次填 1 字段 ≈ 4-5K input tokens
- ✅ Q&A 阈值严避免污染
- ✅ 活动背景作为强 anchor 影响所有字段
- ⚠️ Token 累计：一个 20 字段的表单生成完 ≈ 100K input tokens = Sonnet $0.30 / Haiku $0.08

### Alternatives Considered
- **不分层，全部混合 top-K**：易让 Q&A 历史压过项目档案
- **batch 一次性生成所有字段**：context 太长，质量下降

---

## ADR-008：错误降级策略 — 3 层 fallback

### Context
PRD edge case 要求 Claude API 失败时仍可用。

### Decision
**3 层降级**：

| 层 | 触发条件 | 行为 |
|----|---------|------|
| L1 | Sonnet 4.5 调用失败/超时（10s） | 自动降级 Haiku 3.5 重试 1 次 |
| L2 | Haiku 也失败 | 显示 "Claude API 不可用"，切换到"手动模式"：字段识别仍生效，PM 手填，仍能保存 Q&A markdown |
| L3 | 嵌入 API（OpenAI）失败 | 降级到 BM25 关键词召回（性能差但能用），警示 PM |

错误均上报 Sentry。

### Consequences
- ✅ 用户永远不会"完全用不了"
- ✅ Haiku 兜底既快又便宜
- ⚠️ L2 模式体验显著下降（但比插件挂掉好）

---

## ADR-009：Q&A 历史"污染剔除"机制

### Context
PRD R3 风险：AI 越用越烂，因为劣质 Q&A 也进了 RAG。

### Decision
**每条 Q&A 在 markdown 里有元数据**：
```yaml
quality_signal:
  user_action: accepted | edited_minor | edited_major | rewritten | excluded
  excluded_from_rag: false
```

**RAG 召回时排除 `excluded_from_rag: true`** 的条目。

**UI**：在历史列表里每条 Q&A 旁有 "❌ 不再参考" 按钮，一键标记 excluded。

### Consequences
- ✅ PM 主动控制经验库质量
- ✅ 删除按钮 → markdown 文件保留但 RAG 不召回
- ⚠️ 增加 PM 的认知负担（但低频操作）

### Alternatives Considered
- **自动评分剔除**：模型评分不稳，V1 不上
- **彻底删除**：丢历史，PM 不可逆

---

## 跨 ADR 总结：架构总览

```
┌─────────────────────────────────────────────────────────┐
│  Chrome Extension (WXT + React + TS + Tailwind)         │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Popup UI     │  │ Content      │  │ Side Panel   │ │
│  │ (项目管理)   │  │ Script (DOM) │  │ (主操作台)   │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                  │                  │         │
│         └──────────────────┴──────────────────┘         │
│                            │                            │
│              ┌─────────────▼──────────────┐             │
│              │ Service Worker (后台)      │             │
│              │  - Claude API client       │             │
│              │  - OpenAI Embedding        │             │
│              │  - Document Parser         │             │
│              │  - RAG Service             │             │
│              │  - Q&A Markdown Writer     │             │
│              └─────────────┬──────────────┘             │
│                            │                            │
│              ┌─────────────▼──────────────┐             │
│              │ Storage Layer              │             │
│              │  - IndexedDB (Dexie)       │             │
│              │    · projects              │             │
│              │    · documents + chunks    │             │
│              │    · qa_records + chunks   │             │
│              │    · event_contexts        │             │
│              │  - chrome.storage.local    │             │
│              │    · encrypted API keys    │             │
│              │    · user prefs            │             │
│              └────────────────────────────┘             │
└─────────────────────────────────────────────────────────┘

      外部依赖（仅在主动调用时出本地）
┌──────────────────────┐   ┌──────────────────────┐
│ Anthropic Claude API │   │ OpenAI Embedding API │
│ (Sonnet 4.5 + Haiku) │   │ (text-embedding-3-s) │
└──────────────────────┘   └──────────────────────┘
```

---

## 状态

✅ 9 个 ADR 全部 Accepted（自治模式决策）
✅ 无红线触发（无架构冲突、无破坏性变更）
✅ 进入 Phase 4：UI 设计 context
