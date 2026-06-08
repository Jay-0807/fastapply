# Autonomous Decisions Log — Overnight Execution

> 夜间 autonomous 模式下做的决策。每次决策记录: 时间 / 何处 / 选择 / 原因。PM 早晨复盘时可查这里追溯。

---

## 启动

**时间**：2026-05-23 23:50 (本地)
**触发**：PM 选择"✅ 验收通过" + 说"开启隔夜模式，要睡觉"
**计划**：完成 05a-ux-design.md 延期清单中的 6 项（T10/T11/T13/T15/T16/T19）+ Phase 12 release notes
**顺序**：T13 → T15 → T19 → T11 → T10/T16 → release

红线 escalate 规则：R1/R2/R3/R4 才打断 PM；其余决策记录在此。

---

## T13 + T15 实施决策

**时间**：00:14
**完成**：T13 (provenance) + T15 (drop-zone heuristic)
**决策记录**：
1. **`detectLabel` 重构为 `detectLabelWithSource`** —— 旧函数没有被任何外部调用者用，安全替换。返回 `{value, source, confidence}` 元组。
2. **`detectConstraints` → `detectConstraintsWithSource`** —— 同上，但保留旧逻辑路径，只是额外吐出 `maxLengthSource` / `helperSource`。
3. **T15 实现选择**：没有改 `collectFillableElements` 优先找 drop-zone，而是在 `analyzeElement` 里用 `hasDropZoneContainer(input)` 判断 provenance.source —— 因为 drop-zone 容器只是显示用，selector 还是要指向真正的 `<input type=file>`（DataTransfer API 需要直接指向 file input）。
4. **测试模式 matcher 用正则源代码片段** —— FieldExplainer UI 显示"matched pattern `控制在...`"足够调试。避免把整个 toString 塞进去（太长）。
5. **`hasDropZoneContainer` 深度限制 5** —— 防止极端嵌套 form 走死。

**测试**：32/32 pass (+5 新测试覆盖 provenance.source / labelSource / maxLength pattern / placeholder fallback / drop-zone)

---

## T19 + T11 实施决策

**时间**：00:18
**完成**：T19 (Shadow DOM + confidence) + T11 (Banner + Badge)
**决策**：
1. **confidence 计算用"Claude 填了几个字段"** —— 4-5 个=high / 2-3=medium / 0-1=low / throw=failed。粗但不需要额外 API 调用。
2. **failed 状态有两种**：
   - Claude tried and threw → confidence='failed'（红色横幅）
   - bodyText 太短不调 Claude → confidence='low'（橙色横幅）
3. **Shadow DOM 深度 5、节点预算 1000** —— 防止极端 DOM。深度极少超过 3，1000 节点也足够。
4. **FieldOriginBadge 'extracted' 不显示徽章** —— 默认成功不加噪声，只有出问题（guess/empty）才提醒
5. **pageMetaJson 装 `_extractionMeta` 而不是新字段** —— 复用现有持久化路径，避免 db migration

---

## T10 实施决策

**时间**：00:18
**完成**：T10 (model selection tabSession 双写)
**决策**：
1. **seededFromSettings 加 `&& model === 'claude-sonnet-4-5'` 守卫** —— 只有 model 还是默认值时才允许 settings 倒灌。如果 tabSession 已经 hydrate 了用户的选择，settings 加载就不会覆盖。
2. **changeModel 双写 tabSession + db.appSettings** —— tabSession 是即时生效的会话源；db.appSettings 是下次浏览器会话的默认。两层独立，db 失败不影响当前会话。

---

## T16 决策：不做

**时间**：00:20
**Verdict**：DEFERRED to V3
**原因**：P2 优先级；要改 `scanFields` 返回类型从 `DetectedField[]` 到 `{ fields, skippedGroups }`，所有调用方都得改。改动量 vs 价值不划算。如果用户研究真发现这是高频痛点再做。

---

## 不 commit 的决策

**时间**：00:20
**决策**：autonomous 模式下不自动 commit
**原因**：用户安全规则"Only create commits when requested"；用户在睡觉，无法确认。让用户早晨 `git diff` 审完决定 commit 策略。


