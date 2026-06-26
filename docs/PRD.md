# ApplyForge — 产品需求文档（PRD）

> **代号**：ApplyForge — "锻造你的每一次申报"
> **当前版本**：v0.4.2（项目删除级联 + 一键多格式 AI 导入 + 人员/经验库按项目归属 · 2026-06-26）
> **文档版本**：PRD r15（r14 + §9 加 V0.4.2 项目管理/一键导入/按项目归属条目 · 2026-06-26）
> **PM**：jayyangstudy@gmail.com
> **状态**：✅ 已开发，迭代中
> **代码仓库**：`D:\cursor_project\projects\project_application_google_chrome_extension\`

---

## 0. 文档导读

本文档是 ApplyForge 项目的**单一权威 PRD**，合并了：

- 2026-05-19 V1 初版 PRD（`iteration-vault/2026-05-19-ai-application-autofill/02-prd.md`）
- 2026-05-23 V2 UX 优化迭代（`iteration-vault/2026-05-23-ux-optimization/`）
- 2026-05-24 V2.1 多 Provider 接入（in-progress vault — 后续归档）
- 2026-05-24 V2.2 配置库重写
- 2026-05-30 V2.3 真实表单 dogfood 加固（手写中文表单 / native 单复选 / 自定义上传字段；`iteration-vault/2026-05-30-real-form-dogfood/findings.md`）

PRD 覆盖：**价值 → 用户 → 旅程 → 功能 → 数据 → 架构 → 非功能性需求 → 迭代历史 → 不在范围 → 风险**。

---

## 1. 产品概览

### 一句话价值

> **把每次活动报名从 1-2 小时降到 10-15 分钟，并让 AI 通过 Q&A 历史库越用越懂你的项目和申报风格。**

### 形态

Chrome MV3 扩展。三入口：

- **Popup**：图标点出来的小弹窗（项目快速预览）
- **Side Panel**：报名时的主工作面板（事件确认 → AI 草稿 → 一键填入）
- **Options Page**：项目档案 + 经验库 + 设置 + 备份的全屏管理后台

### 部署模式

**V1 自托管**（不上 Chrome Web Store）：

- 用户从 GitHub 拉源码 → `pnpm install && pnpm build` → load unpacked
- 所有数据本地（IndexedDB）—— 不上传任何服务器
- API key 加密存储（PBKDF2 + AES-GCM），主密码用户自管

### 业务边界

- ✅ **做**：把已收集的项目档案 + AI 推理 + 历史经验，自动写入表单字段
- ❌ **不做**：替用户最终点提交 / 上传文件到服务器 / 跨设备同步 / 多用户协作 / 移动端

---

## 2. 目标用户

### 主画像（V1 锁定）

| 维度 | 描述 |
|---|---|
| 角色 | 创业团队 PM / 创始人 / 业务负责人 |
| 技术背景 | **非技术**（不会改代码，能装扩展，能输入 API key） |
| 高频场景 | 黑客松报名、创投活动报名、加速器申请、政策申报、路演报名、课程报名 |
| 报名密度 | 每周 1-3 次 |
| 每次报名平均字段数 | 10-30 个，其中 5-15 个是 200-500 字长文本 |
| 痛点 | 重复填类似内容；每个表单要"翻一遍 BP 找数据"；不同主办方主题不同要重写 |

### 次画像（V1.5+ 考虑）

- 创投/投资机构投后 BD（代多个项目报名）
- 高校创业导师（代学生项目）
- 政策申报代理（代客户报名）

### 反画像（明确不优化的场景）

- 求职填简历（用 LinkedIn 现成方案）
- 一般在线表单（用 Chrome 自带 autofill）
- 单字段秒填（Claude for Chrome 已经够好了，本产品聚焦长内容 + 复杂约束）

---

## 3. 核心用户旅程

### 端到端 12 步（首次使用）

```
① 装载插件
   chrome://extensions → 开发者模式 → Load unpacked → 选 .output/chrome-mv3

② 首次 Onboarding（Options 自动弹出）
   设主密码（≥ 8 位）→ 选 Provider（默认 Anthropic）→ 选 model → 输 API Key → 保存

③ 建第一个项目档案（Options · 项目档案）
   "新建项目" → 起名 / 一句话描述 → 上传 3 份 PDF/DOCX/MD/TXT 文档（BP、产品介绍、技术架构图）
   插件后台解析 + 切块（< 2 分钟）

④ 上传项目资产（同页 · 项目档案）
   切换"项目资产"标签 → 上传项目照片（.png/.jpg）/ Logo / Pitch Deck（.pdf/.pptx）
   这些会在表单遇到 file 字段时自动匹配填入

⑤ 浏览到一个报名页（如 Devpost / Qualtrics / Google Forms / 国内创投表单）

⑥ 点扩展图标 → 打开 Side Panel
   "选择本次报名的项目" → 选刚才建的项目 → "下一步 →"

⑦ 事件信息确认（Side Panel · 第 2 步）
   插件 AI 已读取页面正文（前 8000 字），自动填了活动名/主题/主办方/地点/链接
   顶部色带显示置信度：🟢/🟡/🟠/🔴
   每个字段右侧"? 猜测"/"— 未识别"标记
   PM 改不准的字段 + 选填"补充说明"

⑧ "✅ 确认，开始扫描字段"
   插件扫描页面 DOM（含 ARIA radio 组 / **native `<input type=radio/checkbox>`** / **手写中文表单纯文本节点标签** / Shadow DOM / 文件拖拽区 / Qualtrics 隐藏 file input / **无 file-input 的自定义 JS 上传字段**）
   返回 N 个字段，每个带 provenance（来源/可见性/标签置信度/maxLength 模式）

⑨ "AI 生成全部草稿"
   按字段类型分流：
     · 文本类（text/textarea/email/url 等）→ 3 字段一批走 batch
     · 选择类（radio/checkbox/select）→ 单字段串行
     · 文件类 → 跳过（用项目资产匹配）；无 `<input type=file>` 的自定义 JS 上传字段标 `manualUploadOnly`，显示"需手动上传"卡 + 一键下载匹配资产（浏览器安全限制无法真·自动上传）
   8 秒间隔串行，自动 429 backoff
   每个字段实时显示状态：⏳ 排队 → ✏️ 生成中 → ✅ 完成 / ❌ 失败

⑩ Review + 调整
   PM 看 N 个草稿
   文件字段卡片显示"自动匹配资产：📷 项目照片.jpg"，可下拉换别的
   不满意单字段点"🔄 重生成"
   字段卡片右上角"ⓘ 为什么扫到这个字段？"可点开看 selector/label 来源

⑪ "🎯 一键填入页面"
   插件把所有 finalValue 写到对应 DOM（React-form-compatible 设置器 + DataTransfer API）
   底部 toast 显示"✅ 已填入 N / 总数"
   PM 在浏览器里检查 + 补漏（部分字段可能因 UI 库太特殊没写进，会显示"⚠ 填入失败"）

⑫ PM 在浏览器里点真正的"Submit"
   回 Side Panel 点"✅ 我已提交，沉淀经验"
   插件保存 QA 记录 + 下载 markdown 到本地（applyforge/{项目}/{活动}.md）
   QA 切块后入 IndexedDB，作为下次类似字段的 RAG 上下文
```

### 第 N 次使用旅程（已沉淀经验）

跳过 ②③④，从 ⑤ 开始。第 ⑨ 步生成草稿时，RAG 不仅检索项目文档，**也检索 history Q&A**（最相关 2 条），AI 会模仿你之前的回答风格 + 复用具体表达。

### 跨 Provider 切换旅程（V2.2 新）

```
打开 Options · 设置
  顶部"添加新模型"表单：
    Provider 下拉选 DeepSeek
    Model 下拉选 deepseek-chat
    输入 DeepSeek API Key
    输主密码
    "添加为默认"
  底部"已接入的模型"列表多出一条 DeepSeek · deepseek-chat（绿色 ● 当前默认）
  原来的 Anthropic 那条仍然在列表里，可点切回

回到 Side Panel
  chip 显示 "DeepSeek · deepseek-chat ▾"
  点开 → 看到所有 config，可临时切回 Anthropic 试一次
  本会话用 DeepSeek，下次重开 sidepanel 还是用 DeepSeek（已存 tabSession）
