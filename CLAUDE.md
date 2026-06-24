# CLAUDE.md — ApplyForge

> Chrome 扩展：用用户的项目文档（BP / 产品介绍 / 技术架构）自动填写各类活动 / 创赛 / 孵化器报名表单，每次提交后学习。
> **本文件每次 session 自动加载** —— 只放**耐久铁律**和**已知坑**；细节进 `docs/PRD.md`，深档案进 `iteration-vault/`。

## 技术栈
WXT 0.19（Chrome MV3）· React 18 · TypeScript 5.6（strict + `exactOptionalPropertyTypes`）· Tailwind 3 · Dexie / IndexedDB · `@anthropic-ai/sdk` + `openai` · zod · zustand · react-i18next · lucide-react · pdfjs-dist + mammoth（文档解析）· Sentry。包管理 **pnpm**。

## 常用命令
- `pnpm dev` / `pnpm build`（wxt）· `pnpm compile`（`tsc --noEmit`）
- `pnpm lint`（`eslint src --max-warnings 0`，ESLint 9 flat config）
- `pnpm test`（vitest）· `pnpm test:e2e`（playwright）

## 耐久铁律（违反过会出事的）
1. **现在是 git 仓库了**（2026-06-08 起）—— remote `github.com/Jay-0807/fastapply`（**public**），默认分支 `main`。可以 `git log/diff`，但 git 历史从 v0.3.0 初次导入起；**v0.3.0 之前的迭代史仍在 `iteration-vault/` 和本文件**（别去 git 里找早于 2026-06-08 的历史）。改完记得 commit；public 仓库别提交任何密钥（`.env` 已 gitignore，只留 `.env.example`）。
2. **图标一律 lucide-react，禁止 emoji**（2026-05-29 redline；options/popup/sidepanel 三个 `App.tsx` 都已用 lucide）。
3. **`exactOptionalPropertyTypes: true`** —— 可选字段别显式赋 `undefined`，要么给值要么省略 key。
4. **改完必须回写文档**（闭合学习回路，见文末）。
5. **个人信息（PII）三条红线**（2026-06-24，V0.4.0 知识图谱起，部分反转旧 G5）——违反会泄露用户真实手机/邮箱/身份证：① 个人字段**可**自动回填，但**只回填用户在 Person 档案里存的本人真实值**（`graph/person-fields.ts` 确定性映射），**AI 草稿生成永远不碰个人信息**；② **OTP/验证码永不存、永不回填**（一次性，不可复用）；③ **个人/OTP 答案绝不种进 RAG 语料**（`rag/qa-seed.ts isSeedableQaPair`，`markRecordSubmitted` 种 chunk 前过滤）—— 回填的真实值会进 `qaPairs.finalValue`，若无差别种进 chunk 就会经"历史 Q&A"漏进未来所有草稿 prompt（Code GAN 实测发现的真 bug，与 V0.3.0「相邻 contenteditable PII 泄露」同源：**隐私边界要守数据流每一跳，不止填充点**）。

## 知识图谱 `src/lib/graph/` + `rag/retrieval.ts`（V0.4.0，2026-06-24）—— 结构化调取人员/项目/赛事
解决"调取信息方式有误、无结构化知识图谱"。实体：**Person**（`persons` 表，独立存本人真实信息）/ **Project.facts**（结构化项目事实，高优先 RAG 上下文）/ **EventContext.eventType+topicTags**（赛事分类）/ **QARecord.personIds**（人↔赛事↔答案三元边）。
- **图谱感知检索** `retrieveGraphAware`：历史 Q&A 按赛事相似度（主题/主办方/类型/地点，`graph/event-similarity.ts scoreEventSimilarity`）重排，**keyword 仍为主项（0.7 vs 0.3）保证非退化**；文档检索字节不变；无事件元信息时塌回 keyword baseline。别把它改成纯相似度盖过 keyword（会退化）。
- **个人信息回填** `graph/person-fields.ts`：`mapLabelToPersonFieldKey`（email/phone/idNumber 等具体族**先于** name 匹配，否则 ID 号误进 name）+ `resolvePersonalFills`（主联系人优先 + 回退；只回填本人已存值；**永不碰 OTP**）。多人表单"队员N"逐字段映射未做（MVP 用主联系人）。
- **项目 facts 注入** `prompts.ts formatProjectFacts`：空 facts → 空串（老项目 prompt 字节不变，无回归）。
- **结构化抽取** `background.extractProjectFactsFromText`：丢文件 → LLM 抽 facts+人员候选 → **返回候选、UI 确认后才入库**（不盲信 LLM，同 detectEventFromPage 外发姿态）。
- **Dexie v6→v7 迁移**：只重定义变更的 store（persons 新表 / eventContexts 加 eventType 索引 / qaRecords 加 `*personIds` multiEntry），**未重定义的表 Dexie 自动 carry-forward 不会丢**；`upgrade()` 幂等回填（`=== undefined` 守卫）。备份 formatVersion 2 含 persons（兼容 v1 老备份）。改 schema 仍走"§6 + schema.ts migration + tests"三件套。

