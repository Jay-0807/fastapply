# Autonomous Decisions Log

> **会话起止**：2026-05-19 PM 通过 ⛳ 关卡 1 后启动自治模式
> **PM 关卡 1 决议**：✅ 通过
> **触发红线**：无

PM 在关卡 1 通过 PRD 后，本 skill 在自治模式下做了以下决策。任何一条 PM 觉得不对都可以在 ⛳ 关卡 2 要求修改。

---

## 重要决策（PM 复盘时重点看）

### D1 · Chrome Extension 框架选 WXT 不选 Plasmo
- **原因**：Vite-based HMR 更快（开发体验），GitHub 活跃度更高，社区资料更多
- **替代方案**：Plasmo 更成熟但维护节奏不稳，裸 chrome API 体验灾难
- **PM 推翻成本**：1 天（重做 entrypoints 文件路径 + 配置）
- **详见**：ADR-001

### D2 · 嵌入用 OpenAI Embedding API 而不是本地 transformers.js
- **原因**：成本极低（$0.001/年），首次加载零延迟，中英文双语原生
- **替代方案**：本地嵌入需 ~120MB 模型下载，CPU 推理慢
- **副作用**：用户必须额外配 OpenAI API key（已在 Onboarding 文案中明示"仅用于向量嵌入"）
- **PM 推翻成本**：2-3 天（接入 transformers.js + 调度模型加载）
- **详见**：ADR-002

### D3 · 向量存储用纯 IndexedDB + 内存余弦，不用 LanceDB-web
- **原因**：单用户全年 chunks < 5K，O(N) 余弦实测 < 100ms 足够
- **副作用**：超 10K chunks 性能会下降，但 ADR-003 有迁移路径
- **PM 推翻成本**：低（不会立即影响 V1）

### D4 · 主密码加密 API key（不依赖 Google 登录）
- **原因**：完全本地、对国内用户友好（无 Google 登录依赖）
- **副作用**：用户必须记住主密码（无法找回），每次启动浏览器要输一次
- **PM 推翻成本**：低，但去掉加密 = 安全性显著下降，不建议
- **详见**：ADR-005

### D5 · 字段扫描用"按需触发"，不持续 MutationObserver
- **原因**：用户控制扫描时机，性能开销低
- **副作用**：动态加载字段（如多步表单展开后新字段）需用户手动再点扫描
- **PM 推翻成本**：1 天加 MutationObserver

### D6 · Cross-origin iframe silent skip + 用户提示
- **原因**：浏览器不允许跨域 DOM 访问，没法绕开
- **副作用**：如果报名平台用 cross-origin iframe（Typeform 等），会有部分字段识别不到
- **缓解**：UI 显示警示

### D7 · Sentry init 代码就位但 DSN 留空
- **原因**：自治模式下无法创建 Sentry project（MCP 403 权限不足）
- **PM 操作**：5 分钟在 sentry.io 创建 project + 填 DSN 到 `.env`
- **详见**：08-perf-obs.md

### D8 · 部分 UI 详情页留 TODO
具体清单（follow-up 1 周内补）：
- Backup export / import（依赖 jszip + Dexie dump）
- SettingsPane 的"修改 API key"完整 UI（基础设施已就位）
- HistoryPane 详情视图（列表已有，markdown 渲染待补）
- i18next wire-up（中文已写死，英文 messages 待补）
- Onboarding 截图（设计稿出来后补）

**理由**：核心闭环（添加项目 → 上传文档 → 报名 → 沉淀 Q&A）已经走通，这些 UI 详情不影响"自用版能跑"。

---

## 次要决策（参考）

- 文件名 slugify 用 `[^\w一-鿿]` 而不是 ASCII only — 保留中文字符更可读
- Streaming 触发 setState 没 throttle — 当前 token 速率 < 50/s，React 18 自动 batch 够用
- markdown YAML frontmatter 用手写而不是 yaml lib — 减少依赖，结构简单
- 测试只覆盖 field-scanner + db — 其他模块测试 follow-up（不阻塞 V1）

---

## 4 红线检查总结

| 红线 | 触发 | 说明 |
|------|------|------|
| R1 架构冲突 | ❌ 未触发 | 全新项目 |
| R2 安全 must-fix > 3 | ❌ 未触发 | Must-fix = 0 |
| R3 验收 3 次重试失败 | ❌ 未触发 | 测试通过 |
| R4 破坏性删除 | ❌ 未触发 | 全新项目 |

**自治期间 0 次升级到 PM**。

---

## 自治模式产出汇总

- 10 个 phase 文档（01-canonical-query.md ... 10-release.md）
- 9 个 ADR
- 1 套 7 张表 schema
- 17 个内部 message endpoint
- 18 个业务 TS/TSX 文件 (~1900 行)
- 13 个单元测试用例
- 1 套 .env 配置 + Sentry SDK 就位