```

---

## 4. 功能清单

### 4.1 项目档案管理（Options · 项目档案 tab）

| 子功能 | 描述 | 状态 |
|---|---|---|
| 项目 CRUD | 创建 / 编辑 / 删除项目（name / description / tags） | ✅ V1 |
| 文档上传 | 多文件 .pdf / .docx / .md / .txt；后台解析 + 切块 + RAG 索引 | ✅ V1 |
| 文档管理 | 列表展示；重试解析（❌ → ↻）；删除（含 chunks 级联） | ✅ V1 |
| 资产上传 | 多文件二进制（.png / .jpg / .webp / .pdf / .pptx）；用户标记类别（photo / logo / pitch） | ✅ V1 |
| 资产管理 | 列表展示；删除；类别筛选 | ✅ V1 |
| 资产-字段匹配 | 扫到 file 字段后调用 AI 推断哪个资产匹配哪个字段 | ✅ V1 |

### 4.2 报名工作流（Side Panel）

| 子功能 | 描述 | 状态 |
|---|---|---|
| 步骤 1：选项目 | 列出所有项目；下拉选；记忆最近选的 | ✅ V1 |
| 步骤 2：事件信息检测 + 编辑 | AI 从页面正文抽取（claude / openai-compat）+ meta 兜底；置信度色带；字段来源徽章 | ✅ V2 |
| 步骤 3：字段扫描 | 扫页面（含 ARIA / Shadow DOM / 拖拽区）；带 provenance；按需展示 FieldExplainer | ✅ V2 |
| 草稿生成（全部） | 文本字段批量（3 个/批），选择类单字段；8 秒间隔；429 自动等 60s 重试 | ✅ V2 + V2.1 |
| 草稿生成（单字段） | "🔄 重生成"按钮；走老的 per-field 路径，避免 batch quality 问题 | ✅ V1 |
| 草稿编辑 | textarea 直接改；字数显示；超 maxLength 标红 | ✅ V1 |
| 一键填入页面 | React-form-compatible setter；DataTransfer 给 file input；逐字段状态显示 | ✅ V1 |
| 资产手动覆盖 | 文件字段卡片可下拉换其他资产 | ✅ V1 |
| AI 配置临时切换 | sidepanel chip 弹出 LLMConfig 列表；选一个 → 本会话使用；不改全局默认 | ✅ V2.2 |
| 提交沉淀经验 | 写 QARecord + 下载 markdown + 切块入 RAG | ✅ V1 |

### 4.3 经验库（Options · 经验库 tab）

| 子功能 | 描述 | 状态 |
|---|---|---|
| 历史列表 | 按时间倒序；显示活动名 / 提交时间 / 采纳率 / 字段数 | ✅ V1 |
| 删除记录 | 单条删（含 chunks 级联） | ✅ V2 |
| Markdown 下载 | 提交时自动下载到 `applyforge/{项目 slug}/{活动 slug}-{时间}.md` | ✅ V1 |
| RAG 反哺 | 每条 QA pair 切块后入 chunks 表，sourceType='qa'，下次生成时检索最相关 2 条 | ✅ V1 |

### 4.4 设置（Options · 设置 tab — V2.2 重写）

| 子功能 | 描述 | 状态 |
|---|---|---|
| 主密码 | 至少 8 位；PBKDF2-derived AES key；session 缓存（chrome.storage.session） | ✅ V1 |
| Onboarding | 首次进入引导加 1 个 LLMConfig | ✅ V2.2 |
| 添加 LLMConfig | Provider 预设下拉 → Model 下拉（跟 Provider 变）→ API Key + 显隐 → 主密码 → 一键"添加为默认" | ✅ V2.2 |
| LLMConfig 列表 | 已接入的所有配置；点行体设为默认；▶ 展开看细节；🗑 删除 | ✅ V2.2 |
| Provider 预设 | Anthropic / OpenAI / DeepSeek / Moonshot / 智谱 / 豆包 / 通义 / Custom（共 8 种） | ✅ V2.2 |
| 自定义 baseURL | Custom Provider 时显示 baseURL 输入框；兼容任何 OpenAI 协议端点 | ✅ V2.2 |
| 模型选择 | 每个 Provider 自带推荐模型列表 + "自定义" 输入任意 ID | ✅ V2.2 |
| 获取 API Key 链接 | 每个 Provider 自带 console 链接（点击新 tab 打开） | ✅ V2.2 |

### 4.5 备份（Options · 备份 tab）

| 子功能 | 描述 | 状态 |
|---|---|---|
| 导出 | 全表导出（projects + documents + chunks + eventContexts + qaRecords + projectAssets + appSettings）为 JSON；资产 blob 转 base64；下载 | ✅ V2 |
| 导入 | 二次确认（覆盖现有所有数据）→ 解析 JSON → 事务清空 + 恢复 | ✅ V2 |

### 4.6 跨模块 UX 改造（V2 优化迭代）

| 子功能 | 描述 | 状态 |
|---|---|---|
| AsyncButton 组件 | idle/busy/done/error 四态 + 内置超时 + 冷却 | ✅ V2 |
| ErrorToast 系统 | 非阻塞底部 toast 队列；error/warning/info/success 四级；自动消失 | ✅ V2 |
| FieldExplainer | 每个字段右上角"ⓘ 为什么扫到这个字段？"折叠面板 | ✅ V2 |
| ExtractionConfidenceBanner | 事件信息上方 🟢🟡🟠🔴 置信度色带 | ✅ V2 |
| FieldOriginBadge | 事件字段右侧"? 猜测"/"— 未识别"小标 | ✅ V2 |
| 状态持久化 (tabSession) | step / eventDraft / fields / qaPairs / assetMatches / configId 都用 `chrome.storage.session` 保住 sidepanel 重开 | ✅ V2 |
| sessionKey unlock race 修复 | SW 重启后 sessionReadyPromise await 闸 | ✅ V2 |

### 4.7 人员档案 + 知识图谱（Options · 人员档案 tab — V0.4.0）

| 子功能 | 描述 | 状态 |
|---|---|---|
| 人员 CRUD | 独立存每个参赛 / 联系人的真实个人信息（姓名 / 手机 / 邮箱 / 微信 / 身份证 / 职位 / 单位 / 简介…）+ 角色 + 备注 | ✅ V0.4.0 |
| 从文件结构化导入 | 丢 BP / 团队介绍 → LLM 抽取项目 facts + 人员候选 → 人工确认后入库（不盲信） | ✅ V0.4.0 |
| 项目结构化信息 | `Project.facts`（赛道 / 阶段 / 地点 / 指标 / 技术栈…），草稿生成时作高优先上下文；可手填或抽取 | ✅ V0.4.0 |
| 报名时选参与人员 | sidepanel 第 1 步勾选本次参与人员 + 主联系人 | ✅ V0.4.0 |
| 个人信息自动回填 | 个人字段从选定 Person 档案**确定性回填本人真实值**（AI 不代写、OTP 不碰、提交前核对） | ✅ V0.4.0 |
| 赛事相似度调取历史 | `retrieveGraphAware` 按主题 / 主办方 / 类型 / 地点找相似历史赛事的答案优先复用 | ✅ V0.4.0 |

---

## 5. 字段扫描器（核心差异化）

这是产品的**核心技术差异化**。Claude for Chrome 的文档失败模式就是 "看不见字段约束"。本扫描器把约束信息完整提取出来给 LLM。

### 扫描能力

| 能力 | 覆盖 |
|---|---|
| 标准 HTML 表单元素 | `<input>` / `<textarea>` / `<select>`（含所有 type） |
| ARIA 单选/复选/列表组 | `[role="radio"]` / `[role="checkbox"]` / `[role="listbox"] [role="option"]` — Google Forms 等用 styled div 渲染的控件 |
| **native 单选/复选组**（V2.3）| 原生 `<input type=radio/checkbox>` 按最近 row/fieldset 容器分组（不靠 `name`）；填充走 `.checked` — 手写中文表单（gov/创赛/孵化器/高校）主流形态 |
| **按钮组单/复选**（V2.5）| styled `<button>` / `[role=button]` 当选择控件（无 input、无 `role`、选中态靠 CSS class）；`collectButtonChoiceGroups` 检出、点击匹配按钮填充；排除 nav/工具栏/动作按钮防误判 |
| 文件拖拽区识别 | 拖拽容器 heuristic + 隐藏 `<input type="file">` 双路径 |
| **自定义 JS 上传字段**（V2.3）| 无 `<input type=file>`、靠 `<a>上传</a>` + OS 弹窗的上传控件 → 检出并标 `manualUploadOnly`，辅助下载匹配资产（OS 文件弹窗浏览器安全无法程序化，不能真·自动上传）|
| Shadow DOM 递归 | 深度上限 5 + 节点预算 1000 — 覆盖 LWC / Shoelace / Web Components |
| 同源 iframe | `iframe.contentDocument` 递归扫描 |
| 标签提取（多源） | `<label for=>` / `aria-label` / `aria-labelledby` / 相邻文本 / **扁平容器纯文本节点行标签（`form-row` 等，V2.3）** / placeholder / 父级 question heading（带置信度） |
| 字段约束 | `maxLength` 属性 + 17 种正则模式提取（"约 200 字"、"控制在 500 字"、"≤ 1000 字"、"约 200 words" 等） |
| 必填检测 | `required` 属性 + 标签末尾 `*` / "必填" / "必须" / "(required)" |
| Helper text | `aria-describedby` / 相邻 `.help/.hint` 类 / `<small>` / `.text-muted` |
| 字段类型推断 | text / textarea / select / radio / checkbox / number / email / url / tel / date / file / unknown |

### 反过度抓取保护

| 机制 | 防的是 |
|---|---|
| 编辑器 URL 黑名单 | Google Forms `/edit` / Qualtrics `edit-survey` / Tally `/edit` / Jotform `/build` / 问卷星 `/newwjx` |
| Admin 标签 denylist | 19 个中英文模式（"问题编号" / "默认分值" / "Field Label" 等） |
| 可见性检查 | `display:none` / `visibility:hidden` / `opacity:0` 一律拒；尺寸 < 1×1 拒（保留 0×0 file input 当 layout-zero-but-include） |
| ARIA group 静默跳过 | 没 label 的 group 跳过，但 provenance 记录原因 |

### Provenance 自证

每个 DetectedField 带：
- `source`: html-input / aria-group / shadow-dom / drop-zone
- `selector`: 写回用的 CSS selector
- `visibilityState`: visible / layout-zero-but-include / hidden-skipped
- `labelSource`: aria-label / aria-labelledby / parent-heading / placeholder / label-tag / sibling-text / inferred
- `labelConfidence`: exact / inferred / fallback
- `maxLength`: { value, matchedPattern }
- `helperText`: { value, source }

UI 通过 FieldExplainer 组件展示，让用户 debug "为什么这个字段被扫到 / 为什么那个没被扫到"。

---

## 6. 数据模型

### 6.1 IndexedDB 表（Dexie schema v7）

```
projects          (id, name, createdAt, updatedAt, description, tags, applicationCount, facts?, memberIds?)
documents         (id, projectId, parseStatus, filename, mimeType, sizeBytes, rawText, parseError, createdAt)
chunks            (id, projectId, sourceType, sourceId, [projectId+sourceType], text, embedding, embeddingModel, tokenCount, excludedFromRag, createdAt, metadata)
eventContexts     (id, name, eventType, theme, organizer, location, url, deadline, extraNotes, pageMetaJson, createdAt, topicTags?)
qaRecords         (id, projectId, eventContextId, *personIds, status, qaPairs, markdownPath, submittedAt, pageUrl, pageTitle, stats, createdAt)
projectAssets     (id, projectId, tag, [projectId+tag], filename, mimeType, sizeBytes, blob, notes, createdAt)
persons           (id, displayName, createdAt, updatedAt, role, fields{}, notes)   ← V0.4.0 知识图谱
appSettings       (id='singleton') — 见下
```

#### V0.4.0 知识图谱（schema v6→v7）

**实体（节点）+ 关系（边）**：
- **Person**（新表）：每个参赛 / 联系人一份可复用档案。`fields` 是结构化个人信息（name/phone/email/wechat/qq/idNumber/title/organization/address/bio），存的是**本人真实数据**，仅本地。
- **Project.facts**：结构化项目事实（oneLiner/sector/stage/location/teamSize/metrics/techStack/extra），高优先 RAG 上下文；来自本地文件 LLM 抽取（人工确认）或手填。`memberIds` 关联团队成员。
- **EventContext.eventType / topicTags**：赛事分类 + 主题标签，用于"找相似历史赛事"。
- **QARecord.personIds**：承载 `Person ↔ Event ↔ 该赛事实际填写答案` 的三元关联边。

**图谱感知检索**（`retrieveGraphAware`）：草稿生成时，历史 Q&A 按"赛事相似度（主题/主办方/类型/地点）"重排，keyword overlap 仍为主项（0.7 vs 0.3，**非退化**：文档检索不变、无事件元信息时塌回 keyword baseline）。个人字段走 Person 档案**确定性回填本人真实值**（绝不 AI 编造、OTP 永不碰）。

**承重不变式**（违反会出事）：① v7 迁移幂等 + 零丢老数据；② **个人/OTP 答案绝不种进 RAG 语料**（否则本人手机/邮箱/身份证泄露进未来 LLM prompt —— Code GAN 实测发现，`rag/qa-seed.ts` 在种子边界拦截）；③ 个人信息只回填本人已存真实值，AI 不代写，提交前人工核对。

迁移 / 备份：Dexie v7 `upgrade()` 回填 `facts={}/memberIds=[]/personIds=[]` + 最佳努力派生 `eventType/topicTags`；备份 formatVersion 2 含 persons（兼容 v1 老备份）。

### 6.2 AppSettings（V2.2 当前）

```ts
interface AppSettings {
  id: 'singleton';
  llmConfigs: LLMConfig[];           // 主存储 — V2.2 核心
  keyDerivationSalt: string;
  keyDerivationIterations: number;   // 600,000 (PBKDF2 SHA-256)
  // 以下字段全部 deprecated，只为 v4→v5 migration 保留：
  encryptedAnthropicKey, encryptedOpenAIKey, encryptedOpenAICompatKey,
  openaiCompatBaseUrl, defaultModel, defaultModelProvider, fallbackModel,
  language, theme, vaultDirectory, embeddingProvider, embeddingDimension
}

