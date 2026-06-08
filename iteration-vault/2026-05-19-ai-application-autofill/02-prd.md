# 02 · PRD — AI 活动报名自动填写 Chrome 插件

> **代号**：`ApplyForge`（暂定，可改）— "锻造你的每一次申报"
> **版本**：v1.0 (PRD)
> **日期**：2026-05-19
> **PM**：jayyangstudy@gmail.com
> **状态**：⛳ 待 PM 关卡 1 确认

---

## 一句话价值陈述

> **把每次活动报名从 1-2 小时降到 10-15 分钟，并让 AI 通过 Q&A 历史库越用越懂你的项目和申报风格。**

---

## 1. 用户故事（User Stories）

### 🎯 Happy Path #1：第一次使用，填一个黑客松报名

```
作为 PM
我打开 Devpost 的某个黑客松报名页
我点击插件图标，弹出"准备填表"面板

第一次使用：
  插件提示我"先创建你的第一个项目档案"
  我点"新建项目"，输入项目名"Firefly OS"
  上传 3 份 PDF：BP、产品介绍、技术架构图
  插件在后台解析 + 嵌入这 3 份文档（< 2 分钟）

填表：
  插件 AI 推断了活动背景：
    主题：AI Agent Hackathon
    主办方：Devpost
    地点：Online (Global)
    我点"确认"

  插件扫描页面，识别出 12 个字段，标记每个字段的：
    - 标签语义（如"项目名" / "Project Name"）
    - 约束（如 maxlength=100, required, placeholder="Brief one-liner"）
    - 类型（text / textarea / select）

  我点"AI 生成所有草稿"
  插件 streaming 显示每个字段的草稿（基于 Firefly OS 项目档案 + 活动是 "AI Agent" 主题）
  我看 12 个草稿，4 个直接采纳，6 个微改，2 个重写

  我点"一键填入页面"，所有答案填到页面对应字段
  我在 Devpost 上点最终的"Submit"按钮（插件不替我提交）

报名完成后：
  插件自动保存这次的 Q&A 到本地：
  `~/applyforge/firefly-os/2026-05-19-devpost-ai-agent-hackathon.md`
  包含：活动背景 + 12 个字段的 Q + AI 草稿 + 我的最终版本
```

### 🎯 Happy Path #2：第 10 次使用，填类似活动

```
作为 PM
我打开另一个 AI 加速器的报名页
点插件图标

插件 AI 推断活动背景：AI Accelerator / 杭州 / 阿里达摩院
我确认

扫描字段，发现 8 个字段
点"AI 生成草稿"

这次插件不只参考项目档案，还参考了：
  - 历史 Q&A 经验库里 3 份类似活动的我的回答
  - 我之前的"修改模式"（哪些表达我喜欢用、哪些我会删掉）

8 个草稿里 6 个直接采纳，1 个微改，1 个重写
比第一次快了 3 倍

UI 上每个草稿旁边标了"参考了 2026-05-19 的 Devpost 报名（85% 相似）"
```

### ⚠️ Edge Case #1：字段约束被 AI 草稿违反

```
表单某字段的 helper text 是"500 字以内"
插件解析出 maxlength=500
AI 生成的草稿 620 字

插件检测违反约束 → 自动 retry 生成（带强提示"必须 ≤ 500 字"）
若 retry 后仍违反 → 用 Claude Haiku 做截断
若 Haiku 也失败 → 在 UI 上标红：⚠️ 超出长度，需手动修改
绝不一键填入违反约束的内容
```

### ⚠️ Edge Case #2：Claude API 失败/超时/限流

```
插件检测到 API 调用失败
立即降级到"手动填写模式"：
  - 字段识别仍生效（可用）
  - PM 手动填每个字段
  - 仍能保存 Q&A markdown 到本地
显示醒目提示："Claude API 暂时不可用，已切换到手动模式"
```

### ⚠️ Edge Case #3：未识别的复杂字段（如 file upload / multi-step）

```
插件遇到 <input type="file"> 或多步表单
明确告知 PM："这个字段需要你手动上传/操作"
不尝试模拟 — 但仍可记录到 Q&A markdown（"已上传：BP.pdf"）
```

