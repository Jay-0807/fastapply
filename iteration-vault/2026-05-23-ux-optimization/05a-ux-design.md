# 05a — UX Design: ApplyForge 交互层重设计方案

> **这是 PM 要审核的核心文档。** 看完末尾用 ⛳ 关卡 1 的 3 选项告诉我下一步走法。

## 总览

本方案针对 `01.5-user-research.md` 列出的 **17 个 P0+P1 痛点**给出具体重设计。**不引入新功能、不删既有功能**，只重构交互层。

预估代码变更：
- 新增组件：3 个（`AsyncButton` / `StatusBadge` / `FieldExplainer`）
- 修改组件：6 个（sidepanel/App.tsx / options/App.tsx / popup/App.tsx / background.ts / field-scanner.ts / claude/prompts.ts）
- 新增模块：1 个（`lib/state/session-state.ts`）
- 测试用例：约 12 项新增 + 6 项更新

---

## 三条贯穿全文的设计原则

| 原则 | 一句话 | 怎么落地 |
|---|---|---|
| **P1: 异步必三态** | 所有"点击 → 远程操作"的入口都有显式 idle / busy / done-or-failed | 统一 `<AsyncButton>` 组件 + 标准错误 toast |
| **P2: 状态分三层** | localState / tabSession / projectSession 各归各位 | 新建 `lib/state/session-state.ts` 模块；状态分类表见 §改造 B |
| **P3: 工具要自证** | scanner 不仅扫还要"解释为什么扫到/为什么跳过" | 每个 DetectedField 新增 `provenance` 字段 + `<FieldExplainer>` 折叠面板 |

---

## 改造 A — 看不见进展（含错误恢复）

> 解决 B1 桶的 **2 个 P0 + 6 个 P1**。

### A.0 核心：统一 `<AsyncButton>` 组件

**当前问题**：每个按钮各自 setState + try/catch + alert，写法不一致，很多地方漏写。

**新组件 API**：

```tsx
<AsyncButton
  onClick={async () => { ... }}
  label="🎯 一键填入页面"
  loadingLabel="正在填入字段 (3 / 47) …"
  successLabel="✅ 已填入 47 个字段"
  errorPrefix="填入失败"          // 错误前缀 + 具体消息拼接
  timeoutMs={120_000}              // 内置超时
  onTimeout={() => "操作超时（120s 无响应），可能页面已变化，建议重新扫描"}
  cooldownMs={1500}                // 成功后冷却防双击
  progressFn={(setMsg) => setMsg(...)}  // 可选进度回调
/>
```

**行为契约**：
- 点击即 `disabled = true` + 显示 loadingLabel（带 spinner）
- 成功 → 显示 successLabel 1.5s → 回 idle
- 失败 → 红色 toast 显示 `${errorPrefix}: ${err.message}` + 按钮回 idle（不踢出流程）
- 超时 → 同失败路径，message 走 `onTimeout` 返回值

**应用点**（替换原 `<button onClick={async}>` 写法）：

| 当前位置 | 当前问题 | 改后行为 |
|---|---|---|
| `sidepanel/App.tsx:438` 下一步按钮 | tabQuery 失败默默 return | 显示"未找到激活 tab，可能浏览器还在加载，请稍后再试" |
| `sidepanel/App.tsx:675` 确认并扫描 | 无 loading | "扫描字段中…（已发现 N 个）" 进度回调 |
| `sidepanel/App.tsx:779` 一键填入 | 无 loading | "正在填入第 X / Y 个" |
| `sidepanel/App.tsx:784` 我已提交沉淀 | 无 loading | "保存中…" + 完成后显示 markdown 路径 |
| `options/App.tsx` 文档上传 / 资产上传 | 单独写法 | 统一 |
| `options/App.tsx` 备份导入 / 导出 | 单独写法 | 统一 |

### A.1 标准错误模式 `<ErrorToast>`

