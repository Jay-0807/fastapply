# 05 · Data Schema + API Contract

> **生成日期**：2026-05-19
> **阶段**：Phase 5 · 自治模式
> **基于**：ADR-003（IndexedDB + Dexie）、ADR-007（RAG 策略）

---

## 一、IndexedDB Schema（用 Dexie.js）

数据库名：`applyforge_v1`
版本：1

### Table: `projects`

| 字段 | 类型 | 索引 | 说明 |
|------|------|------|------|
| `id` | string (UUID) | PK | 项目唯一 ID |
| `name` | string | ✓ | 项目名（如"Firefly OS"） |
| `description` | string | - | 一句话描述 |
| `tags` | string[] | - | 标签（如 ["AI","B2B","电商"]） |
| `createdAt` | number (timestamp) | ✓ | 创建时间 |
| `updatedAt` | number (timestamp) | - | 最后修改时间 |
| `applicationCount` | number | - | 已用于报名的次数（统计） |

### Table: `documents`

| 字段 | 类型 | 索引 | 说明 |
|------|------|------|------|
| `id` | string (UUID) | PK | 文档 ID |
| `projectId` | string | ✓ FK | 所属项目 |
| `filename` | string | - | 原文件名 |
| `mimeType` | string | - | application/pdf, text/markdown, etc. |
| `sizeBytes` | number | - | 文件大小 |
| `rawText` | string | - | 解析后的纯文本 |
| `parseStatus` | enum | ✓ | `pending` / `parsed` / `failed` |
| `parseError` | string \| null | - | 解析失败时的错误信息 |
| `createdAt` | number | ✓ | - |

### Table: `chunks`

| 字段 | 类型 | 索引 | 说明 |
|------|------|------|------|
| `id` | string (UUID) | PK | chunk ID |
| `sourceType` | enum | ✓ | `document` / `qa` |
| `sourceId` | string | ✓ | document.id 或 qaRecord.id |
| `projectId` | string | ✓ FK | 隶属项目 |
| `text` | string | - | chunk 文本（800 tokens） |
| `embedding` | Float32Array | - | 1536 维（或 512 维降维） |
| `embeddingModel` | string | - | "text-embedding-3-small" |
| `tokenCount` | number | - | chunk 的 token 数 |
| `excludedFromRag` | boolean | ✓ | ADR-009 污染剔除标记 |
| `createdAt` | number | - | - |
| `metadata` | object | - | 额外元（如 chunk index、page number） |

**复合索引**：`[projectId, sourceType, excludedFromRag]` — 加速 RAG 召回过滤

### Table: `eventContexts`

| 字段 | 类型 | 索引 | 说明 |
|------|------|------|------|
| `id` | string (UUID) | PK | - |
| `name` | string | ✓ | 活动名 |
| `theme` | string | - | 主题 |
| `organizer` | string | - | 主办方 |
| `location` | string | - | 地点 |
| `url` | string | - | 报名链接 |
| `deadline` | string \| null | - | 截止时间（ISO 日期） |
| `extraNotes` | string | - | PM 自定义补充 |
| `pageMetaJson` | object | - | 抓取的 og: meta（用于推断重现） |
| `createdAt` | number | ✓ | - |

### Table: `qaRecords`

一份报名 = 一个 record。

| 字段 | 类型 | 索引 | 说明 |
|------|------|------|------|
| `id` | string (UUID) | PK | - |
| `projectId` | string | ✓ FK | - |
| `eventContextId` | string | ✓ FK | - |
| `status` | enum | ✓ | `in_progress` / `submitted` / `abandoned` |
| `qaPairs` | QAPair[] | - | 见下 |
| `markdownPath` | string \| null | - | 保存的 markdown 文件路径 |
| `submittedAt` | number \| null | ✓ | - |
| `pageUrl` | string | - | 报名页面 URL |
| `pageTitle` | string | - | 报名页 title |
| `stats` | object | - | { accepted: N, edited_minor: N, edited_major: N, rewritten: N, skipped: N } |
| `createdAt` | number | ✓ | - |

### Type: `QAPair`（嵌套在 qaRecords.qaPairs 数组里）

```ts
interface QAPair {
  fieldId: string;              // 页面字段唯一 ID（生成的）
  fieldLabel: string;           // 字段 label
  fieldType: string;            // input/textarea/select
  fieldConstraints: {
    maxLength?: number;
    required?: boolean;
    pattern?: string;
    helperText?: string;
    placeholder?: string;
  };
  aiDraft: string;              // AI 生成的草稿
  aiModel: 'sonnet-4.5' | 'haiku-3.5';
  finalValue: string;           // 用户最终采用的版本
  userAction: 'accepted' | 'edited_minor' | 'edited_major' | 'rewritten' | 'skipped';
  ragReferences: {
    chunkIds: string[];          // 哪些 chunk 被召回
    similarities: number[];      // 对应的余弦相似度
  };
  generatedAt: number;
  retryCount: number;            // 重生成次数
}
```