---

## 2. 验收标准（Acceptance Criteria — Binary Checklist）

V1 上线（自用版）必须通过所有项：

### 安装与基础
- [ ] 用 `wxt build` 或 `plasmo build` 能产出可加载的 unpacked extension
- [ ] 在 Chrome 中加载后图标显示正常、popup 能打开
- [ ] 首次安装显示 onboarding（让 PM 输入 Anthropic API key + 创建首个项目）

### 项目档案管理
- [ ] 能新建至少 1 个项目，含名称、描述、标签
- [ ] 能上传 PDF / DOCX / MD / TXT 文档（≥ 3 份），文件 ≤ 10MB
- [ ] 文档解析成功率 ≥ 90%（PDF.js + mammoth.js 抓得到文字）
- [ ] 解析后的文本被切分（chunk size 500-1000 tokens，overlap 100）+ 嵌入（向量化）+ 存 IndexedDB
- [ ] 项目可编辑 / 删除 / 切换

### 活动背景填写
- [ ] 打开任意网页时点插件，能"提取页面元信息"作为活动背景推断（title, h1, og:image, og:description）
- [ ] AI 推断字段：活动名 / 主题 / 地点 / 主办方 / 链接 / 截止时间（≥ 4/6 字段命中）
- [ ] PM 可在弹窗中修改任意字段
- [ ] 活动背景保存后作为后续 prompt 的强 context

### 表单字段识别
- [ ] 能识别页面上 `<input>`, `<textarea>`, `<select>` 元素
- [ ] 对每个字段提取：label（含 `<label for=>` / aria-label / 父级文本启发）/ placeholder / maxlength / required / pattern / type / helper text（aria-describedby）
- [ ] 在 ≥ 2 个真实平台（金数据 + Devpost）字段识别率 ≥ 80%
- [ ] 中文 + 英文 label 都能识别

### AI 草稿生成
- [ ] 调用 Claude Sonnet 4.5（默认）或 Haiku 3.5（快速模式）
- [ ] Prompt 包含：项目档案 RAG chunk（top-5）+ 历史 Q&A 经验库 chunk（top-3）+ 活动背景 + 字段约束
- [ ] 字数约束强制：超长则 retry，retry 失败则截断（不静默失败）
- [ ] Streaming UI：草稿生成时实时显示，不是等全部完才显示
- [ ] 每个草稿旁可显示"来源"（哪些项目文档 chunk + 哪些历史 Q&A 被 RAG 召回）

### 填入与覆盖
- [ ] "一键全部填入" → 把所有 AI 草稿写入页面对应字段
- [ ] 单字段"重新生成"按钮
- [ ] 单字段手动编辑（编辑后用户版本 override AI 草稿）
- [ ] 填入后页面 input 触发标准 `input` + `change` 事件（让原页面 React/Vue 框架感知）

### Q&A 经验沉淀
- [ ] 报名完成（用户主动点"我已提交"按钮）后，自动生成 markdown 文件
- [ ] 文件命名：`<项目名>-<活动名>-<YYYY-MM-DD>.md`
- [ ] 内容含：活动背景元数据 / 12-N 个 Q&A 对 / AI 草稿版本 / 用户最终版本 / 字段约束记录
- [ ] 文件保存到本地（chrome.downloads API → 用户指定目录，默认 `~/Downloads/applyforge/<项目>/`）
- [ ] 同时存入 IndexedDB 索引，向量化以备 RAG 召回

### RAG 检索
- [ ] 项目档案 chunks + Q&A 历史 chunks 都进同一个向量索引
- [ ] 生成草稿时检索 top-5 项目档案 + top-3 历史 Q&A
- [ ] UI 可视化"AI 参考了哪些资料"
- [ ] 检索延迟 < 500ms

### 数据隐私
- [ ] 所有数据存 IndexedDB（不出本地）
- [ ] Claude API key 加密存 chrome.storage.local（用 Web Crypto API + 用户密码派生 key）
- [ ] 仅在调用 Claude API 时传输项目数据，且明示
- [ ] 提供"导出全部数据"按钮（ZIP，含 markdown + JSON）
- [ ] 提供"清空所有数据"按钮（重置插件）