interface LLMConfig {
  id: string;                // 'cfg-xxx'
  displayName: string;       // 'OpenAI · gpt-4o-mini'
  provider: 'anthropic' | 'openai-compatible';
  modelId: string;           // 'gpt-4o-mini' / 'claude-sonnet-4-6'
  baseURL?: string;          // openai-compatible only
  encryptedKey: string;      // 'ciphertext::iv' (AES-GCM, PBKDF2-derived key)
  isDefault: boolean;        // 恰好一条 true
  createdAt: number;
}
```

### 6.3 字段约束（DetectedField）

```ts
interface DetectedField {
  fieldId: string;
  domSelector: string;
  label: string;
  type: FieldType;
  constraints: {
    maxLength?: number;
    minLength?: number;
    required?: boolean;
    pattern?: string;
    helperText?: string;
    placeholder?: string;
    options?: string[];      // for select/radio/checkbox
  };
  rawElementInfo: { tagName, id?, name?, classes };
  provenance?: DetectedFieldProvenance;
}
```

---

## 7. 架构 & 技术栈

### 7.1 技术栈

| 层 | 技术 |
|---|---|
| 扩展框架 | WXT 0.19（Chrome MV3 build tool） |
| UI | React 18 + TypeScript 5.6（strict + exactOptionalPropertyTypes）+ Tailwind CSS 3.4 |
| 数据库 | IndexedDB via Dexie 4.0 |
| 状态持久化 | chrome.storage.session（per-tab session state）+ chrome.storage.local（via Dexie） |
| 加密 | Web Crypto API (PBKDF2 + AES-GCM) |
| LLM 客户端 | `@anthropic-ai/sdk` 0.30 + `openai` 4.73 |
| 文档解析 | mammoth (DOCX) + pdfjs-dist (PDF) + 内置 (MD/TXT) |
| 测试 | Vitest + happy-dom + fake-indexeddb |
| 打包 | Vite + esbuild |

### 7.2 入口 + 职责

| 入口 | 主要职责 |
|---|---|
| popup | 项目快速预览（最近用的）；点项目跳到 Options |
| sidepanel | 报名核心工作流；3 步流程；草稿生成 + 填入；提交沉淀 |
| options | 全屏管理：项目档案 + 经验库 + 设置（LLMConfig 库）+ 备份 |
| background SW | 消息路由器；DB 读写；LLM 调用（Anthropic SDK / OpenAI SDK）；扫描 + 填入脚本注入（chrome.scripting.executeScript） |
| content script | 通过 SW 注入的扫描 + 填入函数（不长驻） |

### 7.3 通信协议

所有 UI → background 走 `chrome.runtime.sendMessage(msg)` + `{ok, data, error}` 包络。Messages 列表见 `src/lib/messages/types.ts`（共 30+ message type）。

流式生成走 `chrome.runtime.sendMessage` 单向广播：
- `draft.token` — 每个 token 一条
- `draft.done` — 完成时一条带完整 text + ragRefs
- `draft.error` — 失败时一条带 message

### 7.4 LLM 调用流程

```
sidepanel
   ↓ sendMessage(draft.generateOne|generateBatch, { configId, projectId, eventContextId, field(s), streamId })
background
   ↓ requireLLMConfigById(configId) — 查表 + 解密 key → { provider, apiKey, baseURL, modelId }
   ↓ retrieveHybrid({ projectId, query }) — keyword overlap RAG
   ↓ generateDraft|generateBatchDrafts(...)
client.ts
   ↓ callLLM(...) — 按 provider 分流
   ├─ callAnthropicOnce → @anthropic-ai/sdk · messages.stream()
   └─ callOpenAICompatOnce → openai · chat.completions.create({ stream: true })
   (429 → 等 60s → 自动重试 1 次)
   ↓ broadcasts onToken / done / error 回 sidepanel
```

### 7.5 加密链路

```
用户输入主密码
   ↓ PBKDF2-SHA-256, 600K iterations, salt 16B
   ↓ 派生出 AES-GCM key (256bit, extractable=true)
   ↓ 缓存到 chrome.storage.session 作 raw bytes base64
   ↓ 用 AES-GCM 加密每个 API key (12B IV per encryption)
   ↓ 存 IndexedDB 作 'ciphertext::iv' 字符串
