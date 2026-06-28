# 多页报名「累计填写、一次性沉淀」— Intake + PRD + 设计

> Lane: 🚶 标准（SIZE=M / RISK=数据完整性）· 2026-06-28 · PM jayyangstudy@gmail.com
> 经验召回：命中 `multi-page-form-continue`（V2.7）—— 本次是对 V2.7「每页各封一条」模型的**语义反转**，不是从零。

## 1. PM 原话
> 活动报名经常多页，插件只能识别一页就保存。建议第 3 步「一键填入」之后加一个「下一页」继续填写，确保整个报名所有页面填完后**再一次性提交、沉淀经验**。
（截图：中国深圳创新创业大赛，左侧 赛区/基本信息/项目负责人/核心团队/商业计划书/… 多分页。）

## 2. 现状（V2.7，2026-06-05）
- 4 步：`project → context → draft → submitted`。
- 「继续填下一页」按钮在 **`SubmittedPanel`（已提交之后）** → 流程是 `填 → 我已提交（封 1 条 QARecord + 种 RAG）→ 继续下一页 → …`。
- **每页 = 一条经验记录 = 一个 markdown**。

## 3. 目标（PM 拍板：整份报名存一条）
- 第 3 步（draft）新增「**下一页继续填**」：累计本页答案 → 扫下一页，**不封存**。
- 全部页填完后「**我已提交，沉淀经验**」一次性把**所有页合并成 1 条 QARecord**（1 个 markdown，1 次 RAG 种入）。
- **单页表单行为完全不变**（不点「下一页」即与今天逐字节一致）。

## 4. 设计（Simplicity / Surgical：复用 V2.7 的 re-scan，改"丢弃"为"累计"）
- 新状态 `accumulatedPages: Array<{label, qaPairs: QAPair[]}>`，存 `useTabSessionState`（随 sidepanel 重开存活，按 tab 隔离）。
- **填充路径零改动**：`fields` / `qaPairs` 始终只代表"当前页"，原始 fieldId 不改写，`fillPage` 只填当前页 DOM。累计器只在**封存时**用于拼装 QARecord，从不参与填充。
- 新 handler `accumulateAndScanNext`：re-scan → 同页守卫 → 把当前页 qaPairs 快照进累计器 → 重置当前页瞬态 → 载入新页。
- `markSubmitted`：`combinePages(accumulatedPages, 当前 qaPairs)` → 1 条记录 → 封存 → **清空累计器**。
- 纯函数 `src/lib/sidepanel/page-accumulator.ts`（`combinePages` / `isLikelySamePage`）抽出可测。

## 5. 承重不变式（违反会丢数据 / 串号 / 泄露 —— 每条配检查）
1. **跨页合并用扁平数组（QAPair[]），绝不用 fieldId-keyed map** —— `fieldId = af-field-${counter}-${hash(containerHTML)}`，`counter` 每次扫描重置，跨页**非保证唯一**；若用 map 合并，同序号+同结构页会互相覆盖丢字段。扁平数组天然不去重 → 不可能丢。（对应 [[knowledge-graph-v040]] / bulk-import 的「去重循环必须回灌」同源教训。）
2. **单页零回归** —— 不点「下一页」时 `accumulatedPages=[]`，封存 = 当前页 = 今天的行为，逐字节相同。
3. **同页守卫** —— re-scan 与上一页 fieldId 重叠 >50% ⇒ 站点还没翻页，警告且**不快照**（防重复累计）。
4. **PII 边界不变** —— 封存仍走 `markRecordSubmitted` → `record.qaPairs.filter(isSeedableQaPair)` 逐条过滤，合并后的个人/OTP 字段照样**不种进 RAG**，只留本地 markdown。（守 [[knowledge-graph-v040]] 三红线）
5. **fillPage 不碰已翻过的页** —— prior 页已在站点上保存，累计器内容不进 `fields`，填充器看不到。

## 6. UI（cramped sidepanel）
- 累计中：draft 顶部 banner「已累计 N 页 · M 字段，将与本页一起沉淀为 1 条经验」（prior 页可折叠查看）。
- 动作栏：`🎯 一键填入页面` | `下一页继续填 →`（新）/ `✅ 全部填完，沉淀经验`（封存，文案随累计数自适应）。
- `重新扫描本页`（rescan，不累计）保留，文案与「下一页」区分清楚。

## 7. 测试计划
- 单测 `page-accumulator.test.ts`：combine 合并顺序/计数、空累计=单页直通、fieldId 冲突不丢、isLikelySamePage 阈值（同页/异页/空集）。
- 编译 `pnpm compile` + `pnpm lint`（max-warnings 0）+ `pnpm test`。
- 真机 dogfood（深创赛多页）留待 PM（Chrome MCP 驱动不了 sidepanel 自身，见 [[chrome-mcp-dogfood-technique]]）。

## 8. 不在范围
- 自动点站点「下一步/保存」（扩展无法可靠驱动任意站点导航；用户手动翻页）。
- 跨页字段去重/同一字段多页合并答案（各页独立 Q&A 即可）。

## 9. 对抗式审查（GAN）结论 + 已知限制
独立怀疑式 reviewer 复核 5 条承重不变式 → **全部 HOLDS**（含最易泄露的 PII 闸：seal 时 `isSeedableQaPair` 在合并后逐条过滤，累计不绕过）。另发现 4 项相邻问题，已逐条裁定：
- **D3 跨项目封存（reviewer 标 must-fix）→ 实测不可达**：step 机只前向（无 `setStep('project')`），进入 draft 后无法改项目，累计页恒属当前 projectId。已在 `markSubmitted` 写明 INVARIANT 注释；若future加「返回选项目」入口，必须给 AccumulatedPage 盖 owner 戳并在 seal 时丢弃不匹配页。**不加 projectId-effect**（会和 reopen 水合竞态打架，反成更糟回归）。
- **D1 同页守卫误拦纯重复结构页（should-fix）→ 保留守卫 + 记限制 + 转 follow-up**：`isLikelySamePage` 拦的是 overlap>0.5（"站点没翻页/双击"，真阳性 overlap≈1.0）；纯重复结构多页（成员1/成员2 同骨架）会误拦且无 override。目标表单（深创赛等）各页是不同 section，overlap≈0，不受影响。强行加 override 会与"双击防重"冲突，故不在本轮做，spawn 成独立 follow-up。误拦时用户仍可「一键填入」本页、必要时直接「沉淀经验」兜底（非彻底死路）。
- **D2 空页计数（nit）→ 有意保留**：累计页保留 skipped/空 pair，与单页 seal 行为一致（单页也存空 pair），不过滤以免单/多页不一致。
- **D4 跨页同字段两份 → 即 claim-1「都留」的预期行为**，非缺陷。
