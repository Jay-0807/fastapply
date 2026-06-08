# 2026-05-31 — Scanner order / label / length dogfood (second pass)

> Follow-up to `2026-05-30-real-form-dogfood/`. Same form (Shanghai 创100 startup-camp,
> `form_startup_camp.html`, behind SMS login). Driven via Chrome MCP (inject the
> esbuild-bundled scanner into the live page — see memory `chrome-mcp-dogfood-technique`).
> All three issues fixed + live-verified + unit-tested. 61 tests pass, lint clean, build 2.9 MB.

## What the PM reported
1. 申请人姓名 / 职位 / 邮箱 / 微信号 "没有按照顺序识别" — should be recognized, in order.
2. 项目简介 says "不超过 200 字" but generation stops at 200 chars **mid-sentence** (not a complete sentence).
3. (earlier) "每次到第三步都要输入主密码" — too often.

## Root causes + fixes

### #1 Field order (`field-scanner.ts` scanFields)
`scanFields` collects in 4 passes BY TYPE — Pass 1 ARIA groups, Pass 1.5 native radio/checkbox,
Pass 1.6 custom uploads, Pass 2 plain inputs — and pushed each pass's results in turn, then
`return fields` with **no document-order sort**. So native radio groups (是否成立公司 y=184,
创始团队 y=346) landed before the text inputs (项目名称 y=121, 申请人姓名 y=223, 职位 y=283)
that are visually earlier.
**Fix:** keep a parallel `fieldEls[]` (the source element per field), then sort the final list
by `el.compareDocumentPosition` (stable `a-b` fallback for disconnected/identical nodes).
**Live-verified:** scan output now 项目名称 → 是否成立公司 → 申请人姓名 → 职位 → 创始团队 → 手机号
→ 邮箱 → 微信号 → 项目简介 → … (exact DOM order).

