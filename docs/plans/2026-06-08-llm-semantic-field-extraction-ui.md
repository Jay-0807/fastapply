# 字段识别 LLM 语义提取 — UI/UX 设计

> 基于：`*-ideation.md` + `*-design.md`
> 平台：Chrome MV3 扩展（sidepanel 固定宽 ~400px chrome 面板 + options 全屏后台）
> 性质：**增量增强**现有 sidepanel 工作流 + FieldExplainer 组件，非新建页面
> 硬约束：图标一律 **lucide-react**（禁 emoji，耐久铁律 #2）；中文 UI；`exactOptionalPropertyTypes`

---

## 信息架构

新功能不新增独立页面，挂在两个现有入口下：

```
Options（全屏后台）
└── 设置 tab
    └── 【新】扫描模式（scanMode 全局默认）── R6
        ├ 启发式（默认，现状行为）
        ├ 混合（启发式 + LLM 补漏）
        └ 纯 LLM（实验，换表单不改代码）

Side Panel（报名主工作流，3 步不变）
└── 步骤②→③ 之间：字段扫描
    ├── 【新】扫描控制区：当前模式指示 + 快速切换 chip ── R6/R5
    └── 步骤③ 草稿列表
        ├── 【新】静态边界提示条（顶部）── R9 / F9
        ├── 【新】recall 对比条（hybrid 模式，顶部）── O1
        └── 字段卡 × N
            └── 【改】FieldExplainer：来源徽章新增 LLM/一致 ── R9/R4
```

层级深度：全局模式 1 次点击（设置 tab 内）；字段来源 0 次（徽章直接可见，详情 1 次展开）。✅ 重要功能 ≤ 2 次点击。

---

## 用户流程

### 流程 1：混合扫描（happy path，核心任务）

```
PM 在报名页打开 sidepanel → 选项目 → ② 确认事件信息
  → 扫描控制区显示「模式：混合 ▾」（读 AppSettings.scanMode）
  → 点「确认，开始扫描字段」
  → [加载态] 进度文案分两段：「启发式扫描中…」→「LLM 语义补漏中…」
  → ③ 草稿列表：
       顶部 recall 对比条「启发式 12 · 混合 15（+3）」
       顶部静态边界提示条「本页静态字段，动态字段需翻页重扫」
       字段卡带来源徽章（3 个新捞的标「LLM 识别」，一致的标「启发式+LLM 一致」）
  → 后续 draft 生成 / 一键填入 / 沉淀经验 —— 全部不变
```

### 流程 2：LLM 失败兜底（异常路径，F8）

```
混合模式扫描 → LLM 调用失败（429 超 backoff / 超时 / 解析失败）
  → 不白屏：自动退回纯启发式结果
  → 草稿列表照常出现（仅启发式字段）
  → recall 对比条降级为提示：「LLM 补漏未完成（已用启发式结果）· 重试」+ ErrorToast warning
  → PM 可点「重试 LLM 补漏」或直接用启发式结果继续
```

### 流程 3：切换全局模式（配置路径）

```
Options → 设置 tab → 扫描模式 → 选「混合」
  → 立即持久化（AppSettings.scanMode，Dexie）
  → 顶部 ErrorToast success「已切换到混合模式，下次扫描生效」
  → 回 sidepanel，扫描控制区模式指示同步为「混合」
```

### 异常路径覆盖

| 异常 | UI 响应 |
|---|---|
| LLM 失败（F8） | 退回启发式 + warning toast + 重试入口（流程 2） |
| 未配置 LLMConfig 却选了 hybrid/llm | 扫描控制区 hybrid/llm 选项禁用 + 提示「需先在设置添加模型」，自动退回 heuristic |
| 缓存命中 | 加载态一闪而过（< 100ms），不显示 LLM 进度段 |
| 动态字段漏扫（F9） | 静态边界提示条常驻，不谎称扫全 |

---

## 页面清单

> 「页面」= 本增量功能触及的 UI 面（surface），非独立路由页。

| 面 | 用途 | 对应能力 | 入口 |
|------|------|---------|------|
| Options·设置·扫描模式 | 全局默认 scanMode 三态选择 | R6 | Options → 设置 tab |
| Sidepanel·扫描控制区 | 触发扫描 + 当前模式指示 + 快速切换 | R6 / R5 | sidepanel 步骤② 底部（扫描触发处） |
| Sidepanel·静态边界提示条 | 诚实标注「动态字段需翻页」 | R9 / F9 | sidepanel 步骤③ 字段列表顶部 |
| Sidepanel·recall 对比条 | hybrid 模式显示启发式 vs 混合检出数 | O1 | sidepanel 步骤③ 字段列表顶部 |
| Sidepanel·字段卡来源徽章（FieldExplainer 扩展） | 显示字段来源 LLM/启发式/一致 | R9 / R4 | 每个字段卡右上（现有 FieldExplainer 内） |

