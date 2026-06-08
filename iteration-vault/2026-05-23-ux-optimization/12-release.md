# 12 — V2 Release Notes (UX Iteration)

> 本轮 UX 优化迭代的完整 release 描述。可直接复制粘贴到 GitHub release 或 README CHANGELOG。

## 0.2.0 — V2 UX Refresh (2026-05-23)

### 一句话

把 V1 的"功能能跑但用着卡"全面升级为"看得见进度、记得住状态、抓得准内容、错了能救"。零新功能，纯交互层重构 + 扫描器质量提升。

### 用户视角的改善

#### 🟢 看得见进展（含错误恢复）—— 已修

每个异步按钮都换成了统一的 `<AsyncButton>`：

| 按钮 | 之前 | 现在 |
|---|---|---|
| 选完项目 → 下一步 | 不知道点没点中 | 显示 "读取页面内容中…" 进度 |
| 确认事件 → 扫描字段 | 卡几秒不动 | 显示 "正在扫描页面字段…" |
| 🎯 一键填入页面 | 报错只在 console | 进度 + toast "✅ 已填入 N 个 / ⚠ 部分失败" |
| ✅ 我已提交，沉淀经验 | alert() 或卡死 | 进度 + toast 显示 markdown 路径 |
| 文档上传 / 资产上传 | 个别地方有 alert | 统一 toast.error / toast.success |

错误不再阻塞流程：所有 alert() 替换为底部 toast 队列，30 秒自动消失，鼠标悬停暂停消失。

#### 🟢 记得住状态 —— 已修

- **跨 sidepanel 关闭/重开**：当前步骤、事件草稿、字段列表、AI 草稿、文件资产手动选择 —— 全部持久化到 `chrome.storage.session`，浏览器关闭前都在
- **解锁状态恢复**：SW 重启后的 `sessionKey` 通过 `sessionReadyPromise` await 闸保护，不再误报 "Settings locked"
- **模型选择**：每个 sidepanel 会话独立记住，不再被 settings 自动倒灌

#### 🟢 抓得准内容 —— 已修

字段扫描器：

- **可见性阈值放宽**：从"width<4 OR height<4 拒绝"改为"width<1 AND height<1 拒绝"。Qualtrics 的隐藏 file input、Tally 的条件渲染字段不再被误删
- **MAX_LENGTH 模式补全**：新增 "约 N 字"、"大约 N 字"、"控制在 N 字"、"N 字左右"、"about N words"、"不能超过 N 字" 等 8 种新变体
- **表单编辑器 URL 黑名单**：Qualtrics / Tally / Jotform / 问卷星编辑页扫描已禁用
- **管理员标签拦截**：新增 Jotform / Gravity Forms / Wufoo 等英文表单设计器术语
- **长页面 semantic 抓取**：先找 `<main>` / `[role="main"]` / `#content`，找不到才用 body；从 4000 字提升到 8000 字
- **AI prompt "宁缺勿猜"**：让 Claude 在不确定时返回空字符串而不是猜测
- **Shadow DOM 递归**：LWC / Shoelace 等 Web Component 的单选/复选组不再消失（深度上限 5，节点预算 1000）
- **拖拽区识别**：file input 被 styled drop-zone 包裹时，provenance 标记为 `drop-zone`，UI 上可看到

#### 🆕 字段来源透明化（FieldExplainer）

每个字段卡片右上角新增 "ⓘ 为什么扫到这个字段？" 折叠面板，展开后显示：

- 来源（HTML 表单元素 / ARIA 单选组 / Shadow DOM / 文件拖拽区）
- selector
- 可见性（可见 / 布局 0×0 仍纳入 / 已跳过）
- 字段名来源（aria-label / aria-labelledby / 父级标题 / placeholder / 推断）
- 字段名置信度（exact / inferred / fallback）
- 字数限制 + 匹配的正则
- 提示文本 + 来源（aria-describedby / 相邻 .help 类 / small 标签 / muted 类）

#### 🆕 事件信息置信度可视化（ExtractionConfidenceBanner）

第 2 步事件信息编辑器顶部新增置信度横幅：

- 🟢 **AI 已从页面正文识别（claude 高置信）** —— 信任默认值
- 🟡 **部分字段是页面标题猜的 —— 请核对** —— 重点确认 "? 猜测" 标记的字段
- 🟠 **AI 提取置信度低 —— 大部分字段需手动确认** —— 全部手动确认
- 🔴 **AI 提取失败 —— 以下信息来自页面元数据** —— 全部手动填

每个字段右侧有小图标：默认无标记（已识别）、`? 猜测`（来自 OG/title）、`— 未识别`（AI 没填）。

---

### 开发者视角的改动

#### 新增模块

```
src/lib/state/session-state.ts      useTabSessionState hook + helpers
src/components/AsyncButton.tsx      idle/busy/done/error 4 态 + 超时 + 冷却
src/components/ErrorToast.tsx       Context-based toast queue
src/components/StatusBadge.tsx      可复用状态徽章
src/components/FieldExplainer.tsx   provenance 展示器
```

#### 修改

```
src/lib/db/types.ts                 + DetectedFieldProvenance, EventExtractionMeta
src/lib/fields/field-scanner.ts     + provenance 写入 + drop-zone 启发式 + Shadow DOM 递归
src/entrypoints/background.ts       sessionReadyPromise + EventExtractionMeta + semantic extraction
src/entrypoints/sidepanel/App.tsx   useTabSessionState + AsyncButton + ExtractionConfidenceBanner + FieldExplainer
src/entrypoints/options/App.tsx     alert() → toast
src/entrypoints/{popup,options,sidepanel}/main.tsx  + ToastProvider
src/lib/fields/field-scanner.test.ts  + 14 新测试
```

#### 测试 / 质量

- **TypeScript**：clean (严格 + exactOptionalPropertyTypes)
- **Unit tests**：32 通过（V1 基线 18 + 本轮新增 14）
- **Build**：2.76 MB（+20 KB，新组件 + provenance 序列化）
- **7 Quality Redlines**：R1-R7 全过

### 不在本轮的 V3 候选

- 用户首次上手引导（onboarding tour）
- 三入口（popup/sidepanel/options）职责拆清的视觉/文案
- 备份/经验库的产品语言可视化
- 完整真实用户验收（需 PM 跑真实表单）

### 装载 / 升级

```
1. chrome://extensions/
2. 找到 ApplyForge → 点 🔄 Reload
3. 推荐重新解锁一次 master password
```

### Breaking changes

无。所有 IndexedDB schema 兼容；旧 QARecord 不带 provenance 字段也能正常显示（FieldExplainer 在 `provenance` 为 undefined 时静默隐藏）。