## 字段扫描器 `src/lib/fields/field-scanner.ts` —— 核心资产，最容易踩坑
表单分两大形态，**两条路径都必须支持**：
- **ARIA 框架表单**（Google Forms / Qualtrics）：`role=radio/checkbox/listbox` 的 styled div —— 早期只支持这种。
- **手写中文表单**（gov / 创赛 / 孵化器 / 高校报名的**主流**形态）：flat `<div class="form-row">` + **纯文本节点标签**（无 `label[for]` / ARIA / placeholder）+ **native `<input type=radio/checkbox>`**。2026-05-30 真机 dogfood 才补上（检出 8→18 字段）：
  - 纯文本标签：`leadingLabelText` + `detectParentQuestionLabel`（wrapper 正则含 `form-row`，顺带回收"不超过 200 字"这类 maxLength）
  - native 单/复选分组：`collectNativeChoiceGroups`（按最近 row/fieldset 容器分组，**不是按 `name`**）
  - native 填充：`fillField` 走 `.checked` 不是 `.value`（`checkMatchingNative`）
- **自定义 JS 上传字段**（无 `<input type=file>`，`<a>上传</a>` + OS 弹窗）：`collectCustomUploadFields` 检出并标 `constraints.manualUploadOnly`；sidepanel 显示"需手动上传"卡 + 匹配资产一键下载；`fillPage` 跳过。⚠️ **浏览器安全：OS 文件弹窗无法被任何扩展程序化操作，永远做不到真·自动上传，只能辅助下载。** 别在文档或回复里声称能自动上传。
- **字段顺序 = DOM 顺序**（2026-05-31）：`scanFields` 分 4 个 pass 按**类型**收集（ARIA / native 选择 / 上传 / 普通 input），末尾必须按 `compareDocumentPosition` 排回文档顺序 —— 否则 radio 组会排到视觉上更靠前的 text 框前面。别假设结果按 pass 顺序。
- **标签隔离**（2026-05-31）：`detectParentQuestionLabel` 的标题只认**排在输入框之前**的（heading 必须 precede `el`），bare-text 兜底只认**最近一层** wrapper —— 否则 `form-row-group` 这类多行容器会把后面别的字段标题（如上传控件的"尚未上传任何文件"）误借给前面字段。
- **按钮组选择**（2026-06-01，Epic Connector）：styled `<button>` / `[role=button]` 当单/复选用（**无 input、无 `role=radio`、选中态只靠 CSS class**，三个旧 pass 全漏）→ `collectButtonChoiceGroups`（Pass 1.7）检出、`fillField` **点击匹配按钮**。⚠️ **防误判三连**（曾把页面导航栏当成字段）：排除 `nav/tablist/menu/toolbar/header/footer/banner` 容器 + 标签只认 `<label>`/heading/label-ish（不接受任意前导兄弟文本）+ 全部按钮须为非动作词（排除 Save/Cancel/提交…）。**单/复选判定**：标签含 `select up to N` / `多选` / `最多选 N 个` → checkbox，`single select` → radio。
- **两列式标签布局**（2026-06-06，HiCool）：`li.t-row > div.t-col > div.t-col-l(标签) + div.t-col-r(控件)` —— wrapper class 不匹配任何已知正则、标签在**兄弟单元格**里（不是输入框容器的前导文本）。旧逻辑下**所有字段退化成 placeholder、没 placeholder 的 select/radio/file 直接被丢**（检出 10→15）。→ `findSiblingLabelCell`（从控件向上爬，取**含标签文本但无控件**的前序兄弟格；**优先 `：` 结尾**的格、**跳过 `选择/上传` 等触发词**），接到 `detectParentQuestionLabel` 末尾兜底。⚠️ 别把"选择"按钮当标签、别漏 colon 优先（否则文件域标签变成"选择"）。
- **opacity:0 原生单复选**（2026-06-06，HiCool）：自定义样式把 native `<input type=radio/checkbox>` 透明化（`opacity:0`）是**主流写法**，旧的 `isLikelyRespondentField`（拒 opacity:0/小尺寸）会把整组漏掉。→ 单复选改用 `isRenderedChoiceInput`（**只拒 display:none/visibility:hidden/aria-hidden**，容忍 opacity:0 和 0 尺寸）；`nearestChoiceContainer` 增加"**最近含 ≥2 同型 input 的祖先**"兜底（cell 布局无 form-row class 时找到字段格）。
- **多文件域去重 + 上传假框**（2026-06-06）：多槽上传会暴露多个 `<input type=file>` → `scanFields` 末尾按 label 去重（同 label 留一个，不同 label 如 商业计划书/演示视频/代码 各留）。自定义上传旁的只读"上传文件"文本框 → `isUploaderDisplayBox`（placeholder 含上传词 + 邻近有 file input）跳过。
- **个人信息 / 验证码不让 AI 编**（2026-06-06，G5）：`detectSensitiveKind` 按 label 标 `constraints.noAiFill` + `sensitiveKind`（`otp`=验证码/captcha；`personal`=姓名/手机/邮箱/微信/身份证…，CJK 无词边界故用**子串**匹配）。sidepanel `generateAll` 跳过 noAiFill（同 file），FieldCard 显示"请你自己填"。别让 AI 瞎编联系人姓名/手机，别替用户填实时短信验证码。
- **混合 LLM 语义扫描**（2026-06-08，V0.3.0，§10 落地路径 1-2 步）：`src/lib/fields/semantic/` 新增「打标→蒸馏→LLM 提取→回填校验→编排」管线，与启发式并存。`AppSettings.scanMode`：`heuristic`（默认，零行为变化）/ `hybrid`（启发式 ∪ LLM 补漏）/ `llm`（纯 LLM）。**换没见过的表单不用改扫描器规则** —— 这是它存在的理由；启发式 `field-scanner.ts` 保留为快路径 + 交叉校验 + LLM 失败兜底（**绝不推倒**）。**承重不变式（违反会出事，每条都被 Code GAN 实测出过一次 bug）**：① **DOM 是硬约束唯一真相** —— maxLength/options/required 信 manifest 不信 LLM（`backfill.ts`）② **afId 必须在 manifest 存在否则剔除**（防幻觉）③ **蒸馏只发可见控件元信息、绝不发 input 已填 value**（隐私，`pureLabelText` 走文本节点不读 `.value`，含相邻 contenteditable）④ **LLM 失败 hybrid 退回启发式、不缓存失败结果、绝不白屏**（`orchestrate.ts`；缓存失败结果会让一次 429 整 session 失能）⑤ **合并用严格 label 匹配**（`strongLabelMatch`，单 token 重叠不算共识，否则 `First Name`/`Last Name` 误合并丢字段）⑥ **fill 前复校 afId 命中元素一致**（`consistency.ts`，防 React 重排把值写错框）⑦ **打标 `nextIndex` 必须递归 Shadow DOM**（否则 re-scan afId 碰撞）。注入是**方案 B**：`files` 注入挂 `__applyforge_tag_distill__` helper + 第二次 `func` 注入调它（`files:` 注入收不到 args，对齐现有 `__applyforge_fill__`）。⚠️ 真实表单 recall 真值仍须人工真机 dogfood（同 V2.3-V2.8）；默认 heuristic = 发布零风险；动态/分页字段静态扫不到，别在文档/UI 声称扫到。

