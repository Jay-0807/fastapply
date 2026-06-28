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
- **非破坏性种子导入** `graph/seed-import.ts importGraphSeed`（msg `graph.importSeed`，Options 人员档案「导入知识图谱种子(JSON)」）：批量灌 `{project, persons}`，**不清库**（区别于 backup 全量恢复的破坏式导入）；项目按 name 去重（facts 深合并、incoming 覆盖；extra 也深合并）、人员按 displayName 去重（fields 合并），导入的人 union 进 project.memberIds；幂等可重复导入。配 `facts` 编辑框「选项目即载入现有 facts」（ref 守卫防 live-query 刷新覆盖在改的值）。
- **⚠️ 真实 PII 绝不进公开仓**（2026-06-24，本仓 public）：从用户本地文件抽出的人员真实信息（身份证/手机/邮箱）+ 项目具体数据 → **种子 JSON 写到仓库之外**（如 `D:\cursor_project\applyforge-seed-*.json`）+ 直接交付用户，**永不 git add**。代码（importGraphSeed 等）可提交，数据不行。隐私边界从"数据流每跳"延伸到"git 边界"。
- **facts 是高频上下文要密度**：`formatProjectFacts` 把每个 facts 字段**逐条原样塞进每次草稿 prompt**；长论述（多页架构/三套财测）放**项目文档(RAG 按需检索)**，facts 只留高密度短句。导入真实项目时别把整段 BP 灌进 metrics/techStack（会每次撑爆 prompt）。
- **Dexie v6→v7 迁移**：只重定义变更的 store（persons 新表 / eventContexts 加 eventType 索引 / qaRecords 加 `*personIds` multiEntry），**未重定义的表 Dexie 自动 carry-forward 不会丢**；`upgrade()` 幂等回填（`=== undefined` 守卫）。备份 formatVersion 2 含 persons（兼容 v1 老备份）。改 schema 仍走"§6 + schema.ts migration + tests"三件套。

## 项目管理 + 一键导入 + 按项目归属（V0.4.1，2026-06-26）
- **级联删除覆盖所有 owned 表**（`src/lib/db/project-ops.ts deleteProjectCascade`）：删项目 = chunks(doc+qa) + documents + qaRecords + **projectAssets**（曾漏 assets 留孤儿，本轮修）+ project 行，一个 rw 事务；**persons 不删**（跨项目共享）。删除不可逆 → "无孤儿 / 不误删他项目 / 留共享 persons"是承重不变式，配回归测试。UI 走**带真实数量的二次确认**（`projectDeletionImpact`）。`indexDocument` 写 chunks 包进"查 doc 在否 + 写"同一事务，防与 cascade 竞态留孤儿 chunk。
- **一键多格式导入** `options BulkImportWizard`（项目档案首页）：drop pdf/docx/**pptx/xlsx**/img/md/txt → 文本 `parseDocument`、图片转资产 → 合并文本一次 `projectFacts.extract`（AI 归类 facts+人员）→ **确认页**（不盲信 LLM，同 detectEventFromPage 姿态）→ 落库。pptx/xlsx 用 **jszip 正则抽 `<a:t>`/`<t>`**（`parsers collectTagText`/`decodeXmlEntities` 纯函数可测，避开 SheetJS 重依赖）；空文本/超 25MB 跳过+标记。
- **人员/经验库按项目** many-to-many via `Project.memberIds`（一人可属多项目）：`ProjectScopePicker` 共享筛选（OptionsApp 提升 `selectedProjectId`，删项目后 useEffect 回退 '' 防悬空）；人员用**项目标签**管理归属；经验库按 `QARecord.projectId` 过滤。
- **⚠️ 去重循环必须回灌新建项**（Code GAN 两次踩中：seed-import 已守、bulk-import 本轮补）：凡"循环内 `create` + 后续按 displayName 去重"，新建后必须把该项 push 进比对集，否则同批重名候选建出重复行。
- **导入 commit 可续传**（非事务多步）：建项目后 `setTargetMode('existing')+pin id`、每文件落库标 `committed`，中途失败重试不重复传文档/资产、不再建空项目。

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
- **主标题/副标题分离 + 字数下限 + 视觉阅读顺序**（2026-06-29，深创赛 dogfood，纯函数 `src/lib/fields/field-normalize.ts` 可测）：① **主标题 ≠ 副标题** —— `analyzeElement:762` 把「父标题 ` - ` 内层」拼成 label，内层无 `<label>` 时回退 placeholder → 副标题被吞进主标题（"项目概要 - 产品开发：…"）。修法是**后处理** `cleanDisplayLabel`（约束抽取仍跑在 RAW label 上，不丢限制；之后才清洗）：去「请输入/请填写」前缀、去尾部「（…字…）」、**仅当 placeholder 是 hint-like（≥8 字 / 带标点 / 请输入式）才砍掉并入的 ` - placeholder` 尾**——**短裸 placeholder（"姓名"/"职称"）是真子标签，必须保留**复合 label（"出席项目队员 - 姓名"），别一刀切。副标题留在 `constraints.placeholder`，FieldCard 渲染成输入框灰色 placeholder（输入即消失，和页面一致）。② **字数下限**：`extractMinLength`（最少/至少/不少于/N字以上）补进 `constraints.minLength`，**DOM `minLength` 属性优先**（`!c.minLength` 守卫）；prompts.ts 把 min/max/placeholder 全部喂进生成（强约束）。③ **视觉阅读顺序**：`scanFields` 末尾改用 `readingOrder(rects)`（按 `getBoundingClientRect` 行分组、行内按 left）替代纯 DOM 顺序，解决两列布局 DOM≠视觉；**rect 全退化（happy-dom/无布局）→ 返回 null 回退 DOM 顺序**（保 54 fixture 字节不变）。⚠️ **GAN 抓到两坑已修+配测**：行分组按**行锚 anchor 的盒**判定、不按 running max-bottom（否则高 textarea 把下一行链进同一 band 再被列排打乱）；**无盒字段（display:none/条件页）排到末尾按 DOM 序**、绝不因 rect=0 顶到最前。真实 label 仍须真机 dogfood 确认。