**新组件**：浮在 sidepanel/options 底部的非阻塞错误条，包含：
- 错误标题（如"扫描失败"）
- 用户可读消息（不是技术堆栈）
- 上下文链接（如"打开当前页 DOM 调试" / "查看完整错误日志"，可选）
- "✕" 关闭按钮（错误 24h 内累积到 `db.errorLog`，可在 Options → 历史看）

**替换**：所有 `alert(...)` 和 `console.warn(...)` 中"用户应该知道但不知道"的场合。

### A.2 事件提取失败可见化

**痛点**：`detectEventFromPage()` Claude 提取失败时默默回退到 meta-only（活动名常 = "Qualtrics | Experience Management"）。

**改后行为**：
- `extractEventFromBody()` 返回结构增加 `extractionConfidence: 'high'|'medium'|'low'|'failed'` + `extractionSource: 'claude'|'meta'|'title'`
- sidepanel 在 EventContextEditor 上方显示色带：
  - 🟢 **高置信** "已从页面正文识别（claude）"
  - 🟡 **中置信** "部分字段是页面标题猜的，请核对"
  - 🟠 **低置信 / 失败** "AI 提取失败，以下信息来自页面元数据，请手动确认"
- 每个字段右上角小图标：✓ 已抓 / ? 猜的 / — 没抓

**代码改动**：
- `background.ts:267-326` 重写返回结构
- `lib/messages/types.ts` `events.detectFromPage` response 加 confidence
- sidepanel 新增 `<ExtractionConfidenceBanner>` + 单字段 `<FieldOriginBadge>`

### A.3 资产匹配失败提示

**痛点**：`sidepanel/App.tsx:192-194` 资产匹配 catch 仅 `console.warn`。

**改后行为**：
- 失败时在 FileFieldPanel 上方显示一条灰色提示「自动匹配资产失败（{原因}），请手动从下方选择」
- 错误进 ErrorToast 24h 历史

---

## 改造 B — 记不住设置

> 解决 B2 桶的 **1 个 P0 + 5 个 P1**。

### B.0 状态分三层（核心方法论）

**新模块** `src/lib/state/session-state.ts`：

```ts
// 第 1 层：localState — React useState
//   生命周期：组件挂载期间
//   适用：表单输入、UI 临时高亮、按钮 loading
//   不持久化

// 第 2 层：tabSession — chrome.storage.session per-tab key
//   生命周期：浏览器进程关闭即清
//   适用：sessionKey、当前 sidepanel step、当前 eventDraft、detected fields
//   key 格式：`sidepanel.${tabId}.${field}`

// 第 3 层:projectSession — db.appSettings / db.* tables
//   生命周期：永久（除非 backup-restore 清掉）
//   适用：API key、默认模型、上次选过的 project、上次选过的资产、recents
```

**重构清单**：

| 字段 | 从 | 到 | 原因 |
|---|---|---|---|
| `step` | useState | tabSession | 关闭 sidepanel 不该丢步骤 |
| `eventDraft` | useState | tabSession | 同上 |
| `fields` (扫描结果) | useState | tabSession | 避免重扫 |
| `qaPairs` (草稿) | useState | tabSession | 避免重生成 |
| `assetMatches` | useState | tabSession | 避免重选 |
| `model` | useState | projectSession (已是 db.appSettings) | 移除 settings 倒灌竞态 |
| `projectId` | useState | projectSession (新增 `lastUsedProjectId`) | 默认选回上次 |

**代码改动**：
- 新建 `lib/state/session-state.ts`：`useTabSessionState<T>(key, defaultValue)` hook，内部 chrome.storage.session.get/set + onChanged 订阅
- 改 `sidepanel/App.tsx` 第 24-29、72、75、79 行的 useState 全换 `useTabSessionState`
- 改 `sidepanel/App.tsx:42-47` 移除"seededFromSettings"竞态，模型选择走 `db.appSettings` 直读直写

### B.1 修复 P0：sessionKey 解锁竞态

**痛点**：`background.ts:39` `restoreSessionKey()` 未 await，刚解锁的消息可能被判为 locked。

