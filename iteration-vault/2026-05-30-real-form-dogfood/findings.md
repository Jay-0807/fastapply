# 真机 dogfooding 发现 — 2026-05-30

**表单**: 上海市科技创业中心「2026年度创100+创业训练营报名表」
**URL**: https://www.startup-sh.cn/startupcamp/form_startup_camp.html（短信登录后）
**方法**: Chrome MCP 注入真实扫描器逻辑跑在真实 DOM 上
**build**: 22:34 (2026-05-30, 含 05-29 lucide/eslint 修复)

---

## 总判定：🔴 P0 — 扫描器在这类表单上几乎失效

| 指标 | 数值 |
|---|---|
| 表单实际问题数 | 20 |
| 可填 DOM 元素 | 50（可见 43 / 隐藏条件字段 7）|
| 原生 radio / checkbox | 24 / 9 |
| **扫描器检测到** | **8（仅带 placeholder 的文本框）** |
| **漏掉** | **11**（6 单选组 + 2 复选组 + 3 长文本）|

### 漏掉的 11 个（全是扩展唯一有价值的部分）

| 类型 | 字段 |
|---|---|
| 🔴 长文本 | **项目简介（不超过 200 字）** ← AI 生成核心价值 |
| 🔴 长文本 | **一句话项目介绍（不超过 20 字）** |
| 🔴 长文本 | **项目团队成员（不超过 200 字）** |
| 单选 | 是否成立公司 / 申请人是否属于创始团队成员 / 年龄 / 学历 / 是否全职创业 / 融资轮次 |
| 复选 | 您如何定义自己 / 通过何渠道获知 |

检测到的 8 个全是 **项目名/姓名/职位/手机/邮箱/微信** 这类填一下就完的身份字段 —— 扩展在这张表上的净价值 ≈ 0（核心长文本一个没抓到）。

---

## 根因：�d描器读不到「裸文本节点」label + 不认原生 radio/checkbox

这个表单（**简单中文政府/机构表单的极常见写法**）的结构：

```html
<div class="form-row no-padding">
  *项目简介(不超过 200 字)        ← label 是裸文本节点（非元素）
  <br>
  <textarea></textarea>           ← 无 label[for] / 无 placeholder / 无 ARIA / 无 maxlength 属性
</div>

<div class="form-row no-padding">
  *是否成立公司: 是 否            ← 问题+选项都是裸文本节点
  <input type=radio name=gender id=radio_yes>是
  <input type=radio name=gender id=radio_no>否   ← 原生 radio，选项文字在 radio 后面的文本节点
</div>
```

扫描器**没有任何代码路径**能读到这种 label：
1. `detectLabelWithSource`：`label[for]`✗ `closest('label')`✗ `aria-label`✗ `aria-labelledby`✗ → prevSibling 是 `<br>`/`<i>`（不在 `label|span|div|h\d` 正则）✗ → placeholder（textarea/radio 没有）✗ → **label="" → 字段被丢弃**
2. `detectParentQuestionLabel`：wrapper 类正则是 `form-group|form-item|question-...`，**不含 `form-row`** → 匹配失败；而且它找的是 heading 元素，这里 label 是裸文本节点 → 也找不到
3. `collectChoiceGroups`：**只处理 ARIA `role=radio/checkbox`**，完全不认原生 `<input type=radio>` → 33 个原生选项全部走 per-input 路径，各自因无 label 被丢弃
4. 字数限制连带丢失：「不超过 200 字」在裸文本 label 里，label 没读到 → maxLength 也没读到（其实 MAX_LENGTH_PATTERNS 的 `不超过 200 字` 能匹配，只要 label 能读到就自动生效）

附带：原生 radio 即使被检测到，`fillField` 也会把它当文本框 set `.value`（而非 `.checked`），根本勾不上。

---

## 修复方案（3 处，集中在 field-scanner.ts）