## 多页报名累计沉淀（V0.4.3，2026-06-28）—— 整份报名存一条经验
向导式多页表单（创赛 / 孵化器 / 高校：赛区→基本信息→团队→…）**反转 V2.7 的「每页各封一条」**（PM 拍板：整份报名存一条）。第 3 步（draft）新增「下一页继续填」：快照当前页 Q&A 进 `accumulatedPages`（`useTabSessionState`，按 tab 隔离、随重开存活）→ 重置当前页瞬态 → 扫下一页，**不封存**；「全部填完，沉淀经验」用 `combinePages` 把所有页合成 **1 条 QARecord**（1 markdown / 1 次 RAG 种入）后清空累计器。纯逻辑在 `src/lib/sidepanel/page-accumulator.ts`（可测）。
- **承重不变式（违反丢数据 / 串号 / 泄露，每条配单测/GAN）**：① 跨页合并用**扁平数组 QAPair[]，绝不 fieldId-keyed map** —— `fieldId=af-field-${counter}-${hash(containerHTML)}`，counter 每扫描重置 → 跨页**非保证唯一**，map 合并会互相覆盖丢字段（同 [[去重循环必须回灌]] 教训家族）② **单页零回归**：不点「下一页」时 `accumulatedPages=[]`，封存 = 今天逐字节相同 ③ **同页守卫 `isLikelySamePage`**（fieldId 重叠 >50% ⇒ 站点没翻页，警告**不快照**，防重复累计）④ **PII 边界不变**：seal 仍 `record.qaPairs.filter(isSeedableQaPair)` 逐条过滤，合并后个人/OTP 照样不进 RAG ⑤ **项目固定**：step 机前向**无 `setStep('project')`**，累计期改不了项目 → 累计页恒属当前 projectId；**若 future 加「返回选项目」入口，必须给 AccumulatedPage 盖 owner 戳并在 seal 丢弃不匹配页**（否则 page-1 答案串进别的项目 RAG）。
- **已知限制**：`isLikelySamePage` 对**纯重复结构页**（成员1/成员2 同骨架）会误拦且无 override（目标 gov 表单各页不同 section 不受影响）→ 记 follow-up，别加"二次点击强制"（会和双击防重冲突，要显式 override 控件）。
- **dogfood**：按钮交互 Chrome MCP 驱动不了 sidepanel 自身（见 [[chrome-mcp-dogfood-technique]]），真机翻页 recall 留人工；自动上传永远做不到（OS 弹窗不可程序化）。

## 主密码解锁（已知坑，2026-06-28）—— 校验要对"真实存在的"密文
`unlockSettings`（`background.ts`）靠"能否解密一条已存密文"来校验主密码。**老 bug**：它**只**试解 legacy 字段 `encryptedAnthropicKey`，但 V2.2+ 的 key 都存在 `llmConfigs[].encryptedKey`，configs-only 安装的 legacy 字段是 `''` → `''.split('::')` 解空串必抛 → **不管密码对不对都报 "Wrong master password"**（解锁全废 → 没会话密钥 → 第2步 Claude 活动提取退回 OG/meta、第3步 LLM 补漏 "Settings locked"，一条根因三处症状）。**修法**：`collectUnlockVerificationTargets(settings)`（`src/lib/crypto/unlock-target.ts`，纯函数可测）收集**所有**已存密文（全部 `llmConfigs[].encryptedKey` + legacy），`unlockSettings` **逐一试解、任一解开即解锁**；都没有则**直接接受**（无密文可验也就无"错"，下次 encrypt 采用此密码）。⚠️ **为什么是"所有"不是"第一条"**（2026-06-28 真机二次踩中）：`addLLMConfig` 用**加配置当时输入的密码**派生 key 加密、**不校验已有配置**，所以两个配置可各自用**不同主密码**加密（salt 同一个）；只验第一条 → 你输的是第二条的密码就被判错（"重建+正确密码还报错" 即此）。试全部后，输哪个配置的密码就解锁那批；wrong 密码仍对全部密文失败 → 照样拒。`deriveKey`（贵的 PBKDF2）在循环外只跑一次，循环内只做廉价 AES-GCM decrypt。⚠️ **不削弱安全**：接受集 = 用户自己设过的密码并集，`setSessionKey` 只在某条解密成功后调。⚠️ 别改回"只认第一条/固定字段"。**根因未除**（旁注）：`addLLMConfig`/`saveSettings` setSessionKey 在前、加配置不校验旧密码 → 配置间密码漂移；彻底解需"加配置时强制与已有密码一致 + 提供统一密码的迁移"，本次只在解锁侧兜底。

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