**改后行为**：
- `background.ts` SW 入口处加 module-level Promise：
  ```ts
  const sessionReadyPromise = restoreSessionKey();
  ```
- 所有消息 handler 入口 `await sessionReadyPromise`（一次性 init guard）
- 测试用例：模拟"SW 启动 + 100ms 后到达 settings.unlock 消息" → 验证不再误报 locked

### B.2 模型选择不再被 settings 倒灌

**痛点**：`sidepanel/App.tsx:42-47` 的 seededFromSettings 闸只防"首次"，但 settings useLiveQuery 后续刷新仍可能让 `seededFromSettings=false` 路径再触发（边缘情况）。

**改后行为**：
- 改 `settings = useLiveQuery(...)` 仅用于**展示**当前默认模型
- `model` state 不从 settings 倒灌，初始值用一次性 `chrome.storage.session.get('lastModel')` 或 fallback `db.appSettings.get('singleton').defaultModel`
- `changeModel(next)` 同时写 chrome.storage.session.lastModel + db.appSettings.defaultModel

### B.3 事件信息抓取的"已抓 vs 没抓"显式化

见 §A.2（一起做）。

---

## 改造 C — 抓不准内容

> 解决 B3 桶的 **1 个 P0 + 6 个 P1**。

### C.0 核心：scanner 自证 + 字段 provenance

**新字段** `DetectedField.provenance`：

```ts
type Provenance = {
  source: 'html-input' | 'aria-group' | 'shadow-dom' | 'drop-zone';
  selector: string;
  visibilityState: 'visible' | 'layout-zero-but-include' | 'hidden-skipped';
  labelSource: 'aria-label' | 'aria-labelledby' | 'parent-heading' | 'placeholder' | 'inferred';
  labelConfidence: 'exact' | 'inferred' | 'fallback';
  maxLength?: { value: number; matchedPattern: string };
  helperText?: { value: string; source: 'aria-describedby' | 'sibling-help' | 'small-tag' | 'muted-class' };
};
```

**展示**：sidepanel 每个字段卡片右上角加一个 `ⓘ` 图标，点开折叠 `<FieldExplainer>`：

```
ⓘ 这个字段是怎么扫到的？
  来源: aria-group (单选)
  selector: [role="radiogroup"][aria-labelledby="q3"]
  字段名: "您所在城市"（取自 aria-labelledby 指向的 heading）
  字数限制: 无
  提示文本: 无
```

调试 + 信任建立两不误。

### C.1 修复 P0：可见性检查在真实 Chrome 失效

**痛点**：`field-scanner.ts:403-406` `docHasLayout` gate 让真实 Chrome 0×0 文件输入逃过检查。

**改后行为**：
- 删 `docHasLayout` 短路
- 区分两类元素：
  - 普通 input/textarea/select：必须通过可见性检查（getBoundingClientRect > 0 + 计算样式非 display:none）
  - file input + ARIA radio/checkbox：**记录可见性但不强制过滤**，写入 `provenance.visibilityState`
- 测试用例：happy-dom 和 jsdom 两个环境都覆盖

### C.2 MAX_LENGTH 模式扩充

**当前**（field-scanner.ts:53-69）：
```
最多 / 不超过 / 不多于 / 限 (\d{2,5}) 字
请用 / 以 (\d{2,5}) 字介绍
```

**新增**：
```
限 (\d{2,5}) 字以内
约 (\d{2,5}) 字
大约 (\d{2,5}) 字
控制在 (\d{2,5}) 字
不少于 (\d{2,5}) 字（min, 不影响 max 但记录）
(\d{2,5}) 字左右
(\d{2,5}) characters max
within (\d{2,5}) characters
```

每个 pattern 命中时把 `matchedPattern` 写进 provenance，可调试。

### C.3 file input drop-zone 准确性

**痛点**：`field-scanner.ts:355-365` 直接 querySelectorAll('input[type=file]') 不挑可视性，可能选到 1px 隐藏的占位符。