### Fix A — 裸文本节点 label 检测
- `detectParentQuestionLabel` 的 wrapper 正则加 `form-row` / `form-line` / 通用 `row`
- 当 wrapper 内找不到 heading 元素时，回退取 wrapper 的**前导文本节点**作 label（剥掉末尾选项文字 + `*` 标记 + 输入框自身 placeholder）
- 连带自动修复 3 个长文本的字数限制（「不超过 200/20 字」会被现有 MAX_LENGTH_PATTERNS 命中）

### Fix B — 原生 radio/checkbox 分组
- 新增一遍：原生 `<input type=radio>` 按 `name` 分组（HTML 语义），`<input type=checkbox>` 按 name/容器分组
- 选项 label 取每个 input 相邻文本节点 / 包裹 label
- 组 label 取容器前导文本节点
- 标记 consumed，避免 per-input 重复检测

### Fix C — 原生 radio/checkbox 填入
- `fillField` 当选择器命中原生 radio 组容器时，找相邻 label 匹配 value 的 `input[type=radio]` → set `.checked=true` + dispatch change
- checkbox 同理（多选）

### 验证
- 修完用同一个真机方法复跑：detected 应从 8 → ~19（覆盖 3 长文本 + 6 单选 + 2 复选）
- 加单测：flat `.form-row` + 裸文本 label + 原生 radio fixture

---

## 次要发现

- **#次1（登录闸）**：报名表前置短信登录页，扫描器会扫到 `手机号 + 验证码` 两字段当成可填 —— 建议识别 captcha/验证码/登录页场景跳过或提示（P2）
- **#次2（条件字段）**：7 个隐藏字段（如"公司名称"选"是"后才显示）。一次性扫描在揭示前抓不到。可考虑填完单选后提示"页面有新字段，要不要重扫"（P2）

---

## 影响面判断

这不是这一张表的特例 —— **裸文本 label + 原生 radio 的扁平 form 是简单中文报名表的主流写法**（政府、孵化器、高校、创赛大量用这种手写 HTML）。当前扫描器是针对 Google Forms / Qualtrics（ARIA 重型框架）调优的，对这类轻量手写表单基本失效。修了 A/B/C 才能覆盖国内大半报名场景。

---

## ✅ 修复 + 真机验证（2026-05-30 当天完成）

A/B/C 三处全部实现于 `src/lib/fields/field-scanner.ts`：
- **Fix A**：`detectParentQuestionLabel` 加 `form-row/form-line/field-row` + 无 heading 时回退取容器前导裸文本节点作 label（`leadingLabelText` + `cleanRowLabel`）
- **Fix B**：新增 `collectNativeChoiceGroups` —— 按最近 row/fieldset 容器分组原生 radio/checkbox，选项取相邻文本（`nativeOptionLabel`），scanFields 加 Pass 1.5
- **Fix C**：`fillField` 加原生 radio/checkbox 分支 + `checkMatchingNative`（set `.checked` 而非 `.value`）

### 验证结果

| | 修复前 | 修复后 |
|---|---|---|
| **真机 detected（同一表单）** | **8** | **18** ✅ |
| 6 个单选组（含完整选项+required） | 全漏 | ✅ 全抓到 |
| 2 个复选组 | 全漏 | ✅ 抓到 |
| 项目简介 / 一句话 / 团队成员 字数限制 | 全漏 | ✅ **200 / 20 / 200** |
| 单测 | 43 | **49**（+6 扁平表单/原生控件用例）|
| tsc / eslint / build | — | ✅ 全过，2.9 MB |

真机复跑方法：用 esbuild 把 field-scanner.ts 单独打成 IIFE 注入 live 表单调 `AFScanner.scanFields()`。

### 剩余 gap（非本次范围）
- 18 vs ~19：差的是隐藏条件字段（选"是"后才显示的"公司名称"等）—— 属次要发现 #次2 的一次性扫描限制，不是 label bug
- 次要发现 #次1（登录页 captcha 字段）未处理 —— P2，下轮