## 批量生成 `background.ts` / `prompts.ts`
长多行答案会把裸换行塞进批量 JSON → `parseBatchResponse` 先 escape 控制字符再 parse，失败再走**结构感知提取**（`structuredExtract` 按已知键 f1..fN 切分取值，含引号/换行都不怕）；`generateBatchDrafts_handler` 任何批量失败都**逐字段 fallback**。别退回"批量失败 = 整批报错"。⚠️ **英文答案爱用 ASCII 引号 `"`（给术语加引号）会把批量 JSON 撞碎**（中文用全角引号不撞，所以强制英文后才暴露，2026-06-02 踩过）——`escapeControlCharsInStrings` 不转义引号、旧的"遇引号就停"正则会把值截成半句话。**别把 `structuredExtract` 退回那条正则**。
**字数上限**（2026-05-31 / 06-02 修正）：模型常**严重超限**（533 vs 200、3496 vs 2000）。**正解 = 让模型自己在限额内写"完整"**，不是事后截断（截断必丢信息，PM 否过）：`prompts.ts` 要求"在字数内写完整自洽内容，装不下就只留最重要的几点、每点完整"，`generateDraft` 超限时**最多重试 2 次**把超长稿喂回去压缩到 fit。`hardTruncate` 退化成**极少触发的最后保险**（别再当主力）。⚠️ 但保险也得对：**句末识别必须含 ASCII `.`**（英文句子以 `.` 结尾；要求后跟空格/结尾，避免切在 `epicconnector.ai`/`3.5` 中间）—— 旧集合只有 `。！？` 时英文永远退到逗号半句（06-02 踩过）。别把 `hardTruncate` 改回裸 `slice`、别删 ASCII 句号、别把重试砍回 1 次。
**生成语言 + 重生成提示词**（2026-06-01）：`prompts.ts` 的 `detectFormLang` 让生成语言**跟随表单**（英文表单输出英文，别被中文 RAG 语料带偏）。⚠️ **语言只看字段本身（label + placeholder），别把 event 活动背景加回判定信号** —— 中文活动会把英文字段误判成中文（踩过）。重生成支持"改写建议"：`refinement` 从 sidepanel 一路传到 `buildUserPrompt`；且 **`refineBlock` 必须排在 `langDirectiveFor` 之前**，否则自动语言指令会压过用户显式的"用英文"。