**改后行为**：
- 优先策略：找页面上的"可见 drop zone 容器"（heuristic: 含文字"拖拽 / drop / 上传 / upload"的 div + 内含 file input）
- 兜底策略：直接 file inputs，但写 provenance.visibilityState=`layout-zero-but-include` 让用户知道
- 测试用例：Qualtrics 文件题（实际样本）+ Google Forms（无文件题）+ Tally 文件题

### C.4 ARIA group 无 label 不再静默跳过

**痛点**：`field-scanner.ts:231-240` ARIA group 没 label 就 `continue`。

**改后行为**：
- 跳过前往 `scanResult.skippedGroups[]` 记录原因
- sidepanel 字段列表底部新增 `<SkippedSummary>` 折叠卡片：「⚠️ 扫描时跳过了 3 个组件，可能是无标签的单选/复选组。点开看详情。」

### C.5 表单编辑器拦截扩充

**当前**（field-scanner.ts:39-51）：
- URL 黑名单仅 `/forms/d/.+/edit`（Google Forms 编辑页）
- ADMIN_LABEL_PATTERNS 仅覆盖 Google Forms 中文 + 英文术语

**新增**：
- URL 黑名单加：`survey.qualtrics.com/.+/edit-survey`、`tally.so/forms/.+/edit`、`jotform.com/build`、`forms.gle/edit`
- ADMIN_LABEL_PATTERNS 加：`Field Label`、`Form Field Settings`、`Question Settings`、`字段标签`、`题目设置`
- 当 URL 命中黑名单时 sidepanel 显示"看起来你在表单编辑页，扫描已禁用。请打开预览/作答页再来。"

### C.6 长页面内容截取

**当前**：`background.ts:268-326` body.innerText 切前 4000 字给 Claude。

**改后行为**：
- 改为**优先取语义性区域**：
  1. 找 `<main>` / `[role="main"]` / `#content` 取里面的 innerText
  2. 找不到再取 body.innerText
- 长度从 4000 → 8000（claude-haiku-4-5 context 还有富余）
- 加 prompt 提示「以下是页面主要内容，可能不完整。如果信息缺失请在对应字段返回空字符串而不是猜测。」

### C.7 Shadow DOM 递归（限作用域）

**痛点**：`field-scanner.ts:191-254` 不进 Shadow DOM，LWC/Shoelace/Web Components 字段消失。

**改后行为**：
- 新增 `traverseShadowRoots(root, callback)` 工具：BFS，最大深度 5（防极端嵌套打死）
- 在 `collectChoiceGroups` 和 `collectFillableElements` 中改用 traversal，命中元素打 `provenance.source='shadow-dom'`
- 测试用例：构造一个 Shoelace `<sl-radio-group>` 的 happy-dom fixture

---

## 实施优先级 & 依赖图

按"修一个能解锁后续多个"的顺序：

```
┌─ Phase 7.1 基础设施（最先做，后面都依赖）
│  ├─ T1. 新建 lib/state/session-state.ts（B.0）
│  ├─ T2. 新建 components/AsyncButton.tsx（A.0）
│  ├─ T3. 新建 components/ErrorToast.tsx（A.1）
│  ├─ T4. 新建 components/StatusBadge.tsx（保留+推广用）
│  └─ T5. 新建 components/FieldExplainer.tsx（C.0）
│
├─ Phase 7.2 P0 修复（紧接基础设施）
│  ├─ T6. 🔴 P0-1: sessionKey 解锁竞态（B.1）
│  └─ T7. 🔴 P0-2: scanner 可见性 + docHasLayout 移除（C.1）
│
├─ Phase 7.3 sidepanel 重构（用上基础设施）
│  ├─ T8. step / eventDraft / fields / qaPairs / assetMatches 改 tabSession
│  ├─ T9. 所有按钮换 AsyncButton
│  ├─ T10. 模型选择改 chrome.storage.session.lastModel（B.2）
│  ├─ T11. ExtractionConfidenceBanner + FieldOriginBadge（A.2）
│  └─ T12. 资产匹配失败用 ErrorToast（A.3）
│
├─ Phase 7.4 scanner 改进（用上 provenance）
│  ├─ T13. DetectedField.provenance 字段 + 写入逻辑（C.0）
│  ├─ T14. MAX_LENGTH_PATTERNS 扩充（C.2）
│  ├─ T15. file input drop-zone 启发式（C.3）
│  ├─ T16. ARIA group 静默跳过 → SkippedSummary（C.4）
│  ├─ T17. 表单编辑器黑名单扩充（C.5）
│  ├─ T18. 长页面提取改 semantic + 8000 字 + prompt 调整（C.6）
│  └─ T19. Shadow DOM 递归（C.7）
│
└─ Phase 7.5 options/popup 同步
   ├─ T20. options/App.tsx 文档/资产上传按钮换 AsyncButton
   └─ T21. options 错误改 ErrorToast
```