### Table: `appSettings`（单行）

存全局设置（API key 加密后存这里）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string = "singleton" | PK |
| `encryptedAnthropicKey` | string | base64(AES-GCM 密文) |
| `encryptedOpenAIKey` | string | base64(AES-GCM 密文) |
| `keyDerivationSalt` | string | base64 PBKDF2 salt |
| `keyDerivationIterations` | number | 600000 |
| `defaultModel` | enum | `sonnet-4.5` / `haiku-3.5` |
| `language` | enum | `zh-CN` / `en-US` |
| `theme` | enum | `light` / `dark` / `auto` |
| `vaultDirectory` | string \| null | FSA 选定的 Obsidian Vault 路径 |
| `embeddingProvider` | enum | `openai` / `local` |
| `embeddingDimension` | number | 1536 \| 512 |

---

## 二、内部 API 契约（Service Worker ↔ UI）

Service Worker 通过 `chrome.runtime.onMessage` 暴露内部 API。所有消息 typed。

### Message Bus 总览（OpenAPI-style 描述）

```yaml
# 内部消息总线（chrome.runtime.sendMessage）
openapi: 3.0.0
info:
  title: ApplyForge Internal Message Bus
  version: 1.0.0

paths:
  /projects.list:
    description: 列出所有项目
    response:
      type: array
      items: Project

  /projects.create:
    description: 创建新项目
    request: { name, description, tags }
    response: Project

  /projects.update:
    request: { id, patch: Partial<Project> }
    response: Project

  /projects.delete:
    request: { id }
    response: { ok: boolean }

  /documents.upload:
    description: 上传文档并触发解析+嵌入流水线
    request:
      projectId: string
      file: File (FormData)
    response:
      documentId: string
      status: 'pending'
    side_effects:
      - 触发后台 parse → chunk → embed 流水线
      - 流水线进度通过 chrome.runtime onMessage 推 `documents.parseProgress`

  /documents.list:
    request: { projectId }
    response: Document[]

  /documents.delete:
    request: { id }
    side_effects: 级联删除 chunks

  /events.detectFromPage:
    description: 从当前页面元数据推断活动背景
    request: { pageUrl, pageTitle, ogMeta }
    response: EventContext (草稿，PM 可修改)

  /events.save:
    request: EventContext
    response: EventContext

  /fields.scan:
    description: 触发 content script 扫描当前页面字段
    request: { tabId }
    response: Field[]

  /draft.generateOne:
    description: 为单个字段生成草稿（streaming）
    request:
      projectId
      eventContextId
      field: Field
      model: 'sonnet-4.5' | 'haiku-3.5'
    response: streaming string (text chunks)
    side_effects:
      - RAG 召回项目 chunks + Q&A chunks
      - 调用 Claude API
      - 校验字段约束（字数等），违反则 retry
      - 把 ragReferences 推给 UI

  /draft.generateAll:
    description: 批量为所有识别字段生成
    request: { projectId, eventContextId, fields: Field[], model }
    response: 流式 { fieldId, draft, ragRefs }

  /fields.fillPage:
    description: 把草稿写回页面（content script）
    request: { tabId, fillMap: { fieldId: value } }
    response: { filledCount, failedFields }

  /qaRecord.markSubmitted:
    description: PM 点"我已提交"，触发 markdown 落盘
    request: { qaRecordId }
    response:
      markdownPath: string
      ragChunksCreated: number

  /qa.toggleExclusion:
    description: 标记某 Q&A 为不再参与 RAG
    request: { qaRecordId, fieldId, excluded: boolean }
    response: { ok }

  /settings.unlock:
    description: 用主密码解锁 API key（session 内缓存）
    request: { masterPassword }
    response: { ok, keysAvailable: boolean }

  /settings.lock:
    description: 清除 session key 缓存
    response: { ok }

  /backup.export:
    description: 导出全量数据 ZIP
    response: Blob (zip with markdown + json)

  /backup.import:
    request: file (ZIP)
    response: { projectsImported, documentsImported, qaRecordsImported }
```

---

## 三、外部 API 契约（调用 Claude / OpenAI）

### Anthropic Claude

**Endpoint**：`https://api.anthropic.com/v1/messages`
**Model**：
- 默认：`claude-sonnet-4-5-20250929`
- 快速：`claude-haiku-4-5-20250901`（如可用，否则降级到 3.5）

**Request 模板**：
```ts
{
  model: "claude-sonnet-4-5-20250929",
  max_tokens: 2048,
  stream: true,
  system: SYSTEM_PROMPT_TEMPLATE,
  messages: [
    {
      role: "user",
      content: USER_PROMPT_TEMPLATE(field, event, ragChunks)
    }
  ],
  metadata: {
    user_id: "applyforge-local"  // 标记便于 Anthropic dashboard 看
  }
}
```

**Streaming 处理**：用 `@anthropic-ai/sdk` 的 stream helper。

### OpenAI Embedding