```

服务工作者（SW）每 5 分钟空闲会被 Chrome 杀；重启后 `sessionReadyPromise` 从 chrome.storage.session 取回 raw key 重新 importKey。整个流程对用户透明。

---

## 8. 非功能性需求

### 8.1 性能

| 指标 | 目标 | 当前 |
|---|---|---|
| 扩展安装包大小 | ≤ 5 MB | 2.89 MB ✅ |
| 冷启动到 sidepanel 可交互 | ≤ 1.5s | ~800ms ✅ |
| 字段扫描（50 字段表单） | ≤ 2s | < 500ms ✅ |
| 单字段生成（Sonnet，~1500 tokens 输入） | ≤ 15s | 8-12s ✅ |
| 批量生成（3 字段一批） | ≤ 25s | 15-22s ✅ |
| 23 字段表单完整生成（串行 + 8s 间隔） | ≤ 3min | ~1.7 min ✅ |
| 文档上传解析（PDF 10 页） | ≤ 30s | ~15s ✅ |

### 8.2 可靠性

| 项 | 设计 |
|---|---|
| 速率限制（429）保护 | 自动 60s 等待 + 重试 1 次（Anthropic + OpenAI 都生效） |
| 长流断连保护 | 120s 超时 wrapper 包每个 generateOne |
| SW 重启保护 | sessionReadyPromise gate 所有消息 handler |
| 失败可见性 | 所有异步操作走 AsyncButton + toast；不再有 silent return |
| 局部失败 batch | batch JSON parse 失败 → 单字段标 ❌，不影响其他字段；用户可手动重试 |

### 8.3 安全 & 隐私

| 项 | 设计 |
|---|---|
| API key 加密 | PBKDF2 + AES-GCM；密文 + IV 都在 IndexedDB；主密码不存盘 |
| 数据本地化 | 所有数据在 IndexedDB；零外发到 ApplyForge 服务器（不存在这种服务器） |
| 唯一外联 | Anthropic API（直连）/ OpenAI 兼容 API（直连用户指定 baseURL） |
| 内容截取 | 页面正文最多前 8000 字进 LLM，避免敏感页面满量泄露 |
| CSP | `script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://api.anthropic.com https://api.openai.com https://*.sentry.io` —— 注意：OpenAI-compat 自定义 baseURL 时需要用户在 Chrome 端放行 |
| 主密码丢失 | **不可找回** —— 所有加密 key 永久无法解密，必须删插件重建 |

### 8.4 浏览器兼容

| 浏览器 | 支持 |
|---|---|
| Chrome MV3 | ✅ 主目标 |
| Edge MV3 | ✅ 应该兼容（未严测） |
| Firefox | 🟡 WXT 支持但未验证；side panel API 不存在，需替换为 popup-only |
| Safari | ❌ 不支持 MV3 完整能力 |

### 8.5 i18n

| 语言 | 状态 |
|---|---|
| 简体中文 | ✅ 主语言；所有 UI 文案 + Provider catalog 描述 + 错误消息 |
| English | 🟡 部分文案有；不是一等公民；V2.1 时把"UI 语言"开关删了（用户决定不做） |

---

## 9. 已发布版本（迭代历史）

### V1.0 (2026-05-19) — 功能基线

完成"想法到能跑"的完整闭环：

- 项目档案 / 文档 RAG / 资产管理 / 事件检测 / 字段扫描 / AI 流式生成 / 文件匹配 / 一键填入 / 提交沉淀 / 备份 / 历史 / 设置加密
- Anthropic-only（dangerouslyAllowBrowser）
- 18 项单测通过，build 2.74 MB
- **已知问题**：交互不闭环（卡顿无反馈、状态丢失、错误不可见）

### V2.0 (2026-05-23) — UX 大改造

针对 V1 用户反馈"交互上有很多 bug，没有用户思维"做的系统性优化：

- **统一 AsyncButton 组件**：所有按钮三态可见
- **ErrorToast 系统**：消除 alert() 和 console.warn()
- **状态持久化**：step / eventDraft / fields / qaPairs / assetMatches 全部 chrome.storage.session
- **sessionKey unlock race 修复**：SW 重启不再误报"未解锁"
- **可见性放宽**：scanner 不再误删 0×0 file input
- **FieldExplainer**：每个字段可看 provenance
- **8 个表单编辑器 URL 黑名单**：避免在 Google Forms /edit 这类页扫出 57 个字段
- **MAX_LENGTH 模式 17 种**：覆盖中英文绝大多数字数限制表达
- **Shadow DOM 递归**：LWC / Shoelace 字段不再消失
- **Semantic page extraction**：长页面取 `<main>` / role=main 而不是 body 截前 4000 字
- **ExtractionConfidenceBanner + FieldOriginBadge**：事件信息透明化
- 43 项单测通过，build 2.77 MB

### V2.1 (2026-05-24) — 多 Provider 接入

支持 OpenAI 兼容协议（DeepSeek / Moonshot / GLM / 豆包 / 通义 / OpenAI 等）：

- AppSettings + 2 个 key 槽（Anthropic + OpenAI-Compatible）
- 通用 callLLM dispatcher 路由 Anthropic SDK / OpenAI SDK
- 429 backoff 两边都生效
- sidepanel chip 显示 Provider · model
- Tier 1 429 修复（C+D）：RAG 12→5 + chunk 截 400 字 + 8s throttle + batch 3 字段一批 = 23 字段表单从撞墙变 1.7 分钟跑通

### V2.2 (2026-05-24) — LLM 配置库

替换"2 个 key 槽"为"配置库"模式（用户提供截图参考）：

- `LLMConfig[]` 数据结构 + 8 个 Provider 预设
- v5 schema migration：老用户的 2 个 key 自动转 2 条 config
- 设置页全部重写：顶部"添加新模型"表单 / 底部"已接入的模型"列表
- 点行体直接设默认；▶ 展开看细节；🗑 删除
- 每个 Provider 自带推荐模型列表 + 获取 API key 链接
- Onboarding 重写：选 Provider + 选 model + 输 key
- sidepanel chip 显示 active config 的 displayName，点开看所有配置
- 43 项单测通过，build 2.89 MB

### V2.3 (2026-05-30) — 真实表单 dogfood 加固

用 Chrome MCP 在真实创赛报名表单（上海创业营，SMS 登录后）实跑，暴露扫描器只为 ARIA 框架（Google Forms/Qualtrics）调优、几乎填不了手写中文表单。检出 8→18 字段、+2 上传 ≈ 20：

- **纯文本节点标签**：`leadingLabelText` + `detectParentQuestionLabel`（wrapper 正则含 `form-row`，顺带回收"不超过 200 字"类 maxLength）
- **native 单/复选分组**：`collectNativeChoiceGroups`（按最近 row/fieldset 容器，不靠 `name`）；填充走 `.checked`（`checkMatchingNative`）
- **批量生成 JSON 健壮性**：长多行答案的裸换行炸 JSON → `parseBatchResponse` escape 控制字符 + regex 兜底；`generateBatchDrafts_handler` 批量失败逐字段 fallback（修了"3 个报错"）
- **自定义 JS 上传字段**：`collectCustomUploadFields` 检出 + 标 `manualUploadOnly`，sidepanel "需手动上传"卡 + 匹配资产一键下载（OS 文件弹窗浏览器安全无法程序化，**不能真·自动上传**）
- 54 项单测通过、lint clean、build ~2.9 MB；全程记录见 `iteration-vault/2026-05-30-real-form-dogfood/findings.md`

待办（P2 deferred）：登录页验证码字段被当可填字段；条件展示字段（选某 radio 后才出现）一次性扫描漏掉。

### V2.4 (2026-05-31) — 扫描器顺序 / 标签 / 字数三连修复

第二轮真机 dogfood（同一创赛表单）暴露 3 个问题，全部已修 + 实时验证 + 单测锁定（61 测试通过）：

- **字段顺序**：`scanFields` 分 pass 按类型收集后，末尾按 `compareDocumentPosition` 排回 DOM 顺序 —— 修掉"radio 组排到 申请人姓名/职位 等 text 框前面、顺序错乱"。
- **标签隔离**：`detectParentQuestionLabel` 标题只认排在输入框之前的、bare-text 兜底只认最近一层 wrapper —— 修掉 text 字段标签被邻近自定义上传控件的"尚未上传任何文件"污染成"尚未上传任何文件 - 申请人姓名"。
- **字数上限完整句**：`prompts.ts` 让模型写到 ~90% 上限并以完整句子收尾；`client.ts` `hardTruncate` 回退到最近句末/分句 —— 修掉"项目简介停在第 200 字、断成半句话"。
- 顺带确认：主密码"每次第 3 步重输"**非 bug**，是 `chrome.storage.session` 在扩展 reload / 关浏览器时被清（ADR-005 安全设计内）；同一浏览器会话内 SW 重启会自动恢复。

### V2.5 (2026-06-01) — 按钮组选择控件支持（第三种选择控件形态）

