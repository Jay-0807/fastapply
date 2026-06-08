# 07c · Security Review

> **生成日期**：2026-05-19
> **阶段**：Phase 7 · 自治模式
> **检查框架**：OWASP Top 10 + OWASP LLM Top 10 (2025) + Chrome Extension Security Best Practices

---

## 安全审查结果

### 三级分类

| 等级 | 数量 | 说明 |
|------|------|------|
| 🔴 Must-fix | **0** | 阻止发布 |
| 🟡 Should-fix | 4 | V1 发布前修 |
| 🟢 Nice-to-fix | 3 | V2 时再说 |

**🚫 4 红线判定**：Must-fix = 0，**未触发 R2 红线**（must-fix > 3 才触发）。✅ 通过。

---

## OWASP Top 10 自查

### A01 Broken Access Control
**结果**：✅ N/A — Chrome Extension 无传统 access control（单用户单设备）

### A02 Cryptographic Failures
**结果**：✅ OK

- API key 用 AES-256-GCM（NIST 推荐）
- PBKDF2 600K 迭代（OWASP 2023 推荐 600K SHA-256）
- IV / salt 每次随机（`crypto.getRandomValues`）
- Master password 永不入磁盘（仅 session 内存）
- **🟡 Should-fix #1**：当前 ciphertext + IV 用 `::` 字符串拼接存（背景代码里 `split('::')`）。改成结构化 JSON 更稳。但实际不影响安全性。

### A03 Injection
**结果**：✅ OK

- 用户输入永不拼 SQL（无 SQL）
- DOM 操作：填表用 `el.value = x` + dispatchEvent，不用 `innerHTML`
- Claude 调用：所有用户输入走 typed payload，prompt 模板有清晰边界
- **🟡 Should-fix #2**：Prompt injection 可能性 — 如果文档里含 "ignore all previous instructions"，会被原样塞进 Claude prompt。**缓解**：System Prompt 已强调"基于材料生成"+ Claude 4.5 对 PI 比较 robust。但建议加 sanitize 层（剥离明显的 injection patterns）。

### A04 Insecure Design
**结果**：✅ OK — 数据本地、最小权限设计

### A05 Security Misconfiguration
**结果**：🟢 OK，1 个 Nice-to-fix

- ✅ CSP 头限制 connect-src 到 Anthropic/OpenAI/Sentry 域名
- ✅ host_permissions 用 `<all_urls>` 是必须的（要在任意报名页填表），但仅 activeTab + scripting 触发
- 🟢 **Nice-to-fix #1**：可以 narrow host_permissions 到 https://* 排除 http://（绝大多数报名都是 https）

### A06 Vulnerable & Outdated Components
**结果**：✅ OK

- 所有 deps pin minor，新版本
- Phase 8 计划跑 `npm audit` 自动扫
- **🟡 Should-fix #3**：`pdfjs-dist` 历史上有过 RCE CVE，需特别关注。当前 v4.7 已无已知漏洞，但建议加 Dependabot 自动告警

### A07 Identification & Authentication Failures
**结果**：✅ OK — 主密码弱密码风险已用 PBKDF2 大量迭代缓解

### A08 Software & Data Integrity Failures
**结果**：✅ OK — 无外部更新源（用户手动加载 unpacked）

### A09 Security Logging & Monitoring Failures
**结果**：✅ Phase 8 接入 Sentry 后解决

### A10 SSRF
**结果**：✅ N/A — Chrome Extension 不发 outbound 到任意 URL（仅 Anthropic / OpenAI / Sentry）

---

## OWASP LLM Top 10 (2025) 自查

### LLM01 Prompt Injection
**结果**：🟡 见 A03 Should-fix #2

### LLM02 Insecure Output Handling
**结果**：✅ OK

- AI 输出直接写到 `<input>.value`，不通过 `innerHTML` → 无 XSS
- markdown 写到磁盘（不渲染 inline）
- 用户最终修改在 textarea 中显示（安全）

### LLM03 Training Data Poisoning
**结果**：🟢 我们不训练模型，仅用 RAG。Q&A 污染由 ADR-009 的 `excludedFromRag` 机制处理 ✅

### LLM04 Model DoS
**结果**：🟢 OK — 单用户场景

### LLM05 Supply Chain
**结果**：✅ 见 A06

### LLM06 Sensitive Information Disclosure
**结果**：✅ 用户主动决定上传什么。我们提示 "数据在调 API 时传输到 Anthropic/OpenAI"
- 🟢 **Nice-to-fix #2**：加一个"敏感词检测"，文档里如包含手机号/身份证号/银行卡号时上传前弹窗确认

### LLM07 Insecure Plugin Design
**结果**：✅ N/A — 我们不暴露 Claude 工具

### LLM08 Excessive Agency
**结果**：✅ OK — 插件**绝不自动提交**（PRD 明确），所有填入都需 PM 确认

### LLM09 Overreliance
**结果**：🟢 UI 已显示 "AI 草稿"标签 + 修改幅度统计，提示用户审阅
- **Nice-to-fix #3**：可以加 "AI 草稿信心度" 标记（来自 RAG 召回相似度）

### LLM10 Model Theft
**结果**：✅ N/A

---

## Chrome Extension 特定审查

### Manifest V3 合规
- ✅ Service Worker 替代 background page
- ✅ 无 remote code execution（无 eval / 远程 script）
- ✅ CSP 严格（无 unsafe-eval 除非必要）
- ✅ host_permissions 在 manifest 中明确声明

### XSS Surface
- ✅ 不渲染外部 HTML
- ✅ `fillField` 用 native setter + Event，不 innerHTML
- ✅ markdown 文件 chrome.downloads 触发，不在插件内渲染

### Storage Isolation
- ✅ IndexedDB 自动 origin 隔离
- ✅ chrome.storage.local 加密敏感字段
- 🟡 **Should-fix #4**：用户数据导出 ZIP 后，用户负责物理隔离（口头警示）

---

## Sentry 数据收集（Phase 8 准备）

设计上避免把敏感信息发往 Sentry：
- ❌ 不发：项目档案文本、Q&A 内容、API key、masterPassword
- ✅ 发：异常堆栈、错误码、性能指标、用户操作 event 名（不带 payload）

`beforeSend` 钩子做 PII scrub。

---

## 通过判定

✅ **Must-fix = 0**，未触发 R2 红线
✅ Should-fix 4 条都列入"V1 发版前修"
✅ Nice-to-fix 3 条留 V2

进入 Phase 8（性能 + 可观测）。