---

## 🔴 发现 #2（扫描修复后真机暴露）：批量生成 JSON 解析失败 + 无回退

**真机现象**：扫描修复生效后，用户在真表单点"AI 生成全部"，3 个长文本（项目简介/一句话/团队成员，被组成一批）全部失败：**"批量生成返回的 JSON 无法解析"**；选择题（走单字段路径）成功。

**根因**：
1. 批量生成（Feature D）让模型对多个字段返回 JSON。**长多行文本里的真实换行符**让 `JSON.parse` 直接抛错（`parseBatchResponse` 之前只处理 ```json 包裹 + 尾逗号，不处理裸控制字符）。
2. 批量失败后**没有回退** —— 旧设计"故意不单字段重试以防 burst"，结果是用户最重要的 3 个字段一起死。

**修复**（`prompts.ts` + `background.ts`）：
- **parser 三级容错**：原样 parse → 转义字符串内裸 \n\r\t 再 parse → 正则提取 `"fN":"..."` 兜底
- **单字段回退**：`generateBatchDrafts_handler` 改为：批量能出的字段照常广播；**任何批量没出/解析失败的字段，自动用单字段 `generateDraft` 重生成**（纯文本输出，无 JSON 脆弱性）。只回退失败子集，不会 burst 全表单。

**验证**：单测 49→52（+3 裸换行/正则兜底）；tsc/lint/build 全过 2.9MB。✅ 真机复测通过 —— 3 长文本全部生成，原生 radio/checkbox 真机填入全勾对（Fix C 首次真机验证）。

---

## 🟡 发现 #3（用户验收时提出）：自定义 JS 上传字段

**真机现象**：表单有「项目商业计划书」「其他材料」两个上传字段，但**全页面 0 个 `<input type=file>`** —— 上传按钮是 `<a>上传</a>` + JS 监听，点击弹**操作系统原生文件框**。

**硬限制（无法绕过）**：
1. 浏览器安全：OS 文件选择框是系统级弹窗，**任何**网页/扩展都无法用代码替用户选文件
2. 没有 `<input type=file>` 可注入 → DataTransfer 自动上传技术失效

> 澄清：ApplyForge 自动上传**没坏** —— 它在有真实 `<input type=file>` 的表单上能用。这类纯 JS 上传器是覆盖盲区。

**做了「检测 + 匹配资产 + 一键下载」助手**（用户选的方案）：
- **扫描器**：新增 `collectCustomUploadFields` —— 检测「上传触发文字 + 尚未上传状态 + 容器无 file input」的自定义上传块，标 `constraints.manualUploadOnly`。真机验证：精准检测 2 个，标签干净，无误报（拒绝含表单控件的过度 climb 块）
- **sidepanel**：`FileFieldPanel` 加 manualUploadOnly 变体 —— 显示「需手动上传」+ 资产匹配下拉 + 「⬇ 下载此资产」按钮（`downloadAsset` 经 assets.getBinary → Blob → 下载）
- **fillPage**：跳过 manualUploadOnly 字段（不尝试 DataTransfer）

**验证**：单测 52→54（+2 检测/防误报）；tsc/lint/build 全过 2.9MB。

---

## 本轮累计修复/新增（5 项）

| # | 项 | 状态 |
|---|---|---|
| 1 | 扫描器漏抓裸文本 label（3 长文本） | ✅ 真机 8→18 |
| 2 | 扫描器不认原生 radio/checkbox | ✅ 真机验证 |
| 3 | 原生 radio/checkbox 填入（.checked） | ✅ **真机勾选验证** |
| 4 | 批量生成 JSON 失败无回退 | ✅ 真机回退生效 |
| 5 | 自定义 JS 上传字段检测 + 一键下载助手 | ✅ 真机检测验证，UI 待 reload |