---

## 页面详细设计

### 面 1：Options·设置·扫描模式（R6）

**布局**：设置 tab 内、「已接入的模型」列表上方新增一个区块卡。
**组件**：区块标题「扫描模式」+ 副标题说明 + 3 选 1 单选组（lucide 图标 + 文案 + 一句话说明）。

| 选项 | lucide 图标 | 文案 | 说明 |
|---|---|---|---|
| heuristic | `Wrench` | 启发式（默认） | 现有规则扫描，零 LLM 成本，最快 |
| hybrid | `Sparkles` | 混合（推荐） | 启发式 + LLM 补漏，换表单更少漏检 |
| llm | `Bot` | 纯 LLM（实验） | 完全靠 LLM 语义识别，换表单不改代码 |

**交互**：点选即存（无保存按钮）；选中态用主色边框 + 主色文字。
**4 状态**：
- 加载：读取 AppSettings 时三选项骨架占位（< 200ms，一般无感）。
- 空：N/A（总有缺省 heuristic）。
- 正常：当前模式高亮；hybrid/llm 下方灰字「每张新表单一次 LLM 调用，结果缓存」。
- 错误：写入失败 → ErrorToast error「保存失败，请重试」，选中态回滚。
- 禁用态：未配置任何 LLMConfig 时，hybrid/llm 置灰 + tooltip「需先添加模型」。

### 面 2：Sidepanel·扫描控制区（R6/R5）

**布局**：步骤② 事件确认底部、「确认，开始扫描字段」按钮上方，一行 chip。
**组件**：`模式：[当前模式] ▾`（lucide `ChevronDown`），点开下拉临时切换本次扫描模式（不改全局默认，仿 V2.2 sidepanel LLMConfig chip 模式）。
**交互**：下拉列 3 模式 + 当前默认标记；选后仅本次扫描生效。
**4 状态**：
- 加载：扫描进行时 chip 禁用 + 文案变进度（见下「扫描加载态」）。
- 空：未选模式时显示全局默认。
- 正常：显示当前模式名 + 图标。
- 错误：未配置模型时 chip 显示「启发式（无模型）」灰态。

**扫描加载态（关键）**：点扫描后，按钮走 AsyncButton busy 态，进度文案分段：
```
heuristic： 「扫描字段中…」
hybrid：    「启发式扫描中…」→「LLM 语义补漏中…」（两段，lucide Loader2 旋转）
llm：       「LLM 语义识别中…」
```

### 面 3：Sidepanel·静态边界提示条（R9/F9）

**布局**：步骤③ 字段列表最顶部，一条窄信息条。
**组件**：lucide `Info` 图标 + 文案「本页静态字段；条件展开 / 分页字段需翻页后重扫」+ 可关闭 `X`（本会话记住）。
**视觉**：muted 背景（如 `bg-muted`）、次要文字色，不抢眼但常驻。
**4 状态**：正常常驻 / 关闭后隐藏（会话级）/ 无加载态 / 无错误态。

### 面 4：Sidepanel·recall 对比条（O1）

**布局**：静态边界提示条下方，仅 hybrid/llm 模式显示。
**组件**：lucide `BarChart2` + 「启发式 {H} · 混合 {M}（+{M-H}）」，+K 用 success 色，0 或负时灰显「无新增」。
**交互**：纯展示；hover 显示 tooltip「LLM 多识别了 {K} 个启发式漏掉的字段」。
**4 状态**：
- 加载：扫描中不显示（结果出来才有数）。
- 空 / 0 新增：「启发式与混合检出一致（{H}）」灰显。
- 正常：显示 +K（success 色）。
- 错误（LLM 失败 F8）：降级文案「LLM 补漏未完成（已用启发式 {H} 个结果）」+ lucide `RotateCw`「重试」按钮。

### 面 5：字段卡来源徽章 — FieldExplainer 扩展（R9/R4）

**现状**：FieldExplainer 已显示 `source`（html-input/aria-group/shadow-dom/drop-zone）+ labelSource + 可见性 + maxLength。
**新增分支**：

| provenance.source | lucide 图标 | 徽章文案 | 颜色 |
|---|---|---|---|
| `llm-semantic` | `Sparkles` | LLM 识别 | accent（强调色） |
| `heuristic+llm` | `CheckCircle2` | 启发式+LLM 一致 | success |
| 现有 4 种 | 不变 | 不变 | 不变 |