第三轮 dogfood（Epic Connector hackathon 报名表）发现一种新选择控件：纯 styled `<button>` 单/复选 —— **无 `<input>`、无 `role=radio`、选中态只靠 CSS class**，CURRENT ROLE / MAIN TRACK / EXTRA TRACK 三个字段因此全漏（Pass 1/1.5/2 都不找 `<button>`）。

- 新增 `collectButtonChoiceGroups`（Pass 1.7）+ `fillField` 点击匹配按钮分支。
- **防误判**（实测时一度把页面导航栏 Overview/Features/Guides 当成字段）：排除 `nav/tablist/menu/toolbar/header/footer/banner` 容器 + 标签只认 `<label>`/heading/label-ish 元素 + 要求全部按钮为非动作词（排除 Save/Cancel/提交…）。
- 实时验证：3 组全检出（Founder/Student/Professional、Agent/Skill/Application、MiroMind/Not Interested），导航栏正确排除。65 测试通过、lint clean、build 2.9 MB。

### V2.6 (2026-06-01) — 生成语言跟随 + 重生成带提示词 + 多选 Track

同一 Epic Connector 表单第二轮 dogfood 的 3 条 PM 建议，全部已修 + 实时验证（69 测试通过）：

- **生成语言跟随表单**：英文表单上 Project Name/Description 是英文、但 Tagline 跑出了中文（中文 RAG 语料带偏，旧的系统提示太弱）。`prompts.ts` 新增 `detectFormLang`（按 label + 活动名的中日韩字符比例判定），在 prompt 顶部下**强语言指令** —— 英文表单一律输出英文、中文表单输出中文。
- **重生成可带"改写建议"**：原来重生成只是再随机一版、不收敛。sidepanel 每个文本字段的"重生成"旁新增小输入框，PM 填的修改建议（如"更简短 / 突出落地"）作为 `refinement` 一路传到 `buildUserPrompt`，作为**最高优先级指令**。选择/文件字段保留普通重生成按钮。
- **多选 Track**：`Track (select up to 2)` 之前被当单选。`collectButtonChoiceGroups` 的 multi 正则扩展，支持 `select up to N` / `choose up to N` / `最多选 N 个` / `选 N 项` / `多选` → checkbox；`single select` 仍为 radio。实时验证：Track 现为多选、4 选项（Agent/Skill/Application/DeepResearch）全出。
- **批量 JSON 健壮性（被英文暴露）**：强制英文后，英文答案里的 ASCII 引号（给术语加引号）把批量 JSON 撞碎，旧的正则恢复把值截在第一个引号处 → Tagline/Description **半句戛然而止**（且 "已生成 8/9"）。`parseBatchResponse` 新增 `structuredExtract`：按已知字段键 f1..fN 切分取值，含引号/换行都不怕。中文从不踩此坑（全角引号不撞 JSON）。语言判定也改为**只看字段 label+placeholder**（不看可能是中文的活动背景），重生成"改写建议"置于语言指令之前。

### V2.7 (2026-06-05) — 多页 / 分步表单"继续下一页"

第四轮真机 dogfood（科大硅谷 gowithdream `index/apply/step2.html`，分步报名向导）暴露一个**流程死角**：第一页填完点"我已提交"后，侧边栏走到终点态 `SubmittedPanel`，**只有"打开 Downloads / 完成(window.close)"两个按钮，没有任何回到扫描的入口**。而真实创赛 / 孵化器 / 高校报名表单大多是 step1 → step2 → … 的多步向导，第二页是全新字段（项目概况 / 落地规划 / 参赛期望），用户因此卡死在第二页。

- **`SubmittedPanel` 不再是终点**：新增"继续填下一页（扫描本页新字段）"主按钮 → 重新扫描当前 tab → **保留项目 + 活动背景**、重置所有 per-page 瞬态（fields / qaPairs / fillStatus / assetMatches / fieldState / …）→ 回到第 3 步草稿。
- **共享扫描逻辑**：把原 `confirmContextAndScan` 的"扫描 → 播种 QA → 进入草稿 → 匹配文件资产"抽成 `scanCurrentTab` + `enterDraftWithFields`，首次扫描与"继续下一页"共用，避免两条路径走偏。
- **自然循环**：填 → 我已提交（沉淀本页 QARecord）→ 继续下一页 → 填 → …，每页各自存一条经验记录，可链式翻 N 页。
- **`AsyncButton` 加 `icon` 属性**：可传 lucide 图标（替代 label 里的 emoji，遵守 2026-05-29 redline）；顺手把 `SubmittedPanel` 残留的 📂 换成 `FolderOpen`。
- compile + lint clean、build 2.91 MB。⚠️ 浏览器安全：Chrome MCP 驱动不了扩展自己的 sidepanel UI，本轮只验证了扫描器复用 + 构建；按钮交互需人工 reload 扩展后在真机点。

待办（P2 deferred）：草稿步**未点"我已提交"就翻页**的二级"重新扫描本页"入口（本轮只做了提交后的"继续下一页"；未提交时可先点"我已提交"再继续，循环自洽）；条件展示字段（选某 radio 后才出现）一次性扫描漏掉。

### V2.8 (2026-06-06) — 两列式表单扫描器加固 + 个人信息/验证码不让 AI 编

第五轮真机 dogfood（HICOOL 2026 全球创业大赛开发者挑战赛，`moore.hicool.com`，分步表单）。这表单用 `li.t-row > div.t-col > div.t-col-l(标签) + div.t-col-r(控件)` 的**两列式布局**：wrapper class 不匹配任何已知正则、标签在**兄弟单元格**里。扫描器**只检出 10/16 字段**，且全部标签退化成 placeholder。注入实时扫描确诊 5 个坑（G1-G5），全修 + 实时验证（检出 10→15，全部标签正确）+ 6 条新单测锁定（79 测试通过）：

- **G1 兄弟单元格标签**：`findSiblingLabelCell`（从控件向上爬 ≤4 层，取**含标签文本但无控件**的前序兄弟格；**优先 `：` 结尾**、**跳过 `选择/上传` 触发词**）接到 `detectParentQuestionLabel` 末尾兜底。**总开关** —— 修好它，G2 的 select、G4 的文件域标签、全表单字段名一起恢复。
- **G2 可见 `<select>` 被丢**：`参赛赛道`（native select，无 placeholder）因无标签被 `analyzeElement` 返回 null。随 G1 恢复。
- **G3 opacity:0 原生单选**：`是否成立公司` 的 native radio 用 `opacity:0` 自定义样式，被 `isLikelyRespondentField`（拒 opacity:0）整组漏掉。新增 `isRenderedChoiceInput`（只拒 display:none/visibility:hidden/aria-hidden，容忍 opacity:0/0 尺寸）+ `nearestChoiceContainer` 增加"最近含 ≥2 同型 input 的祖先"兜底（找到无 form-row class 的字段格）。
- **G4 文件域 + 假框**：3 个 `.pdf` file input 无标签被丢、只读"上传文件"框被当 text 检出。随 G1 恢复文件域真实标签（商业计划书/项目演示视频/项目代码）；`scanFields` 末尾按 label 去重多槽上传；`isUploaderDisplayBox` 跳过上传假框。
- **G5 个人信息/验证码不让 AI 编**：`detectSensitiveKind` 按 label 标 `constraints.noAiFill` + `sensitiveKind`（`otp`=验证码/captcha；`personal`=姓名/手机/邮箱/微信/身份证，CJK 无词边界用子串匹配）。sidepanel `generateAll` 跳过 noAiFill（同 file），FieldCard 显示"请你自己填，AI 不代写"。避免 AI 瞎编联系人身份、避免替用户填实时短信验证码。
- 顺带：`AsyncButton` 的 `icon` 属性（V2.7 加）继续用；compile + lint clean、79 测试通过、build 2.91 MB。⚠️ Chrome MCP 驱动不了 sidepanel UI，本轮验证了扫描器 + 单测 + 构建；填充/UI 交互需人工 reload 扩展后真机点。

### V0.3.0 (2026-06-08) — 字段识别 LLM 语义提取混合管线（§10 落地路径 1-2 步交付）

把 §10 旗舰方向从「提案」落地为「混合 completeness-pass」：启发式仍是默认快路径，新增 LLM 语义识别作为可选补漏，**换没见过的表单不改扫描器代码**。全程经 AutoDev 流水线三道对抗审查（Plan GAN + Code GAN×2 + Global GAN，全 PASS）。