### #2 Label pollution (`field-scanner.ts` detectParentQuestionLabel)
The text inputs' labels came back as "尚未上传任何文件 - 项目名称" etc. The input's own row has
only the "*" marker (real name is in `placeholder`), so `detectParentQuestionLabel` climbed up,
hit a `div.form-row-group with-icons` (matches the wrapper regex via the "form-row" substring),
and its heading search found a **later** sibling `<h2 class="list-title">尚未上传任何文件</h2>`
(a custom-upload widget's status) — returned it as the parent question label, then compounded
with the placeholder.
**Fix (two guards):**
- Heading candidates must **precede `el`** in document order (`compareDocumentPosition`) — a
  question title sits above its inputs; a later section's heading is not ours.
- The bare-text-node fallback is only trusted on the **nearest** wrapper (don't climb to grab an
  ancestor's leading text).
**Live-verified:** labels now clean — 项目名称 / 申请人姓名 / 职位 / 手机号(…) / 邮箱(…) / 微信号;
textareas still get their bare-text label (项目简介(不超过 200 字) etc.).

### #3 Mid-sentence truncation (`client.ts` hardTruncate + `prompts.ts`)
maxLength enforcement: generate → if over, retry "shorten" → if STILL over, `hardTruncate` =
`Array.from(text).slice(0, maxLength)` — a blind cut at char 200, mid-sentence.
**Fix:**
- `hardTruncate` walks back from the limit to the last sentence end (。！？!?…), then a clause
  break (，,；;、）)), then hard-clips only if a single sentence exceeds the whole budget
  (floor = 60% of the cap so we don't gut the answer).
- `prompts.ts` (single + batch + retry) now tell the model to write to ~90% of the cap and end
  on a complete sentence, so truncation rarely fires at all.

## Not a bug (diagnosed, no change)
"Re-enter master password at step 3 every time" — by design. The PBKDF2-derived AES key lives in
`chrome.storage.session` (ADR-005: RAM-only, cleared on browser close). Extension **reload** also
clears it — and we were reloading repeatedly while dogfooding, which amplified it. PM tested
"unlock → idle ~90s so the SW dies → regenerate" and it did **not** re-prompt → in-session restore
(`restoreSessionKey`) works. A "remember on this device across browser restarts" opt-in (persist
key to `storage.local`, weaker threat model) is available if the PM later wants it — deferred.

## Tests added (`field-scanner.test.ts` +3, `client.test.ts` +4 new file)
- returns fields in DOM order, not grouped by pass
- does NOT borrow a later sibling heading (upload-status leak)
- still inherits a PRECEDING shared question heading
- hardTruncate: unchanged under limit / cuts to last sentence / clause fallback / hard-clip long sentence

## 2026-06-01 follow-up #4 — button-group choice fields (Epic Connector hackathon form)
Third dogfood, different form (`evol.epicconnector.ai/.../ucws-singapore-hackathon`). CURRENT ROLE /
MAIN TRACK / EXTRA TRACK were undetected. Live DOM probe: they're `<label>` + a `<div class="flex">`
of `<button type="button">` options (Founder/Student/Professional, Agent/Skill/Application,
MiroMind/Not Interested). **No `<input>`, no `role=radio`, selected state = CSS class only** → falls
through Pass 1 (role=radio), Pass 1.5 (input[type=radio]), Pass 2 (input/textarea/select).
**Fix:** `collectButtonChoiceGroups` (Pass 1.7) — a container with ≥2 option-like buttons + a real
label → radio (or checkbox if label says multi). `fillField` gained a click-the-matching-button
branch. **False-positive guard:** first live run also grabbed the page's nav bar
(Overview/Features/Guides) because it borrowed the preceding countdown text as a label. Tightened to
(a) skip nav/tablist/menu/toolbar/header/footer/banner ancestors, (b) accept a label only from a
`<label>`/heading/label-ish preceding sibling, (c) require ALL buttons non-action (no Save/Cancel).
Re-verified live: exactly the 3 form groups, nav excluded. 65 tests pass, lint clean, build 2.9 MB.
The scanner now covers all three choice-control shapes: ARIA role=radio · native input · button-group.

## 2026-06-01 follow-up #5 — language / regenerate-hint / multi-select (same Epic Connector form, PM feedback)
Three PM tweaks, all fixed + verified (69 tests, build 2.91 MB):
1. **Answer language follows the form.** On the English form, Project Name/Description came back English but Tagline came back Chinese — inconsistent, because the RAG material is Chinese and the old system-prompt hint ("看 label 判断") was too weak. Added `detectFormLang(text)` (CJK-ratio) + `langDirectiveFor()` in `prompts.ts`; prepended a strong language directive to BOTH single + batch prompts. Unit-tested. **Bug-fix (same day, after PM retest):** the first cut keyed language off `field.label + event.name + event.theme` — but the PM's English form had a Chinese-detected EVENT context, so the directive said "用中文" and overrode even an explicit "用英文" regenerate refinement. Fixed two ways: (a) `detectFormLang` now uses ONLY the field's own `label + placeholder + helperText` (the field's language is the form's truth, not the user's event notes); (b) `refineBlock` moved ABOVE `langDirectiveFor` so an explicit user language request wins. Verified the refinement chain (sidepanel→bg→client→prompt) was correct all along — the regression was the competing auto-directive.
2. **Regenerate with a steering hint.** Was: regenerate just re-rolls. Added optional `refinement` threaded sidepanel input → `draft.generateOne` payload → `generateOneDraft` → `generateDraft` → `buildUserPrompt` (max-priority 【修改要求】 block). UI: each free-text field's 重生成 gets a small "改写建议(可选)" input (Enter or click applies). Choice/file fields keep the plain button.
3. **Multi-select Track.** `Track (select up to 2)` was detected as radio. Extended `collectButtonChoiceGroups` multi regex to catch `select up to N` / `choose up to N` / `最多选 N 个` / `选 N 项` / `多选`; "single select" still → radio. Live-verified: Track now checkbox with [Agent, Skill, Application, DeepResearch].

## 2026-06-02 follow-up #6 — English drafts cut mid-sentence (the real root cause, after two wrong turns)
PM reported Tagline/Description ending on a comma mid-sentence, UNDER their char limits. I first blamed batch-JSON embedded quotes (added structure-aware recovery — didn't help) then max_tokens — both WRONG. Added diagnostic logging in the SW console (`outTokens/maxTokens/textLen/tail`) and got the truth:
- `[AF.single.diag] field="Tagline" textLen=533` (cap 200), tail ends "...across teams." — a COMPLETE answer, but 2.6× over the cap. Description: `textLen=3496` (cap 2000). outTokens far below maxTokens → not a token cutoff.
- **Two real causes:** (1) the model massively overshoots the char cap even after the shorten-retry; (2) `hardTruncate`'s sentence-end set was `。！？!?…` — **it had NO ASCII period `.`** — so English answers (ending on ".") never matched a sentence boundary and always fell to the comma/clause fallback → half sentence. Chinese (`。`) had hidden this until force-English.
- **Fix:** `hardTruncate` recognises ASCII `. ! ?` when followed by whitespace/end (guard avoids cutting inside `epicconnector.ai` / `3.5` / `U.S.`) and always prefers the LAST complete sentence (dropped the 0.6 floor — completeness > squeezing chars). Prompt strengthened: hard-cap framing + word equivalent (`maxLength/6`) + "end on a period". 73 tests pass.
- **Process lesson:** when output looks truncated, log `outTokens vs maxTokens` + the raw tail FIRST; don't theorise about parsing. I burned two iterations guessing.
- **PM correction (#6 follow-up):** truncating to the last complete sentence is still lossy — the answer reads complete but DROPS info the model wanted in. Right mechanism: make the MODEL write complete-within-budget. Final design: prompt asks for "完整、自洽、能独立成立" content within the cap (drop less-important points, keep each complete); `generateDraft` retries up to 2× feeding the over-length draft back to compress-to-fit; `hardTruncate` (with the ASCII-period fix) is only the rare last-resort net so output never exceeds the form's server cap.

## 2026-06-02 follow-up #6 — batch JSON cut English drafts mid-sentence
After #5 forced English, the PM saw Tagline (127/200) and Description (1774/2000) end mid-sentence (e.g. "…self-iterate,") even though under the char limit — and "已生成 8/9". Root cause (traced in code, ~90% then confirmed by test): the **batch** path packs all fields into one JSON; English answers contain ASCII double-quotes (quoting terms), which `JSON.parse` chokes on; `escapeControlCharsInStrings` only escapes \n\r\t (not quotes), so parse fails again; the last-resort `regexExtractPairs` (value class `[^"\\]`) **stops at the first embedded quote**, truncating the value mid-sentence. Chinese never hit this (full-width quotes don't collide with JSON `"`) — the English fix in #5 exposed it. Not max_tokens (2048 single / 5656 batch — plenty) and not `hardTruncate` (under limit). Fix (PM chose "structure-aware recovery" over a delimiter-format rewrite or routing long fields to single): added `structuredExtract` as Attempt 3 in `parseBatchResponse` — it splits on the known f1..fN key markers and takes everything between as the value, preserving embedded quotes/newlines. Unit-tested with an embedded-quote payload. 72 tests pass, build 2.91 MB.