---

## 3. 非功能性要求（NFR）

| 维度 | 要求 | 备注 |
|------|------|------|
| **性能 - 单字段** | Sonnet 生成 P50 < 8s, P95 < 15s | 用 streaming，PM 感知更快 |
| **性能 - 字段识别** | 单页面 100 个字段识别 < 500ms | DOM 操作要节流 |
| **性能 - 文档解析** | 单份 10MB PDF < 30s | 在 Service Worker 跑，不阻塞 UI |
| **性能 - RAG 检索** | top-K 检索 < 500ms | 本地向量搜索，<10K chunks |
| **隐私** | 所有数据本地，**只有 API call 出本地** | 用户数据是商业敏感 |
| **安全** | API key 加密 / API 调用 HTTPS only | OWASP LLM Top 10 自查 |
| **可用性** | API 挂掉降级到手动模式 | 不让插件完全瘫痪 |
| **可访问性** | UI 中英双语 / 键盘可导航 / 对比度 WCAG AA | i18n + a11y 基本款 |
| **可观测性** | Sentry 接入捕获前端异常 + Claude API 错误 | 自用版本也要看错误 |
| **兼容性** | Chrome 110+ MV3 | Edge 也能用（同基座）但不官宣 |

---

## 4. 依赖项

### 第三方 API
- **Anthropic Claude API**（**必须**）— Sonnet 4.5 主用 + Haiku 3.5 备用
- （二选一）OpenAI Embedding API 用 `text-embedding-3-small`（$0.02/M tokens，极便宜）
- （或）transformers.js 本地嵌入模型（`Xenova/multilingual-e5-small`，零成本但慢）

### 开发依赖
- Node.js 20+
- pnpm（推荐）或 npm
- **WXT** 或 **Plasmo** — Chrome Extension 框架（Phase 3 ADR 决定）
- **React 18** + **TypeScript 5**
- **TailwindCSS** + **shadcn/ui** —UI 套件
- **pdf.js** — PDF 解析
- **mammoth.js** — DOCX 解析
- **@anthropic-ai/sdk** — Claude 接入
- **Dexie.js** — IndexedDB ORM
- **Zustand** — 状态管理（轻量）

### 特性 flag
- `feat:claude-haiku-fallback`（默认 on）
- `feat:auto-detect-event-context`（默认 on）
- `feat:qa-history-rag`（默认 on）

---

## 5. 测量指标

### 工程指标（每次发布都看）
- Sentry 错误率：< 1% 会话
- Claude API 错误率：< 5%
- 字段识别成功率：在 5 个测试平台上 ≥ 80%

### 产品指标（自用 1 个月后看）
- **核心指标**：单次报名耗时 < 20 min（从 1-2h 降下来）
- **核心指标**：AI 草稿采纳率（直接用 + 微改）≥ 70%
- **核心指标**：经验库收敛度 — 第 10 次报名采纳率 vs 第 1 次报名采纳率 +20%
- **辅助指标**：主观满意度（自评 1-10）≥ 8

### 不看的指标
- DAU / WAU（自用，无意义）
- 转化率 / 留存（无意义）

---

## 6. Out of Scope（明确不做）

- ❌ 上 Chrome Web Store
- ❌ 多用户 / 账号体系 / 团队功能
- ❌ 云端同步（仅本地 IndexedDB）
- ❌ OpenAI / DeepSeek / 通义 / 智普 / Gemini（仅 Claude）
- ❌ Firefox / Edge / Safari（仅 Chrome，虽然技术上可能也跑得起来）
- ❌ 移动端
- ❌ 多步表单 / 复杂条件跳转 / 验证码识别
- ❌ 自动提交（始终需 PM 主动点提交）
- ❌ PDF 原生表单（仅 Web）
- ❌ 协作 / 评论 / 审批流
- ❌ 国际化的多语言切换（V1 默认中文 UI，英文文本作为字符串预留 i18n）