**新增管线（`src/lib/fields/semantic/`，零新增运行时依赖）**：
- **打标** `tagger.ts`：给每个可见可交互控件挂 `data-af-id`（借 Set-of-Mark 思路；幂等、容忍 opacity:0、递归 Shadow DOM）—— 解决"LLM 描述得出控件却给不出可写选择器"（致命坑 F4）。
- **蒸馏** `distill.ts`：控件转精简清单（afId + tag/type/placeholder/附近标签/DOM 硬约束）；**只发可见控件元信息、绝不发原始 HTML 或用户已填值**（隐私 F7/BR12，pureLabelText 走文本节点不读 .value）。
- **提取** `extract.ts`：复用现有 `callLLM`（同 `detectEventFromPage` 模式），一次调用返回"人会填的字段"（label/type/敏感/多控件合一）；容错解析。
- **回填校验** `backfill.ts`：afId 精确对回 DOM + 校验存在性剔幻觉（BR4）、**硬约束信 DOM 不信 LLM**（BR3）、敏感字段标 `noAiFill`（BR5），产出标准 `DetectedField[]`（下游 draft / 一键填入 / provenance UI 全不动）。
- **混合编排** `orchestrate.ts`：启发式 ∪ LLM 合并去重（一致标 `heuristic+llm` consensus，严格匹配防误合）；**LLM 失败自动退回启发式、绝不白屏**（BR7）；按 URL+DOM 签名缓存（不缓存失败结果）。
- **模式开关**：`AppSettings.scanMode`（`heuristic` 默认 / `hybrid` / `llm`），Dexie v5→v6 迁移；Options 设置页 3 选卡切换。
- **afId 防误填守卫**：填充前复校 `[data-af-id]` 命中元素与扫描时一致，不一致跳过标 failed（BR13，防 React 重排写错框）。
- **UI**：FieldExplainer 新增「LLM 识别 / 启发式+LLM 一致」来源徽章（lucide Sparkles/CheckCircle2）；sidepanel recall 对比条 + 静态字段诚实边界 + 外发提示。
- **recall 回归基准**：5 张代表性 fixture（HiCool 两列 / 上海 flat / 标准 label / Epic 按钮组 / 科大硅谷多步）+ hybrid≥heuristic 非退化性质测试。

**默认 `heuristic` = 发布即旧行为，灰度零风险。** 131 测试通过（基线 79 + 新增 52）、compile/lint clean、build 2.93 MB。

⚠️ **诚实边界**（与 §10 一致，不可越界）：不承诺"无人复核、任意表单 100% 一一对应"；真实表单 recall 真值留人工真机 dogfood（与 V2.3-V2.8 一致）；动态/分页字段静态扫不到，UI 明示需翻页（复用 V2.7「继续下一页」）；提交前人工复核闸保留。

⚠️ **Code GAN 实测（一次性探针）修掉 4 个真 bug**，已各配回归测试锁定：① 缓存污染（transient LLM 失败后整 session 不再调 LLM）② 假共识（`First Name`/`Last Name` 误合并丢 LLM 字段）③ Shadow DOM afId 重排碰撞 ④ 相邻 contenteditable PII 泄露。

> 全程深档案：`docs/plans/2026-06-08-llm-semantic-field-extraction-{ideation,oss-scan,design,ui,api,plan,index,rules}.md` + `docs/pipeline/{verification-report,global-review}.md` + `iteration-vault/2026-06-08-llm-semantic-field-extraction/`。

### V0.4.0 (2026-06-24) — 结构化知识图谱（人员 + 项目 + 赛事关联检索）

把"扁平 chunk + keyword 检索"升级为"**实体 + 关系 + 图谱感知检索**"，解决 PM 反馈的"调取项目 / 人员信息方式有误、没有结构化知识图谱、调不到本地与历史数据"。全程经 universal-coding-project-development-skill 重型流程 + 双路对抗 GAN（数据完整性 / 隐私），见 `iteration-vault/2026-06-24-knowledge-graph/`。

- **人员图谱**：新增 `Person` 实体（独立存每个参赛 / 联系人的真实个人信息）+ `persons` 表；`QARecord.personIds` 把"人 ↔ 赛事 ↔ 实际填写答案"关联起来，类似赛事可复用。Options 新增「人员档案」tab（CRUD + 从文件导入）；sidepanel 报名时勾选参与人员 + 主联系人。
- **个人信息回填**（反转 G5 边界，决策 2026-06-24）：个人字段（姓名 / 手机 / 邮箱 / 微信 / 身份证）不再一律手填——若选定 Person 有匹配字段则**确定性回填本人真实值**（`graph/person-fields.ts`）；**AI 草稿生成仍永不碰个人信息**，OTP / 验证码**永不存不填**，提交前人工核对闸保留。
- **项目图谱**：`Project.facts` 结构化事实（赛道 / 阶段 / 地点 / 指标 / 技术栈…）作高优先 RAG 上下文（`prompts.ts formatProjectFacts`）；来自 PM 丢的本地文件 LLM 结构化抽取（`background.extractProjectFactsFromText`，**返回候选、人工确认后入库**）或手填。
- **赛事关联检索**：`EventContext` 增 `eventType/topicTags`；`retrieveGraphAware`（`rag/retrieval.ts` + `graph/event-similarity.ts`）按赛事相似度（主题 / 主办方 / 类型 / 地点）重排历史答案，keyword 仍为主项 → **非退化**。QA 历史记录显式带主办方 / 地点 / 主题 / 类型（满足"每条历史要标明"）。
- **迁移 / 备份**：Dexie v6→v7 幂等迁移、零丢老数据、`*personIds` multiEntry 索引；备份 formatVersion 2 含 persons（兼容 v1）。
- **隐私铁律（Code GAN 实测修掉的真 bug）**：个人 / OTP 答案**绝不种进 RAG 语料**（`rag/qa-seed.ts isSeedableQaPair`）——否则自动回填的本人手机 / 邮箱 / 身份证会经"历史 Q&A"漏进未来所有草稿 prompt。与 V0.3.0「相邻 contenteditable PII 泄露」同源教训：隐私边界要守数据流每一跳。
- **160 测试通过**（基线 131 + 新增 29）、compile / lint clean、build 2.96 MB。

⚠️ **诚实边界**：检索按结构化属性相似度，不引入 embeddings（保持 ADR-003 本地无后端）；本地文件抽取需人工确认；真实表单回填准确度真值留人工真机 dogfood（与 V2.3-V2.8/V0.3.0 一致）；多人表单"队员1/队员2"逐字段映射未做（MVP 用主联系人 + 回退）。

### V0.4.1 (2026-06-24) — 非破坏性种子导入 + facts 编辑修复（真实数据落地）

用真实数据（萤火虫 Firefly 项目 + 两位团队成员）跑通知识图谱，补两个能力：

- **非破坏性种子导入** `graph.importSeed`（`graph/seed-import.ts` + Options 人员档案「导入知识图谱种子(JSON)」）：批量灌 `{project, persons}` **合并入库不清库**（区别于 backup 全量恢复的破坏式导入）。项目按 name 去重（facts 深合并、`extra` 也深合并）、人员按 displayName 去重（fields 合并、incoming 覆盖），导入的人 union 进 `project.memberIds`；幂等可重复导入。配 6 测试。
- **facts 编辑框选项目即载入现有 facts**：修掉"选中项目→保存会把 facts 清空"的坑（编辑框原本不载入已存 facts）；ref 守卫防 `projects` live-query 刷新覆盖正在改的值。
- **实战教训（已进 CLAUDE.md 铁律）**：① 真实人员 PII + 项目具体数据的种子 JSON **写到公开仓库之外 + 直接交付用户、绝不 git add**（本仓 public）——隐私边界从"数据流每跳"延伸到"git 边界"；② **facts 要密度**——`formatProjectFacts` 把每个 facts 字段逐条塞进**每次**草稿 prompt，长论述（多页架构 / 三套财测）应归 RAG 文档按需检索，facts 只留高密度短句（实测把 metrics 700 字 / techStack 900 字精简到 ~140 字）。
- **165 测试通过**、compile / lint clean、build 2.96 MB。

### V0.4.2 (2026-06-26) — 项目管理 + 一键多格式导入 + 人员/经验库按项目归属

真机 dogfood 暴露 3 个缺口，一轮交付（全程对抗式 GAN，15 agent 4 视角 review→verify，10 confirmed 全修）：

- **项目删除 + 防误删**：每个项目卡片「🗑 删除」+ **带真实数量的二次确认**（X 文档 / Y 记录 / Z 资产）。后端抽 `src/lib/db/project-ops.ts deleteProjectCascade` —— 修掉**删项目漏删 projectAssets 留孤儿**的 bug；级联覆盖 chunks / documents / qaRecords / **projectAssets** / project，一个事务，**persons 不删**（跨项目共享）。配 3 回归测试（无孤儿 / 不误删他项目 / 留共享人员）。
- **一键多格式 AI 导入**（项目档案首页「✨一键导入资料」）：一次丢 **pdf / docx / pptx / xlsx / 图片 / md / txt** → 文本走 `parseDocument`、图片转资产候选 → 合并文本一次 `projectFacts.extract`（AI 归类项目事实 + 人员）→ **确认页**（事实可改 / 人员勾选 / 文件归类 / 选目标项目）→ 落库（复用 projects / persons / documents / assets 消息）。pptx / xlsx 用 **jszip 轻量抽取**（`parsers collectTagText` / `decodeXmlEntities` 纯函数，避开 SheetJS 重依赖）；空文本 / 超 25MB 文件跳过 + 标记。**坚持"AI 归类 → 你确认 → 才落库"**（不盲信 LLM）。
- **人员档案 + 经验库按项目归属**：many-to-many via `Project.memberIds`（一人可属多项目）；共享 `ProjectScopePicker`（按项目筛选，删项目后自动回退"全部"防悬空）；人员用**项目标签**直接管理归属；经验库按 `QARecord.projectId` 过滤。
- **Code GAN 修掉 7 个真 bug**（各配修法）：① 导入同批重名候选建重复 Person（去重快照循环内未回灌 → 对齐 seed-import 守卫）② commit 非事务、失败重试重复传文档/资产 + 'new' 重试再建空项目（pin 已建项目 + 每文件 `committed` 标记续传）③ `targetProjectId` 不随 live-query 同步导致"现有项目"导入卡死 ④ 级联删除 vs 异步 `indexDocument` 竞态留孤儿 chunk（存在性检查进同一事务）⑤ 大文件主线程解析冻结（25MB 上限）⑥ 删当前筛选项目后筛选器悬空 ⑦ 空文本文档误标 ✅ 不进 RAG。
- **174 测试通过**（+9：project-ops 3 + parsers 6）、compile / lint clean、build 2.98 MB（jszip 懒加载）。