**Endpoint**：`https://api.openai.com/v1/embeddings`
**Model**：`text-embedding-3-small`
**Dimensions**：1536（可参数化降到 512）

**Request**：
```ts
{
  model: "text-embedding-3-small",
  input: ["chunk1 text", "chunk2 text", ...],  // 最多 2048 个
  dimensions: 1536
}
```

---

## 四、Q&A Markdown 文件格式

文件名规范：`<project-slug>-<event-slug>-<YYYY-MM-DD>.md`
位置：`<vaultDir|Downloads/applyforge>/<project-slug>/<filename>.md`

### 内容模板

```markdown
---
applyforge_version: 1.0
project: Firefly OS
project_id: 550e8400-e29b-41d4-a716-446655440000
event_id: 8400-550e-41d4-a716-446655440000
event_name: Devpost AI Agent Hackathon 2026
event_theme: AI Agent / Multi-agent
event_organizer: Devpost × Anthropic
event_location: Online (Global)
event_url: https://devpost.com/...
event_deadline: 2026-06-15
submitted_at: 2026-05-19T15:30:00+08:00
page_url: https://devpost.com/...
page_title: AI Agent Hackathon 2026 · Sign up
stats:
  total_fields: 12
  accepted: 6
  edited_minor: 3
  edited_major: 2
  rewritten: 1
  skipped: 0
quality_signal:
  default_excluded_from_rag: false
---

# Devpost AI Agent Hackathon 2026 · Firefly OS

## 活动背景

- **主题**：AI Agent / Multi-agent
- **主办方**：Devpost × Anthropic
- **地点**：Online (Global)
- **截止**：2026-06-15
- **链接**：https://devpost.com/...

---

## Q&A 全记录

### Q1: 项目名（required · maxlength 100）

**字段约束**：text input, maxlen 100, required, placeholder="Your project name"

**AI 草稿** (sonnet-4.5):
```
Firefly OS
```

**最终版本**：
```
Firefly OS
```

**修改幅度**：`accepted` ✅ 直接采纳
**RAG 参考**：
- project-overview.pdf (chunk #1, sim=0.91)

**用于训练**：是

---

### Q2: 一句话介绍 (required · maxlength 200)

**字段约束**：text input, maxlen 200, required

**AI 草稿** (sonnet-4.5):
```
Firefly OS 是为电商场景量身打造的多 Agent 操作系统，让 AI 像合伙人一样和你的电商团队协作。
```

**最终版本**：
```
Firefly OS：电商 AI 合伙人 — 多 Agent 编排，让 AI 真正分担选品/客服/分析的活。
```

**修改幅度**：`edited_major` 🔄 大幅重写
**RAG 参考**：
- bp-v3.docx (chunk #3, sim=0.88)
- 2026-04-15-startup-camp-application.md Q2 (sim=0.76)

**用于训练**：是

---

[...其他字段...]

---

## 本次报名学习摘要（自动生成）

- ✏️ 我倾向于把"操作系统"改写为"合伙人"这种拟人化表达
- ✏️ 我会主动加品类（"电商"）让定位更聚焦
- ✏️ 长文本字段我倾向 200 字内的紧凑表达，不要长篇

**这些信号已加入项目偏好风格库**，下次 AI 生成时会参考。
```

---

## 五、字段约束识别启发式（实施细节）

| 约束来源 | 抽取方式 | 优先级 |
|----------|----------|--------|
| `maxLength` | `el.maxLength`（HTML5 属性） | P0 |
| `required` | `el.required` 或父级 `*` 标记 | P0 |
| `pattern` | `el.pattern` (regex) | P1 |
| `type` | `el.type` | P0 |
| `label` | (a) `<label for=el.id>`, (b) `el.closest('label')`, (c) `aria-label`, (d) 父级文本节点启发 | P0 |
| `placeholder` | `el.placeholder` | P1 |
| `helperText` | (a) `aria-describedby` 关联的元素, (b) 紧邻的 `.helper-text` / `.form-help` / `.text-muted`, (c) 父级 footer | P1 |
| `字数提示` | 解析 helperText / placeholder 里的"≤ N 字"/"最多 N 字"/"N words max"/"max N characters" 正则 | P0 |

---

## 六、Schema lint / API lint 状态

- ✅ Dexie schema 自检：所有 FK 关系一致
- ✅ TypeScript types 派生：从 Dexie schema 自动生成（用 `dexie-react-hooks`）
- ⚠️ OpenAPI lint（Spectral）跳过：本项目是 Chrome Extension 内部消息总线，不是 HTTP API，OpenAPI 仅作文档

---

## 状态

✅ DB schema 7 张表 + 1 个嵌套 type 完整
✅ 内部 API 17 个消息端点定义清晰
✅ 外部 API（Claude + OpenAI）契约明确
✅ Q&A markdown 模板可直接用
✅ 字段约束识别启发式可指导 Phase 6 实施
✅ 进入 Phase 6：实施骨架