**交互**：徽章在字段卡右上紧凑显示（现有「ⓘ 来源」按钮文案扩展）；点开展开面板，新增一行「识别方式：LLM 语义 / 启发式规则 / 两者一致」。
**4 状态**：随字段卡，无独立加载/错误态。

---

## 视觉规范

> **复用现有 Tailwind 3 主题，不新增调色板。** 本功能只引用已有语义色 token + 锁定图标系统。

### 品牌色（复用现有语义角色 → Tailwind 类）

| 角色 | Tailwind 参考 | CSS 变量 | 本功能用途 |
|------|------|---------|------|
| 主色 | `blue-600` | `--primary` | 模式选中态、焦点环 |
| 辅助/强调 | `violet-500` | `--accent` | **LLM 识别徽章**（Sparkles） |
| 成功 | `green-600` | `--success` | **一致徽章**、recall +K |
| 警告 | `amber-500` | `--warning` | LLM 失败降级提示 |
| 错误 | `red-600` | `--destructive` | 保存失败 toast |
| 次要文字 | `slate-500` | `--muted-foreground` | 边界提示条、说明文案 |
| 卡片/muted 背景 | `slate-50/100` | `--muted` | 提示条背景 |

### 排版（复用现有）

| 层级 | 字号 | 字重 | 用途 |
|------|------|------|------|
| H3 | 16-18px | 600 | 设置区块「扫描模式」标题 |
| Body | 14px | 400 | 选项文案、字段标签 |
| Small | 13px | 400 | 模式说明、徽章文案 |
| Caption | 12px | 400 | recall 对比条、边界提示条 |

字体族：跟随现有 `system-ui, -apple-system, "Segoe UI", sans-serif`。

### 风格参数（复用现有）

| 元素 | 圆角 | 说明 |
|------|------|------|
| chip / 徽章 | full（药丸） | 模式 chip、来源徽章 |
| 卡片 / 提示条 | 6-8px | 设置区块卡、提示条 |
| 按钮 | 6px | 复用 AsyncButton |

间距：基础 4px 刻度（`4/8/12/16/24`）；sidepanel 紧凑密度（窄面板）；提示条上下 padding 8px。
阴影：提示条/徽章无阴影（扁平）；下拉菜单低阴影 `0 4px 6px rgba(0,0,0,0.07)`。

### 图标系统（必选 · 红线）

<IMPORTANT>
**图标库：lucide-react（项目唯一标准，禁 emoji）** —— 与 `*-oss-scan.md` R9 决策一致，耐久铁律 #2。
</IMPORTANT>

| 字段 | 取值 |
|------|------|
| 图标库 | **lucide-react** |
| 图标风格 | 线性（stroke） |
| 默认尺寸 | 14px（徽章/chip 内）、16px（提示条/按钮） |
| 描边粗细 | 2px（lucide 默认） |
| 图标颜色 | `currentColor`（继承文字/语义色，自动跟随主题） |

**本功能图标清单**（全部 lucide-react，禁任何 emoji 写进 JSX text 节点）：

| 图标 | 用途 |
|---|---|
| `Wrench` | 启发式模式 |
| `Sparkles` | 混合/LLM 识别（accent） |
| `Bot` | 纯 LLM 模式 |
| `Loader2`（旋转） | 扫描加载态 |
| `Info` | 静态边界提示条 |
| `BarChart2` | recall 对比条 |
| `CheckCircle2` | 启发式+LLM 一致徽章（success） |
| `ChevronDown` | 模式快速切换 chip |
| `RotateCw` / `RotateCcw` | LLM 补漏重试 |
| `X` | 关闭提示条 |

> emoji 白名单（本功能不涉及）：仅 i18n JSON 值 / 注释 / 文档 / UGC 可含 emoji；任何 UI 元素一律 lucide。

---

## 动效规范

### 基调
**克制**（工具型效率产品）—— 复用现有 AsyncButton 四态过渡，不新增花哨动效。

### 过渡参数

| 场景 | 时长 | 缓动 |
|---|---|---|
| 模式选中态切换 | 150ms | ease-out |
| chip 下拉展开 | 150ms | ease-out |
| 提示条出现/关闭 | 200ms | ease-in-out |
| 扫描加载旋转 | 持续 | linear（Loader2） |

### 场景方案
- 加载模式：**旋转器**（lucide `Loader2`，复用现有 AsyncButton busy 态），非骨架屏（扫描快、面板窄）。
- recall 对比条出现：淡入 200ms（结果就绪时）。
- 尊重 `prefers-reduced-motion`：旋转器降级为静态文案「处理中…」，关闭淡入。

---

## 线框图