---

## 10. 不在范围（V3+ 候选）

按优先级排：

### 🔭 旗舰架构方向：字段识别 — 从"手写启发式"到"LLM 语义提取"（✅ V0.3.0 已交付落地路径 1-2 步）

> **状态：✅ 落地路径第 1-2 步已于 V0.3.0（2026-06-08）交付** —— 混合 completeness-pass，默认 `heuristic`，`hybrid`/`llm` 在 feature flag 后；实现见 `src/lib/fields/semantic/` + §9 V0.3.0 条目。本节保留原始方案论述作为设计依据。**第 3 步「LLM 主路径化」与时间类「交互式探索」仍未做**（待真实表单 recall 基准稳超启发式 + 独立的用户监督/可回退设计）。原始问题陈述："如何不再每换一张表单就改扫描器代码、逼近 100% 一一对应"。

**问题：现在的字段识别是手写启发式，长尾不可持续。** `src/lib/fields/field-scanner.ts` 靠 CSS class 正则 + DOM 结构规则一条条认控件，每遇一个新表单家族就得补 pass：V2.3（手写中文表单）、V2.4（顺序/标签隔离）、V2.5（按钮组）、V2.8（两列式 + opacity:0 单选）—— **每一轮 dogfood 都在加规则**。根因是它在"猜布局"而非"理解语义"，长尾无穷。

**"100% 一一对应"要拆成两类缺口**（HiCool 第 2 页实测漏斗：DOM **48 控件** → 12 个 `type=hidden` 状态 + 19 个 CSS 隐藏（模板行/条件字段/隐藏背存）+ 1 readonly → 仅 **16 个可填控件** → 再分组才是人看到的 ~9 个字段）：

| 缺口类 | 是什么 | 可解性 |
|---|---|---|
| **识别类**（机器零件混入 / N 控件=1 字段 / 1 模板=N 字段 / 无声明式标签） | 字段**已在 DOM**，难在判断"哪些是字段、问什么、怎么分组" | ✅ **可解到「换表单不改代码」** |
| **时间类**（条件展开 / 加队员重复行 / 分页） | 字段**扫描时还不在 DOM** | ⏳ 静态方法（规则或 LLM）**原理上看不见**，只能靠**交互**逼出 |

> 诚实边界：**"无人复核、任意表单保证 100%"做不到也不该承诺**（LLM 会错、时间类要交互）。真正能消灭的是"换网页就要改代码"这个痛点。

**核心方案：混合「启发式 + LLM 语义提取」，用元素打标解决回填。** LLM 见过海量表单、天生懂"这个框在问什么"，不靠 class 规则。致命坑是它给不出能**写值**的选择器（纯视觉尤其对不回 `<input>`）——解法是给每个候选控件挂 `data-af-id`，LLM 返回 afId，再精确对回 DOM。复用已有 `callLLM` + [`detectEventFromPage`（background.ts:296）](src/entrypoints/background.ts)——它**已经在把页面正文喂 LLM 提取活动信息**，字段识别就是同一套模式延伸到控件。

管线：
1. **打标**：遍历 DOM，给每个可能可交互元素（input/select/textarea/`[role]`/contenteditable/styled-clickable）挂 `data-af-id`。
2. **蒸馏**：发**精简清单**（afId + tag/type/placeholder/附近可见文字/可见性），不发原始 HTML；仅可见元素、控体积。
3. **LLM 提取**（一次调用）：返回"人会填的字段"—— label / type / 约束 / 是否敏感(otp/personal) / **多控件合一字段**，并排除后端/隐藏/动作控件。
4. **回填 + 校验**：afId 精确对回 DOM 节点（解决纯视觉对不上）；硬约束（maxLength / options / accept）**信 DOM 不信 LLM**；校验 afId 真存在（防幻觉）。
5. **缓存**：按 URL / DOM 签名缓存，重复访问不重复调用。

**不推倒重来：启发式保留为离线快路径 + 交叉校验 + LLM 失败兜底。** LLM 的活收窄成"对差异 / 补漏"（completeness-repair pass），比从零提取更省更准。

> 学到的数据点：别用浏览器无障碍树（AX tree）当唯一输入—— HiCool 实测它**漏了** opacity:0 单选和自定义下拉。原始 DOM + LLM 比 AX 树更全。

**解决什么 / 残留什么**
- ✅ **识别类全解**：兄弟单元格标签、opacity:0 单选、手机=区号+号码、剔除 12 个 hidden 状态——靠模型语义，**换没见过的表单一行代码不改**（这就是用户要的"不用每次改"）。
- ⏳ **时间类 → 第二阶段「交互式探索」**：点"有公司"展开隐藏字段、点"加队员"materialize 重复行、翻页——正是 V2.7「继续下一页」开的头。会**改动表单状态**，故必须**用户监督、可回退、绝不自动提交**；即便做了，"全"取决于探索分支数，是**降低**②不是消灭。

**权衡（PM 决策项）**

| 维度 | 影响 |
|---|---|
| 成本 / 延迟 | 每张**新**表单多一次 LLM 调用；扫描本不频繁，缓存后重复访问不调 |
| 隐私 | 控件清单发给 LLM——`detectEventFromPage` 已在发页面正文，姿态一致；敏感站点可设白/黑名单 |
| 可靠性 | LLM 偶发错标 / 漏 → 保留启发式交叉校验 + **保留提交前人工复核闸** |

**落地路径（低风险、可度量）**
1. 留启发式；加 **LLM completeness pass**，置于 feature flag 后。
2. 攒 **dogfood 表单语料**（科大硅谷 / HiCool / Epic Connector / 上海创业营…）当回归基准，**量 recall**（检出/真实字段）。
3. LLM pass recall 稳超纯启发式 → 设为主路径，启发式降兜底 + 校验。
4. 再上第二阶段交互式探索（条件 / 重复 / 分页）。

**一句话**：把"按 class 手写规则"换成"**打标 + LLM 语义提取 + DOM 回填校验**"的混合管线，**识别类问题不再需要每换一张表改代码**——这是用户真正想要的；时间类靠交互式探索逼近，但守住"逼近全 + 提交前人复核"，不追求盲签的 100%（与下方「明确不做」的 Auto-submit / 用户必须 review 一致）。

### 🟡 中期候选（V0.3.x）

| 候选 | 说明 |
|---|---|
| 首次用户引导 tour | 装好后弹一个 5 步教程，告诉新人怎么用 |
| Edit existing LLMConfig | 现在改 key/model 要先删再加；改成可编辑 |
| Config 拖拽排序 | 列表上下排序，影响 sidepanel 弹出框顺序 |
| 备份云同步 | WebDAV / Google Drive / 坚果云 同步 backup.json |
| 经验库搜索 + 过滤 | 历史多了之后，按项目/活动名/时间/采纳率筛选 |
| Project 多选状态保持 | popup 一键选最近用的项目跳进 sidepanel |

### 🟠 长期候选（V0.4+）

| 候选 | 说明 |
|---|---|
| 真 embedding RAG | V1 用 keyword overlap，V0.4 接 OpenAI embeddings 或本地 transformers.js |
| Auto-submit | 风险：误提交真表单；可选 + 二次确认 |
| 多语言 UI | English / 日语 / 韩语；i18next |
| Firefox 适配 | sidepanel → 弹窗替代 |
| 集成更多表单平台 | Typeform API / Tally API 直接读题不靠扫 |
| Chrome Web Store 上架 | 走审查，做 store listing |
| 移动端 PWA | 不现实（移动端没 sidebar 概念）|

### ❌ 明确不做

- 跨用户协作（团队多人共编一个项目档案）
- 服务端账户体系
- 给文档做 OCR
- 自动用 LinkedIn 抓个人信息
- 给报名表自动选附件类型/打勾合规复选框（用户必须 review）

---

## 11. 风险 & 限制

### 11.1 已知技术风险

