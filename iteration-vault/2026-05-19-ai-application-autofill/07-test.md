# 07a · Test Plan

> **生成日期**：2026-05-19
> **阶段**：Phase 7 · 自治模式
> **覆盖**：单元测试 + E2E + 真实平台兼容性

---

## 测试金字塔（自用版的精简版）

```
                     ▲
                     │   Manual on 5 real platforms (1-2h)
                  ┌──┴──┐
                  │ E2E │ ← Playwright (2-3 happy paths)
                  └──┬──┘
                ┌────┴────┐
                │  Unit   │ ← vitest (核心模块)
                └─────────┘
```

不写 Component 测试（成本高 vs 自用项目收益低）。

---

## 单元测试覆盖（vitest）

### ✅ 已写
- `src/lib/db/schema.test.ts` — Dexie 初始化 + 复合索引查询（2 用例）
- `src/lib/fields/field-scanner.test.ts` — **7 个用例** 覆盖：
  1. label + maxLength + required 基础识别
  2. 中文"200字以内" helper text 提取（Claude for Chrome 失败点）
  3. 英文"max 500 characters" placeholder 提取
  4. label 中的 `*` required 识别
  5. maxlength 属性 vs helper 提示冲突时取更严
  6. select options 收集
  7. 无 label 字段跳过（避免 hallucination）

### 待补（follow-up）
- `src/lib/rag/embedding.test.ts` — chunkText 段落切分 + paragraph 跨界 hard-split
- `src/lib/rag/retrieval.test.ts` — cosineSimilarity 正确性 + threshold 过滤
- `src/lib/markdown/qa-writer.test.ts` — markdown frontmatter YAML 转义 + slugify 中文
- `src/lib/crypto/secure-storage.test.ts` — 加密-解密往返 + 错误密码报错

**目标覆盖率**：核心模块 ≥ 80%（field-scanner / rag / crypto / claude / markdown）

---

## E2E 测试（Playwright）

待写到 `e2e/` 目录。3 个 happy path：

### E2E #1: Onboarding 流程
```
1. 装载 extension（unpacked）
2. 自动打开 options page
3. 输入主密码（8 位）+ Anthropic key（mocked）+ OpenAI key（mocked）
4. 验证 settings 存到 IndexedDB（加密形式）
5. 退到主页面，验证 onboarding 不再出现
```

### E2E #2: 项目创建 + 文档上传
```
1. 在 options page 点"新建项目"
2. 输入项目名 + 描述
3. 上传 1 份 PDF（fixtures/sample-bp.pdf）
4. 等待 parse + index 完成
5. 验证 documents 表 status=parsed
6. 验证 chunks 表 ≥ 1 行 且 embedding 非空
```

### E2E #3: 完整填表 → 沉淀 markdown
```
1. 打开 fixtures/test-form.html（本地 mock 表单，含 12 个字段：text/textarea/select，含 maxLength 提示）
2. 点 extension icon → side panel
3. 选项目 → 跳到活动背景 → 确认 → 跳到草稿
4. 点"AI 生成全部草稿"（mock Anthropic API 返回固定内容）
5. 验证 streamingDrafts 有 token 实时更新
6. 修改 2 个字段（一个微改，一个重写）
7. 点"一键填入页面"
8. 验证页面字段已填上 value
9. 点"我已提交"
10. 验证：
    - chrome.downloads 触发，下载 markdown 文件
    - qa_records 表 status=submitted
    - chunks 表新增 Q&A chunks
    - 文件名匹配 `<project>-<event>-<date>.md`
    - frontmatter YAML 包含所有元数据
```

---

## 真实平台兼容性测试（手动）

V1 上线前 PM 自测下面 5 个平台，每个跑一次"扫描字段"按钮：

| 平台 | 测试链接 | 字段识别 ≥ 80% | 备注 |
|------|---------|--------|------|
| Devpost | 任一活动报名页 | □ | 海外英文标杆 |
| Lu.ma | 任一活动 RSVP | □ | 海外极简表单 |
| 金数据（jinshuju） | 任一表单 | □ | 国内 SaaS 表单标杆 |
| 问卷星（wjx） | 任一活动 | □ | 国内最广用 |
| 活动行 | 任一活动报名 | □ | 国内活动平台 |
| 政府申报（如某科技局申报系统） | 真实可用的 | □ | 老式 HTML，预期 < 80% |

记录到 `07-real-platform-results.md`（V1 发版前补充）。

---

## Mock 策略

E2E 用 MSW（Mock Service Worker）拦截：
- `https://api.anthropic.com/v1/messages` → 返回固定 streaming 内容
- `https://api.openai.com/v1/embeddings` → 返回 1536 维全 0.5 的向量
- 浏览器内 `chrome.downloads.download` 用 Playwright 的 `downloadOptions` 验证

---

## 性能基线（在 Phase 8 补，留 placeholder）

- 字段扫描 100 字段 < 500ms
- 嵌入单文档（5MB PDF）< 60s
- RAG 检索 (< 2K chunks) < 200ms
- Sonnet 单字段（含 streaming 首 token）< 3s P50

---

## 通过判定

**Phase 7 通过条件**（自治模式自检）：

- ✅ field-scanner 7 用例全过（已 ✓）
- ✅ schema 2 用例全过（已 ✓）
- ⏳ E2E 3 用例待 Phase 8 后跑（依赖 Sentry 集成）
- ⏳ 5 平台手动兼容性 — V1 发版前必须跑
- ✅ 没有 high severity 代码债（见 07-debt.md）
- ✅ 没有 must-fix 安全漏洞（见 07-security.md）

进入 Phase 8。