## dogfood / 自测硬约束
Chrome MCP（Claude in Chrome）**驱动不了扩展自身 UI**（sidepanel 是窗口级 chrome、options 被强制加 `https://` 前缀、`chrome://` 被屏蔽）。自测扫描器要用 **esbuild 把 `field-scanner.ts` 打成 IIFE 注入实时页面**再用 `javascript_tool` 调用（每次 eval 隔离，注入 + 调用要在同一次 call）。详见自动记忆 `chrome-mcp-dogfood-technique`。SMS 登录表单：**用户自己登**，别替他登（涉及他本人手机号）。

## 知识归档 —— 改完必须回写（本项目反复出问题的地方）
经验只往 vault 写、下轮没人读 → 失忆、重复踩坑。**每修一个坑 / 学一条教训，同一条改动落到 3 处**：
1. **CLAUDE.md（本文件）** —— 若是耐久铁律
2. **`docs/PRD.md`** —— 若改了产品能力：更新版本号 + 对应章节，别让"权威 PRD"停在旧描述
3. **自动记忆**（`~/.claude/projects/D--cursor-project-projects-project-application-google-chrome-extension/memory/`）—— 一句话索引进 `MEMORY.md`

深档案留 `iteration-vault/<日期>-<标题>/`。**单一权威源**：耐久铁律看本文件，产品真相看 PRD，深档案看 vault —— 一条教训只在一处写正文，别处只 link。
