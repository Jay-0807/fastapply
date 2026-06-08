# 深档案 — 字段识别 LLM 语义提取混合管线（V0.3.0）

> 2026-06-08 · AutoDev 全流水线一次跑通（从 Phase 2 崩溃断点恢复）· 本文件是**过程/对抗审查**深档案。
> 单一权威源：耐久铁律看 `CLAUDE.md`，产品真相看 `docs/PRD.md §9 V0.3.0 + §10`，方案细节看 `docs/plans/2026-06-08-llm-semantic-field-extraction-*.md`，本文件只记**别处不记的过程与 GAN 发现**。

## 一句话

把 PRD §10 旗舰方向从「提案」落地为「混合 completeness-pass」：启发式默认 + LLM 语义补漏（flag 后），**换没见过的表单不改扫描器代码**。零新增运行时依赖，131 测试，build 2.93 MB。

## 流水线轨迹

恢复点：`state.yaml` 显示 Phase 2 执行中途崩溃（仅有 ideation.md）。从 Phase 2 重启，走完 8 阶段 + 3 道 GAN（全 PASS）：

| 阶段 | 产出 | GAN |
|---|---|---|
| 2 产品规格 | oss-scan.md（复用决策：核心管线无可复用依赖，开源框架全 Playwright 运行时不兼容 MV3）+ design.md（MECE R1-R9 + 方案 B 收敛） | — |
| 3/4 UI/API | ui.md（5 面 + lucide 锁）/ api.md（消息契约 + BR1-13） | — |
| 5 规划 | plan.md（T1-T12 契约验收） | **Plan GAN**：r1 NEEDS_IMPROVEMENT→r2 PASS |
| 6 开发 | `src/lib/fields/semantic/` 13 文件 + 9 集成改动 | **Code GAN**：r1 NEEDS_IMPROVEMENT（4 真 bug）→r2 PASS |
| 7 验证 | verification-report.md | **Global GAN**：PASS（9/9/8/9） |
| 8 交付 | 文档回写 3 处 + 本档案 | — |

## GAN 实测发现（本档案核心价值 —— 别处不留）

### Plan GAN（代码前，5 findings 全修）
独立 reviewer 实地核对代码后发现：① T9 注入机制错配（`executeScript({files})` 收不到 args、tagger/distill 需 import 进 content.ts 才进 bundle、返回契约未进验收）② `callLLM` 当时未 export ③ 隐私：蒸馏可能外发已填 PII ④ afId 漂移→fill 写错框 ⑤ UI 护栏（F9 文案/recall 渲染/外发提示）未进验收。→ 改方案 B + 新增 T9b 守卫 + BR12/BR13。

### Code GAN（代码后，独立 reviewer 用一次性探针**实测**出 4 个真 bug，全修 + 各配回归测试）
1. **缓存污染**：`orchestrate` 把启发式兜底结果也缓存了 → 一次 transient 429 让整 session 不再调 LLM，且 UI 不显示 fallback。修：兜底分支不 `setCached`。
2. **假共识丢字段**：`mergeFields` 复用了**故意宽松**的 BR13 `labelsMatch`（单 token 重叠即 true）→ `First Name`/`Last Name` 误合并，LLM 多捞的字段被静默丢（英文表单尤其中招）。修：新增严格 `strongLabelMatch`（精确/包含/≥0.6 token 比），与 BR13 守卫的宽松匹配解耦。
3. **Shadow DOM afId 碰撞**：`nextIndex` 用 `querySelectorAll` 不穿 shadow，但 `walk` 穿 → re-scan 给 light 控件复用了 shadow 已用的 index。修：`nextIndex` 同样递归 shadow。
4. **相邻 contenteditable PII 泄露**：`extractNearbyText` 祖先兜底只减自身文本，相邻 contenteditable 的用户输入混进 nearbyText 发给 LLM（违 BR12）。修：`pureLabelText` 改文本节点遍历，跳过所有 interactive 后代。

> 教训：**「同一个宽松匹配器复用到两处语义相反的场景」是设计气味**（BR13 要松、BR8 要紧）；隐私「不发已填值」要防的不止自身控件，还有相邻富文本。

## 诚实边界（不可越界，与 §10 一致）
- 不承诺"无人复核、任意表单 100% 一一对应"。
- **真实表单 recall 真值留人工真机 dogfood**（fixture 是结构复刻，非抓取真实 HTML；与 V2.3-V2.8 一致）。默认 `heuristic` = 发布零风险。
- 动态/分页字段静态扫不到，UI 明示需翻页（复用 V2.7）。
- **未做**：landing-path 第 3 步（LLM 主路径化，待 recall 基准达标）、时间类交互式探索、sidepanel per-scan 模式下拉（O2）。

## 验收闸
`pnpm compile` 0 · `pnpm lint` 0 warning · `pnpm test` 131 · `pnpm build` 2.93 MB · content.js 含 `__applyforge_tag_distill__`。