**约 21 个具体编码任务**。Phase 7.1 基础设施做完后，7.2/7.3/7.4 可以**并行**（不同文件、不互相依赖）。

---

## 风险与回退方案

| 风险 | 影响 | 缓解 |
|---|---|---|
| **tabSession 实现复杂** —— chrome.storage.session 不像 React state，需写自定义 hook 处理订阅、并发、序列化 | 改了 sidepanel 但状态丢失 / 性能下降 | T1 单独做完单元测试再用；如方案太复杂可降级用 IndexedDB tabSessions 表 |
| **AsyncButton 替换面广** —— 全项目可能有 20+ 个按钮 | 一次性改容易遗漏 | 7.3 / 7.5 分批改，每批改完 build 一次确认编译过 |
| **provenance 字段加宽 DetectedField** —— 序列化 / messages 体积变大 | 跨消息传输慢、IndexedDB 存储变大 | provenance 只在 sidepanel UI 用，不进 db.qaRecord 持久化 |
| **Shadow DOM 递归慢** | 扫描时间变长 | 限深度 5 + 限节点数 1000 + 测试一个大表单看耗时 |
| **可见性检查放宽后误抓** —— file input 不再强过滤可能引入垃圾字段 | 字段列表变脏 | provenance 暴露 visibilityState，UI 上灰色降权显示+折叠 |

**全局回退**：方案是渐进的，每个 T 都是独立 commit。任何 T 上线后发现回归，单独 revert 该 commit，不影响其他改动。

---

## 不在本方案的（推下一轮）

按 PM 决策（00-intake.md）：

- ❌ B4 桶（搞不清产品）：onboarding / 三入口职责 / 备份-经验库的产品语言
- ❌ P2 项的 5 条 scanner heuristic 精细化
- ❌ 新功能 / 新模型 / 新数据源

---

## ⛳ PM 关卡 1：决策点

下面 3 选项告诉我下一步：

### ✅ 方案 A — 全量批准（推荐）
按本方案 21 项任务全跑，预计 4-6h 编码（视 chrome.storage.session 实现复杂度）+ 1h review/test。我接着进 Phase 6 任务分解 + Phase 7 实施。

### 🔄 方案 B — 局部批准 / 改方向
告诉我哪几项你要 / 哪几项删 / 哪几项改设计。常见调整：
- "B 桶状态分层太复杂，先做 P0 + AsyncButton 就行" → 砍掉 T8/T13-T19
- "scanner 改造单独做，先做可视化和持久化" → 砍 7.4 整段
- "我想看到先做 AsyncButton 跑一个真实表单的样子" → 砍除 T1-T4 + T7 外都暂停

### ❌ 方案 C — 方向不对
告诉我你看完觉得问题在哪。可能是：
- "我其实更想先做 onboarding"（B4 桶）→ 我改写 00-intake.md 重圈范围
- "你抓的痛点不是我最痛的"→ 你跑一遍真实表单告诉我新痛点，我重写 1.5

---

**等你回复一个选项 + 任何要补充的具体意见，我开始下一步。**