| 风险 | 缓解 |
|---|---|
| Chrome 区域屏蔽 api.anthropic.com（中国 IP） | 教程引导用 OpenAI 兼容路由（DeepSeek / Kimi 等国产模型）|
| Anthropic / OpenAI 模型 ID 变更或废弃 | ModelPicker 总有"自定义"选项；用户可自己输入新 ID |
| 表单平台改 DOM 结构（如 Qualtrics 升级） | 扫描器多源 fallback；provenance 让用户能 debug |
| Tier-1 rate limit | V2.1 已加 8s throttle + 60s backoff；高频用户引导升 Tier 2 |
| IndexedDB 容量上限 | 一般浏览器 50-60% 磁盘可用；超 1GB 会触发清除提示。资产 blob 是大头，提示用户定期备份 |

### 11.2 产品风险

| 风险 | 缓解 |
|---|---|
| 主密码丢失数据永久锁死 | Onboarding + 设置页双重提醒；备份导出含密文，导入到新设备只要还记得主密码就能解 |
| 用户误删 config 后无法生成 | 删除有二次确认；如果删的是 active config，自动 promote 下一条 |
| AI 编造项目里没有的事实 | System prompt 强制"不编造"；prompt 里塞 RAG 上下文；用户 review 草稿 |
| 用户在编辑页扫表单 | URL 黑名单 + 错误提示"请打开公开链接" |

### 11.3 法务/合规

| 风险 | 当前姿态 |
|---|---|
| 用户的 API key 安全 | 加密存储；如插件代码被恶意修改可能泄露，但自托管 = 用户自审 |
| 报名表填错信息的责任 | UI 多次提示"PM 必须自己 review 后点提交"，插件不替提交 |
| 跨境数据（用海外 LLM） | 用户自选 Provider；用户自负其责 |

---

## 12. 成功指标（衡量产品价值）

### 12.1 核心 KPI

| 指标 | V1 目标 | V0.2.2 现状 |
|---|---|---|
| 每次报名平均耗时 | 10-15 分钟 | 待真实测量 |
| AI 草稿采纳率（accepted + edited_minor） | ≥ 50% | 待真实测量 |
| 用户每周报名次数 | ≥ 2 次 | 待真实测量 |
| 项目档案至少 1 个 | 100% | ✅（onboarding 强制）|

### 12.2 工程 KPI

| 指标 | 当前 |
|---|---|
| TypeScript 严格模式编译 | ✅ clean |
| 单测覆盖 | 43 项通过（schema / scanner / batch prompt parser） |
| Build 大小 | 2.89 MB |
| 7 Quality Redlines | ✅ 全过 |

---

## 13. 附录

### 13.1 术语表

| 术语 | 含义 |
|---|---|
| **DetectedField** | 扫描器从页面抽出的一个字段对象（含 selector、label、约束、provenance）|
| **EventContext** | 一次报名的元数据：活动名 / 主题 / 主办方 / 地点 / 截止时间 / 链接 |
| **QARecord** | 一次报名的完整 Q&A 记录，存到 IndexedDB + 导出 markdown |
| **QAPair** | 一条字段问答（fieldLabel + finalValue + aiDraft + userAction） |
| **RAG** | Retrieval-Augmented Generation。V1 用 keyword overlap，V0.4+ 候选 embeddings |
| **chunk** | 切块后的文本片段（约 500 字符）；sourceType='document' 或 'qa' |
| **provenance** | 字段被扫到的"出处溯源"信息，用于 UI 上的 FieldExplainer |
| **LLMConfig** | V2.2 引入的配置 bundle：provider + model + key + baseURL + displayName |
| **OpenAI-Compatible** | 任何遵循 OpenAI `/v1/chat/completions` 协议的 LLM 端点（含 DeepSeek/Moonshot/GLM/豆包/通义/OpenAI 本家/自部署 vLLM/Ollama） |
| **tabSession** | chrome.storage.session 的命名空间，保存 sidepanel 当前 tab 的工作流状态 |
| **AsyncButton** | V2 引入的统一异步按钮组件（idle/busy/done/error 四态 + 内置超时） |
| **FieldExplainer** | V2 引入的字段来源展示组件（"为什么扫到这个字段?"） |

### 13.2 关键文件清单

```
src/
├── entrypoints/
│   ├── background.ts                      Service worker + 消息路由 + LLM 调用 + DB 读写
│   ├── popup/App.tsx                       项目快速预览
│   ├── sidepanel/App.tsx                   3 步报名工作流
│   └── options/App.tsx                     项目档案 + 经验库 + 设置 + 备份
├── lib/
│   ├── db/
│   │   ├── schema.ts                        Dexie schema v5
│   │   └── types.ts                         所有 domain 类型
│   ├── llm/
│   │   └── provider-catalog.ts              V2.2 — 8 个 Provider 预设
│   ├── claude/
│   │   ├── client.ts                        callLLM dispatcher + Anthropic/OpenAI 双 SDK
│   │   └── prompts.ts                       System prompt + batch prompt builder + 容错 JSON parser
│   ├── crypto/
│   │   └── secure-storage.ts                PBKDF2 + AES-GCM + session 恢复
│   ├── fields/
│   │   └── field-scanner.ts                 字段扫描核心（含 provenance / Shadow DOM / drop-zone）
│   ├── rag/
│   │   └── retrieval.ts                     keyword-overlap RAG (V1)
│   ├── markdown/
│   │   └── qa-writer.ts                     Q&A 记录导出
│   ├── messages/
│   │   └── types.ts                          消息总线 schema
│   ├── parsers/
│   │   └── index.ts                          PDF/DOCX/MD/TXT 解析
│   └── state/
│       └── session-state.ts                 useTabSessionState hook
└── components/
    ├── AsyncButton.tsx
    ├── ErrorToast.tsx
    ├── StatusBadge.tsx
    ├── FieldExplainer.tsx
    └── ModelPicker.tsx                       V2.2 后只用于 sidepanel 临时模型切换
```

### 13.3 决策记录引用

| 决策 | 文档 |
|---|---|
| 为什么自托管而不上 Web Store | `iteration-vault/2026-05-19-ai-application-autofill/03-adr.md` |
| 为什么用 IndexedDB 而不是后端 | 同上 |
| 为什么 V1 用 keyword overlap 而不是 embeddings | 同上 |
| V2 UX 改造决策路径 | `iteration-vault/2026-05-23-ux-optimization/05a-ux-design.md` |
| 多 Provider 数据模型选择 | 本文 §6.2 + §9 V2.2 |

### 13.4 已交付 vs 计划对照表

| 模块 | 子能力 | V1 | V2 | V2.1 | V2.2 | V2.3 |
|---|---|---|---|---|---|---|
| 项目档案 | CRUD | ✅ | | | |
| | 文档上传 / RAG 索引 | ✅ | | | |
| | 资产上传 | ✅ | | | |
| 字段扫描 | 标准 HTML | ✅ | | | |
| | ARIA 单/复选 | ✅ | | | |
| | Shadow DOM | | | | ✅ |
| | Drop-zone heuristic | | ✅ | | |
| | MAX_LENGTH 17 模式 | | ✅ | | |
| | Provenance | | ✅ | | |
| | **native 单/复选**（手写表单）| | | | | ✅ |
| | **纯文本节点行标签** | | | | | ✅ |
| | **自定义 JS 上传字段** | | | | | ✅ |
| 事件检测 | meta 兜底 | ✅ | | | |
| | Claude / OpenAI 抽取 | ✅ | | ✅ | |
| | Semantic page extraction | | ✅ | | |
| | 置信度横幅 | | ✅ | | |
| AI 生成 | 流式 | ✅ | | | |
| | 长度重试 | ✅ | | | |
| | Fallback (Haiku) | ✅ | | | |
| | Batch (3 字段/调用) | | ✅ | | |
| | 429 backoff | | ✅ | ✅ | |
| | 多 Provider | | | ✅ | ✅ |
| 填入 | React-form setter | ✅ | | | |
| | DataTransfer (file) | ✅ | | | |
| | 失败逐字段标记 | ✅ | | | |
| UX | AsyncButton | | ✅ | | |
| | ErrorToast | | ✅ | | |
| | FieldExplainer | | ✅ | | |
| | tabSession 持久化 | | ✅ | | |
| 经验库 | QA Markdown 导出 | ✅ | | | |
| | RAG 反哺 | ✅ | | | |
| | 列表 / 删除 | | ✅ | | |
| 备份 | 导出 / 导入 | | ✅ | | |
| 设置 | 主密码 + key 加密 | ✅ | | | |
| | 2-key 槽 | | | ✅ | |
| | LLMConfig 库 | | | | ✅ |
| | Onboarding 多 Provider | | | | ✅ |

---

## 14. 维护备忘

- 本 PRD 每次主版本迭代必须更新（V2.3 / V3.0 等）
- 每加一个 Provider preset：附录 13.4 + §4.4 + §13.1 同步
- 每加一个表单扫描能力：§5 + §13.4 + 字段扫描器单测同步
- 每改 IndexedDB schema：§6 + `lib/db/schema.ts` migration + tests 三件套

> **PRD 末页** —— 有问题请联系 PM jayyangstudy@gmail.com