---

## 7. 关键风险 + 缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| **R1 字段识别失败率高** | 致命 — 用户体验崩盘 | Phase 7 必须在 5 个真实平台测过 ≥ 80% 准确率才发版 |
| **R2 Claude API 月成本超支** | 中 — 个人付费 | 默认 Haiku 模式（$1/M input），Sonnet 仅 PM 主动切换 |
| **R3 历史 Q&A "AI 越用越烂"** | 中 — RAG 召回坏样本 | UI 提供"标记此次回答为不要再参考"按钮，污染数据可剔除 |
| **R4 IndexedDB 数据丢失** | 高 — 历史经验库消失 | 提供"导出全量备份" + 定期提醒导出 |
| **R5 Anthropic API key 泄露** | 高 — 财务损失 | Web Crypto API 加密 + 不在日志输出 |
| **R6 字段约束没识别到** | 中 — 草稿超长 | helper text 多源识别（aria-describedby + 兄弟 div + maxlength 属性），retry 机制兜底 |
| **R7 同一字段重复点"重生成"刷 token** | 低 — 成本 | UI 加 rate limit（5s 内只能 retry 一次） |

---

## 8. 里程碑（建议）

| 阶段 | 周数 | 关键产出 |
|------|------|---------|
| Phase 1-2：澄清 + PRD | 第 1 周（已完成大部分） | canonical query + PRD ✅ |
| Phase 3-5：ADR + UI + Schema/API | 第 1-2 周 | 架构决策 + UI 设计 + 数据模型 |
| Phase 6：实施 | 第 2-3 周 | 前端 UI + 字段识别 + Claude 接入 + RAG |
| Phase 7：测试 + 代码债 + 安全 | 第 3 周 | Playwright E2E + 9 维代码债审查 + OWASP LLM 自查 |
| Phase 8：性能 + Sentry | 第 4 周 | Sentry 接入 + 性能优化 |
| Phase 9-10：审查 + 发布 | 第 4-5 周 | 代码审查 + Release v1.0 + ⛳ PM 关卡 2 |

总计 **3-5 周**，PM 仅在 ⛳ 关卡 1 + ⛳ 关卡 2 接触两次。

---

## 9. 我们和 Claude for Chrome / 其他方案的关键差异

| 维度 | Claude for Chrome | Magical / Simplify | ApplyForge（本插件） |
|------|-------------------|---------------------|---------------------|
| 字段约束感知 | ❌ 实测看不到 | 部分 | ✅ 完整解析 + retry |
| 项目档案 RAG | ❌ 无持久化 | ❌ 只有简历字段 | ✅ 多文档 + 经验库双源 RAG |
| 活动背景驱动 | ❌ 无 | ❌ 无 | ✅ 主题/地点/主办方 → 不同答案 |
| 经验库越用越准 | ❌ 无 | ❌ 无 | ✅ Q&A markdown 自动沉淀 |
| 隐私 | 云端 | 云端 | ✅ 本地 IndexedDB |
| 成本 | $20+/月订阅 | $20+/月订阅 | API 按量（估算 $5-10/月） |
| 中文支持 | 一般 | 弱 | ✅ 原生 |
| 自动提交 | 默认会 | 默认会 | ✅ 明确不做（PM 始终在 loop） |

---

## 10. 开放问题（PRD 阶段无需立即决，留给 ADR 阶段）

这些问题在 Phase 3 ADR 会逐个决策：

1. **WXT vs Plasmo** 框架二选一（两者都现代但差异不小）
2. **嵌入模型**：OpenAI Embedding API（便宜稳定）vs transformers.js 本地（零成本但 600MB 模型）
3. **向量存储**：纯 IndexedDB + 余弦（< 5K chunks 够用）vs LanceDB-web/Pglite（更专业）
4. **Q&A markdown 落盘方式**：chrome.downloads（每次下载文件）vs File System Access API（直接写到目录）
5. **API key 加密的密码派生**：用户每次启动输密码？还是用 chrome.identity 关联？

---

## ⛳ PM 关卡 1

请审阅 PRD：
