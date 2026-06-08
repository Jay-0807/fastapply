# 验收报告 — 字段识别 LLM 语义提取混合管线（Phase 7）

> AutoDev 阶段 7 · autodev-verify 五层验证 · 2026-06-08
> 结论：**PASS（自动化层全绿；真机 UI 交互层留人工 dogfood，见 §4 限制）**

## 第 1 层 · 契约验收（对照 plan.md acceptance_criteria）

| Task | 能力 | acceptance | 验证方式 | 结果 |
|---|---|---|---|---|
| T1 | 共享类型 + provenance | compile / 类型对齐 | tsc | ✅ |
| T2 | 打标 tagger | 幂等 / opacity:0 / 跳 display:none / shadow / **无 afId 碰撞** | tagger.test（6 测试，含 BUG3 回归） | ✅ |
| T3 | 蒸馏 distill | afId 可查 / options / **不发已填值 BR12** / ≤120 / accept / **无 CE 串扰** | distill.test（6，含 BUG4 回归） | ✅ |
| T4 | LLM 提取 extract | callLLM 已导出 / prompt 规则 / 脏响应解析 / **null vs [] 语义** | extract.test（8） | ✅ |
| T5 | 回填 backfill | 防幻觉 BR4 / DOM 权威 BR3 / 敏感 BR5 / **ARIA options** | backfill.test（7） | ✅ |
| T6 | 缓存 scan-cache | 命中 / 失效 | scan-cache.test（3） | ✅ |
| T7 | 编排 orchestrate | **兜底 BR7** / **共识非误合 BR8** / **不缓存兜底 BUG1** / cache | orchestrate.test（7） | ✅ |
| T8 | scanMode + v6 迁移 | 缺省 heuristic / 不覆盖 / fresh no-op | schema.test（3 迁移测试） | ✅ |
| T9 | 注入 + 消息（方案B） | 注入返回契约 / heuristic 无回归 / bundle 含 helper | build + content bundle grep | ✅ |
| T9b | afId 一致性守卫 | tag/label 不一致跳过 BR13 | consistency.test（4） | ✅ |
| T10 | UI（R9/O1） | lucide / 来源徽章 / recall 条 / 边界 + 外发提示 | 静态审查（Code GAN 维度4） | ✅（O2 下拉后置） |
| T11 | recall 语料 | 5 fixture recall floor / hybrid≥heuristic | semantic-recall.test（6） | ✅ |

Code GAN：2 轮，Round1 测出 4 真 bug 全修，Round2 PASS。

## 第 2 层 · 红线扫描（6 条）

| 红线 | 结果 | 证据 |
|---|---|---|
| 1 禁占位 | ✅ | grep 无 TODO/FIXME/not-implemented；"placeholder" 命中均为 DOM 属性（真字段属性） |
| 2 禁 Mock | ✅ | 生产代码无 mock；仅单测在 callLLM 网络边界注入假响应（正当） |
| 3 禁降阶 | ✅ | R5/R7/R8 全实现；fixture 标 representative + 真实 recall 断言；无"先不做" |
| 4 禁过时 | ✅ | 零新增运行时依赖；复用 callLLM（0.30.1 稳定 API） |
| 5 优先复用 | ✅ | oss-scan 已扫；R3 复用 callLLM+容错解析、R6-R9 复用现有基建 |
| 6 禁 emoji 图标 | ✅ | 新增 JSX（SemanticSourceBadge/ScanMetaBar/ScanModeSettings）全 lucide-react，零 emoji（Code GAN 确认） |

## 第 3 层 · 静态检查

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型 | `pnpm compile`（tsc --noEmit，strict + exactOptionalPropertyTypes） | ✅ 0 error |
| Lint | `pnpm lint`（eslint --max-warnings 0） | ✅ 0 warning |
| 单测 | `pnpm test`（vitest） | ✅ **131 通过**（基线 79 + 新增 52） |

## 第 4 层 · 运行时验证

| 项 | 结果 |
|---|---|
| 构建 | `pnpm build` ✅ 2.93 MB（基线 2.91，+0.02，印证零新增依赖） |
| content bundle | ✅ `__applyforge_tag_distill__` + `data-af-id` 守卫已打进 content.js（方案 B 注入闭环验证） |
| ⚠️ 扩展 UI 真机交互 | **留人工**：Chrome MCP 驱动不了扩展自身 sidepanel/options（CLAUDE.md 约束）。需人工 reload 扩展后在真机点：Options 切换扫描模式 → 真实表单 hybrid 扫描 → 看 recall 条/来源徽章/兜底提示 → 一键填入（afId 守卫）。本轮验证了扫描器逻辑 + 注入 + 构建 + 131 单测。 |

## 第 5 层 · acceptance-testing（端到端）

- **自动化**：5 张代表性 fixture（HiCool 两列 / 上海 flat / 标准 label / Epic 按钮组 / 科大硅谷多步）recall 回归 + hybrid≥heuristic 非退化性质测试 + 131 单测覆盖全管线（打标→蒸馏→提取→回填→编排→缓存→守卫）。
- **真机 dogfood（留人工）**：真实表单的 recall 真值需人工真机测（与历史 V2.3-V2.8 dogfood 一致）；本功能默认 `scanMode='heuristic'`，发布即旧行为，灰度零风险。

## 阻塞判定

自动化五层全绿 → **不阻塞**，进入 7.5 Global GAN。真机 UI 交互层为已知约束（非缺陷），交付后人工 dogfood 验证（与项目历史一致）。
