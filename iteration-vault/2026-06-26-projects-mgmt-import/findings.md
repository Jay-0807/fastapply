# 深档案 — 项目管理 + 一键多格式导入 + 按项目归属（V0.4.1）

> 2026-06-26 · universal-coding-project-development-skill · 🐢 重型 lane · 单一权威源：铁律看 CLAUDE.md，产品真相看 PRD §9 V0.4.1。本档案只记**过程 + GAN 发现**。

## 一句话
真机 dogfood 暴露 3 个需求：① 项目删不掉（还创建了空项目）② 没有给普通用户的导入方式（只有 JSON 种子）③ 人员/经验库是全局大杂烩。一轮交付：项目删除（级联修复）+ 一键多格式 AI 导入（确认页）+ 人员/经验库按项目筛选。

## 3 个 PM 决策（关卡）
- 范围：三个一起一轮做完。
- #2 导入：AI 归类 → **确认页** → 才落库（符合"不盲信 LLM"铁律）。
- #3 人员模型：**可跨项目共享，视图按项目筛选**（many-to-many via `Project.memberIds`）。

## 交付
1. **项目删除**：`ProjectsPane` 每卡片「🗑删除」+ 带真实数量的二次确认。后端抽出 `src/lib/db/project-ops.ts deleteProjectCascade`（原 `projects.delete` **漏删 projectAssets → 孤儿资产**，本轮修）。`projectDeletionImpact` 供确认页数量。6 测试。
2. **一键多格式导入** `BulkImportWizard`（项目档案首页）：drop pdf/docx/**pptx/xlsx**/img/md/txt → 文本走 `parseDocument`、图片转资产候选 → 合并文本一次 `projectFacts.extract`（AI 归类 facts+人员）→ **确认页**（facts 可改 / 人员勾选 / 文件归类 / 目标项目）→ 落库（复用 projects/persons/documents/assets 消息）。pptx/xlsx 用 **jszip 轻量抽取**（避免 SheetJS 重依赖），`collectTagText`/`decodeXmlEntities` 纯函数可测。
3. **按项目归属**：`ProjectScopePicker` 共享筛选（OptionsApp 提升 `selectedProjectId`）；人员用**项目标签**管理归属（一人可属多项目）；经验库按 `QARecord.projectId` 过滤。

## GAN 实测（15 agent，4 视角 review→verify，10 confirmed，全修）
对抗式 review（data-integrity / async-react / parser-robustness / redlines）→ 每条独立 verify 复核 → 10 条 confirmed（去重后 3 medium + 4 low），全部已修：

| 严重度 | 真 bug | 修法 |
|---|---|---|
| medium | 导入同批内重名候选 → 重复 Person（`existingPersons` 快照循环内不回灌） | 新建后 push 进快照（对齐 `seed-import.ts` L92 同款守卫） |
| medium | commit 非事务：中途失败重试 → 文档/资产重复上传 + 'new' 重试再建空项目 | 建项目后 `setTargetMode('existing')+pin id`；每文件落库后标 `committed`，重试跳过 |
| medium | `targetProjectId` 初值取空 `projects` prop 不再同步 → "现有项目"导入卡死 | `useEffect` projects 到位后回填 |
| low | 级联删除 vs 异步 `indexDocument` 竞态 → 孤儿 chunks | `indexDocument` 把"查 doc 存在 + 写 chunks"包进同一事务（Dexie 按 documents+chunks 表重叠串行化对抗 cascade） |
| low | 大文件主线程解析冻结 UI | `MAX_PARSE_BYTES` 25MB 超限跳过 + 标记（非 web worker，足够缓解） |
| low | 删除当前筛选项目 → 筛选器卡在悬空 id（空列表） | OptionsApp `useEffect` 校验 `selectedProjectId` 仍有效否则回退 '' |
| low | 空文本 xlsx/纯图 PDF 上传成 ✅ 文档但不进 RAG（误导） | 解析空文本 → 默认跳过 + 标"未解析出文本" |

> 教训：**"同一个去重循环复用快照不回灌新建项"是反复出现的坑**（seed-import 已修过一次，bulk-import 又踩）→ 凡"循环内 create + 后续按 name 去重"必须把新建项回灌进比对集。已沉淀进 CLAUDE.md。
> 教训：**级联删除要覆盖所有 owned 表**（assets 曾漏）—— 删除是不可逆操作，"无孤儿"是承重不变式，配回归测试锁定。

## 验收闸
`pnpm compile` 0 · `pnpm lint` 0 · `pnpm test` 174（基线 165 + 新 9：project-ops 3 + parsers 6）· `pnpm build` 2.98 MB · jszip 懒加载。
⚠️ 真机交互（删除确认弹窗 / 导入向导 / 标签切换）Chrome MCP 驱动不了 sidepanel/options chrome，需人工 reload 后点（同既往）。