### Options·设置·扫描模式
```
┌─ 设置 ─────────────────────────────────┐
│ 扫描模式                                  │
│ 决定字段如何被识别。换没见过的表单时，         │
│ 混合/纯LLM 更少漏检。                       │
│ ┌────────────┐┌────────────┐┌──────────┐ │
│ │🔧 启发式    ││✨ 混合      ││🤖 纯LLM   │ │ ← 图标=lucide(Wrench/Sparkles/Bot)
│ │  (默认) ●  ││  (推荐)    ││  (实验)   │ │   非 emoji，此处仅示意
│ │ 规则·最快  ││ 规则+LLM   ││ 不改代码  │ │
│ └────────────┘└────────────┘└──────────┘ │
│ ⓘ 每张新表单一次 LLM 调用，结果缓存          │
│ ── 已接入的模型 ───────────────────────── │
│ ...（现有列表不变）                         │
└──────────────────────────────────────────┘
```

### Sidepanel·步骤③ 字段列表顶部
```
┌─ 字段草稿 (sidepanel ~400px) ───────────┐
│ ⓘ 本页静态字段；分页/展开字段需翻页重扫  ✕ │ ← Info, 可关
│ ▥ 启发式 12 · 混合 15 (+3)               │ ← BarChart2, +3 绿
│ ───────────────────────────────────────│
│ ┌─ 申请人姓名 ────────────  ✨LLM识别 ⓘ┐ │ ← Sparkles 徽章
│ │ [请你自己填，AI 不代写]（noAiFill）    │ │
│ └────────────────────────────────────┘ │
│ ┌─ 项目简介 ───────────  ✅一致 ⓘ──────┐ │ ← CheckCircle2 徽章
│ │ [AI 草稿 textarea...]   142/200 字    │ │
│ └────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```
> 线框图中 🔧✨🤖✅ⓘ▥ 仅为 ASCII 示意；**实现一律 lucide-react 组件**，JSX text 节点禁写 emoji。

---

## 响应式策略

| 入口 | 宽度 | 策略 |
|---|---|---|
| Side Panel | 固定 ~360-400px（Chrome 面板） | 单列；模式 chip + 徽章用紧凑文案；recall 对比条单行可省略括号 |
| Options | 全屏自适应 | 设置区块 3 模式卡横向排列；窄屏（< 640px）降级为纵向堆叠 |

无移动端（PRD §1：不做移动端）。暗色模式：跟随现有项目策略（语义色用 token，自动适配）。

---

## 数据需求汇总（→ 阶段 4 API 设计的直接输入）

| 数据 | 来源 | 用途 | 备注 |
|---|---|---|---|
| `AppSettings.scanMode: 'heuristic'\|'hybrid'\|'llm'` | Dexie（migration v5→v6） | 全局默认模式 | 缺省读作 `heuristic` |
| 本次扫描 mode（临时覆盖） | sidepanel 会话态（tabSession） | 扫描控制区快速切换 | 不改全局默认 |
| `fields.scan` payload 加 `mode?: ScanMode` | 消息总线 | 把模式传给 background | design §6.2 |
| `DetectedField.provenance.source` 新增 `'llm-semantic'\|'heuristic+llm'` | R4 产出 | 来源徽章 | 来源徽章渲染依据 |
| recall 对比数据 `{ heuristicCount, hybridCount }` | R5 编排返回（hybrid 模式附带） | recall 对比条 O1 | 扫描结果元数据 |
| LLMConfig 是否存在 | 现有 AppSettings.llmConfigs | hybrid/llm 选项可用性 | 无模型时禁用 |
| 静态边界提示「已关闭」标记 | tabSession（会话级） | 提示条关闭状态 | UI 瞬态 |

---

## 自检（checklists/ui-completeness）

- [x] 每个 MVP 功能（R6/R9/O1 + R4/R5 的 UI 投影）都有面 + 用户流程
- [x] 每个面定义了加载/空/正常/错误 4 态（面 1/2/4 完整；面 3/5 为静态展示，已说明无加载/错误态）
- [x] 用户流程覆盖异常路径（流程 2 LLM 失败兜底 + 异常路径表）
- [x] 信息架构 ≤ 2 次点击（全局模式 1 次，来源 0-1 次）
- [x] 数据需求已列（供阶段 4 API）
- [x] 无过度设计（不新增独立页面，全部挂现有入口）
- [x] 视觉规范：复用现有语义色 + 排版 + 圆角刻度
- [x] **图标系统锁定 lucide-react，禁 emoji（红线）**，含具体图标清单
- [x] 动效克制、有标准时长、尊重 prefers-reduced-motion

---

**阶段 3 产出完成。** 下一步：阶段 4 API 设计（消息总线扩展 / ControlManifest schema / LLM 提取请求响应 / scanMode 持久化契约 / recall 元数据）。
