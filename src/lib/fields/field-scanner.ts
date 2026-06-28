// Field scanner — the core innovation.
//
// Claude for Chrome's documented failure mode is that it "couldn't see" field
// constraints (max length hints, required markers, helper text). This scanner
// extracts ALL relevant constraint information from the DOM so the LLM prompt
// can enforce it. See ADR-006 for scan strategy.
//
// Runs INSIDE the content script (has DOM access). Returns serializable
// DetectedField[] back to the service worker via chrome.runtime messaging.

import type { DetectedField, FieldType, FieldConstraints, DetectedFieldProvenance } from '@/lib/db/types';
import { extractMinLength, cleanDisplayLabel, readingOrder } from './field-normalize';

/**
 * URLs that are known form-editor / admin pages where every scan would return
 * meaningless internal inputs ("question number", "default score", etc.).
 * When we detect one, scanFields() returns [] and the UI surfaces a clear
 * "wrong URL" hint instead of pretending it found 57 fields.
 */
export const FORM_EDITOR_URL_PATTERNS: { match: RegExp; label: string; hint: string }[] = [
  {
    match: /^https?:\/\/docs\.google\.com\/forms\/d\/[^/]+\/edit/,
    label: 'Google Forms editor',
    hint: '当前是 Google Forms 的编辑页（URL 含 /edit）。请打开公开填写链接（URL 形如 /forms/d/e/.../viewform）后再扫描。',
  },
  {
    match: /^https?:\/\/admin\.typeform\.com\//,
    label: 'Typeform editor',
    hint: '当前是 Typeform 的编辑后台。请打开公开填写链接（URL 形如 https://form.typeform.com/to/...）后再扫描。',
  },
  // UX iteration 2026-05-23: extend coverage to more form builders that have
  // distinct editor URLs. Previously a user opening Qualtrics' "Edit Survey"
  // page or Tally's editor would see 50+ phantom fields from admin UI.
  {
    match: /\/edit-survey/,
    label: 'Qualtrics editor',
    hint: '当前是 Qualtrics 的编辑页。请打开预览链接（含 /preview/SV_... 或公开链接 /jfe/form/SV_...）后再扫描。',
  },
  {
    // Match both "tally.so/forms/<id>/edit" and "tally.so/<workspace>/forms/<id>/edit"
    // (workspace prefix is optional in Tally's URL scheme).
    match: /^https?:\/\/tally\.so\/(?:[^/]+\/)?forms\/[^/]+\/edit/,
    label: 'Tally editor',
    hint: '当前是 Tally 的表单编辑页。请打开公开链接（tally.so/r/...）后再扫描。',
  },
  {
    match: /^https?:\/\/(?:www\.)?jotform\.com\/(?:build|edit)/,
    label: 'Jotform editor',
    hint: '当前是 Jotform 的表单设计器。请打开公开链接（form.jotform.com/...）后再扫描。',
  },
  {
    match: /^https?:\/\/(?:www\.)?wjx\.cn\/(?:newwjx|design|edit)/,
    label: '问卷星编辑器',
    hint: '当前是问卷星的设计页。请打开正式问卷链接（wj.qq.com/s2/... 或 wjx.cn/jq/...）后再扫描。',
  },
];

/**
 * Labels that identify FORM-BUILDER admin controls rather than respondent
 * fields. If any of these match (substring), the field is skipped — even if
 * it survived visibility filtering. Catches Google Forms editor "Question
 * number"/"Default score"/"Add option" style fields that aren't filterable
 * by visibility alone because the editor renders them as normal inputs.
 */
const ADMIN_LABEL_PATTERNS: RegExp[] = [
  // Chinese (Google Forms editor terms)
  /问题编号|回复编号|问题描述|问题标题|题目编号|题目类型/,
  /添加选项|新增选项|删除选项|删除问题|复制问题/,
  /默认分值|答对得分|答错得分|总分|得分|分值/,
  /标题与说明|表单标题|表单描述|节标题/,
  /添加问题|添加节|插入图片|插入视频/,
  // Other form builders' Chinese terms (Jotform/腾讯问卷/Tally/金数据)
  /字段标签|字段类型|字段设置|题目设置|题型设置|选项设置/,
  /编辑题目|编辑选项|新建题目|表单设计/,
  // English equivalents
  /\b(question|response|item)\s+(number|id|description|title)\b/i,
  /\b(add|delete|remove)\s+(option|choice|question|section)\b/i,
  /\b(default\s+)?(score|points|grade)\b/i,
  /\b(form|section)\s+(title|description)\b/i,
  // Jotform / Gravity Forms / Wufoo / Typeform admin
  /\b(field|form)\s+(label|settings|properties|configuration)\b/i,
  /\b(question|section)\s+settings\b/i,
  /\b(add|edit|delete)\s+(field|element|item)\b/i,
];

const MAX_LENGTH_PATTERNS = [
  // Chinese: 最多 200 字 / 不超过 500 字 / 200 字以内 / ≤ 1000 字
  /(?:最多|不超过|不多于|限|不能超过|不可超过)\s*(\d{2,5})\s*(?:字|个字|汉字)/,
  /(\d{2,5})\s*字\s*(?:以内|以下|之内|左右|上下)/,
  /[≤<]\s*(\d{2,5})\s*(?:字|汉字)/,
  // Chinese "约 X 字" / "大约 X 字" / "控制在 X 字"
  // UX iteration 2026-05-23: PM forms in the wild use "约" and "控制在" — the
  // strict "不超过" pattern missed those, letting Claude generate 400 chars
  // when the form said "约 200 字" (silently truncated by server).
  /(?:约|大约|大致|大概)\s*(\d{2,5})\s*(?:字|个字|汉字)/,
  /控制在\s*(\d{2,5})\s*(?:字|个字|汉字)\s*(?:以内|以下|之内|左右)?/,
  // Chinese instruction-style: "用 200 字介绍" / "请用 500 字描述" / "以 100 字说明"
  // This caught the most common Chinese form pattern that earlier patterns
  // missed — e.g. the Google Form label "请用 200 字介绍你的项目".
  /(?:请\s*)?(?:用|以)\s*(\d{2,5})\s*(?:字|个字)(?:\s*(?:左右|以内|上下))?\s*(?:介绍|描述|说明|阐述|回答|表述|概括|总结|讲|谈|写)/,
  // Chinese range: "100-200 字" / "100~200 字" — take upper bound as the cap
  /\d{1,5}\s*[~\-—–至到]\s*(\d{2,5})\s*(?:字|个字|汉字)/,
  // English: max 200 words / no more than 500 characters / 200 chars max
  /(?:max(?:imum)?|no more than|up to|at most|within|under)\s+(\d{2,5})\s+(?:words?|chars?|characters?)/i,
  /(\d{2,5})\s+(?:words?|chars?|characters?)\s+(?:max(?:imum)?|or less|or fewer)/i,
  // English: "in 200 words" / "in 500 characters"
  /\b(?:in|with(?:in)?)\s+(\d{2,5})\s+(?:words?|chars?|characters?)\b/i,
  // English casual: "about 200 words" / "around 500 characters" / "approximately"
  /\b(?:about|around|approximately|approx\.?)\s+(\d{2,5})\s+(?:words?|chars?|characters?)\b/i,
];

const REQUIRED_PATTERNS = [
  /\*$/, // trailing asterisk on label
  /\(required\)/i,
  /必填/,
  /必须/,
];

/**
 * Result of detecting which page we're on. Returned by `inspectPage()` so the
 * UI can show a helpful error before even attempting to scan.
 */
export interface PageInspection {
  url: string;
  isEditor: boolean;
  editorHint?: string;
}

export function inspectPage(url: string = (typeof location !== 'undefined' ? location.href : '')): PageInspection {
  for (const pat of FORM_EDITOR_URL_PATTERNS) {
    if (pat.match.test(url)) {
      return { url, isEditor: true, editorHint: pat.hint };
    }
  }
  return { url, isEditor: false };
}

/**
 * Walk the DOM and detect every fillable field with its full constraint set.
 * Recurses into open Shadow DOM. Same-origin iframes are walked too.
 *
 * Two passes — and the order matters:
 *   1) ARIA choice groups (role="radio" / role="checkbox" / role="listbox"
 *      grouped inside a listitem or group container). Google Forms and most
 *      modern form libraries render their radios/checkboxes as styled divs
 *      with ARIA roles, NOT as native <input type="radio">. The plain HTML
 *      scan misses them entirely, and worse, it picks up the inline "Other"
 *      text input nested inside a radio group and misclassifies it as a
 *      standalone text field.
 *   2) Standard <input>/<textarea>/<select>, skipping any element already
 *      "consumed" by an ARIA group from pass 1.
 *
 * Both passes filter for visibility + admin-UI exclusion. The earlier version
 * of this function was over-greedy — on a Google Forms /edit page it would
 * return 50+ fields (every "Add option" / "Question number" / "Default score"
 * input in the editor UI). The visibility + label-pattern filter brings it
 * back to just respondent-facing fields.
 */
export function scanFields(root: Document | ShadowRoot = document): DetectedField[] {
  // Hard bail if we're on a known form-editor URL — the editor has dozens of
  // admin inputs that look fillable but aren't.
  if (typeof location !== 'undefined') {
    const pageInfo = inspectPage(location.href);
    if (pageInfo.isEditor) {
      // Caller (sidepanel) will see an empty result + can surface editorHint
      // via a separate "where am I" check. Return [] rather than throwing so
      // a stray editor tab doesn't crash the pipeline.
      return [];
    }
  }

  const fields: DetectedField[] = [];
  // Parallel array to `fields`: the DOM element each field was detected from.
  // Used at the very end to re-sort the list into document (visual) order,
  // because detection runs in passes BY TYPE, not by position.
  const fieldEls: (Element | null)[] = [];
  let counter = 0;
  const consumed = new Set<Element>();

  // Pass 1: ARIA choice groups (radio / checkbox / listbox).
  for (const group of collectChoiceGroups(root)) {
    const fieldId = `af-field-${counter++}-${stableHash(group.containerHTML)}`;
    const provenance: DetectedFieldProvenance = {
      // Tag as shadow-dom if the container is inside one — T19 lets us
      // detect e.g. LWC radio groups; without this provenance hint the user
      // sees nothing distinctive about how the field was found.
      source: group.container.getRootNode() instanceof ShadowRoot ? 'shadow-dom' : 'aria-group',
      selector: group.containerSelector,
      visibilityState: getVisibilityState(group.container),
      // ARIA groups always get their label from the question wrapper (heading /
      // aria-label / aria-labelledby); we recorded which path won in
      // collectChoiceGroups.
      labelSource: group.labelSource,
      labelConfidence: group.labelConfidence,
      // ARIA groups don't have native maxLength/helperText constraints; users
      // either pick from options or write Other. Leave undefined.
      maxLength: undefined,
      helperText: undefined,
    };
    fields.push({
      fieldId,
      domSelector: group.containerSelector,
      label: group.label,
      type: group.type,
      constraints: {
        options: group.options.map((o) => o.text),
        required: group.required,
      },
      rawElementInfo: {
        tagName: 'div',
        classes: [],
      },
      provenance,
    });
    fieldEls.push(group.container);
    // Mark every option element + any nested input ("Other" free-form box)
    // as consumed so pass 2 doesn't re-detect them.
    for (const opt of group.options) consumed.add(opt.el);
    group.container.querySelectorAll('input, textarea').forEach((n) => consumed.add(n));
  }

  // Pass 1.5: NATIVE <input type=radio/checkbox> groups (UX iteration
  // 2026-05-30). The ARIA collector above only handles role=radio styled divs
  // (Google Forms / Qualtrics). Simple hand-written forms use real native
  // radios with option text as adjacent text nodes — without this pass each
  // one is processed individually, fails label detection, and is dropped.
  for (const group of collectNativeChoiceGroups(root)) {
    // Skip if these inputs were already captured (e.g. nested in an ARIA group).
    if (group.options.some((o) => consumed.has(o.el))) continue;
    const fieldId = `af-field-${counter++}-${stableHash(group.containerHTML)}`;
    const provenance: DetectedFieldProvenance = {
      source: group.container.getRootNode() instanceof ShadowRoot ? 'shadow-dom' : 'html-input',
      selector: group.containerSelector,
      visibilityState: getVisibilityState(group.container),
      labelSource: group.labelSource,
      labelConfidence: group.labelConfidence,
      maxLength: undefined,
      helperText: undefined,
    };
    fields.push({
      fieldId,
      domSelector: group.containerSelector,
      label: group.label,
      type: group.type,
      constraints: {
        options: group.options.map((o) => o.text),
        required: group.required,
      },
      rawElementInfo: { tagName: 'div', classes: [] },
      provenance,
    });
    fieldEls.push(group.container);
    // Consume ONLY the choice inputs — NOT sibling text inputs (e.g. an "其他"
    // free-text box), which should remain a separately fillable field.
    for (const opt of group.options) consumed.add(opt.el);
  }

  // Pass 1.7: BUTTON-GROUP choice fields (UX iteration 2026-05-31). Styled
  // <button> single/multi-selects with no input + no role=radio — e.g. Epic
  // Connector's Main Track [Agent][Skill][Application]. Falls through passes
  // 1/1.5/2 entirely, so detect them explicitly here.
  for (const group of collectButtonChoiceGroups(root)) {
    if (group.options.some((o) => consumed.has(o.el))) continue;
    const fieldId = `af-field-${counter++}-${stableHash(group.containerHTML)}`;
    const provenance: DetectedFieldProvenance = {
      source: group.container.getRootNode() instanceof ShadowRoot ? 'shadow-dom' : 'html-input',
      selector: group.containerSelector,
      visibilityState: getVisibilityState(group.container),
      labelSource: group.labelSource,
      labelConfidence: group.labelConfidence,
      maxLength: undefined,
      helperText: undefined,
    };
    fields.push({
      fieldId,
      domSelector: group.containerSelector,
      label: group.label,
      type: group.type,
      constraints: {
        options: group.options.map((o) => o.text),
        required: group.required,
      },
      rawElementInfo: { tagName: 'div', classes: [] },
      provenance,
    });
    fieldEls.push(group.container);
    for (const opt of group.options) consumed.add(opt.el);
  }

  // Pass 1.6: CUSTOM JS upload fields (no <input type=file>). UX iteration
  // 2026-05-30. Detected so the sidepanel can match an asset + offer a
  // one-click download; flagged manualUploadOnly so fillPage skips them.
  for (const up of collectCustomUploadFields(root)) {
    const fieldId = `af-field-${counter++}-${stableHash(up.containerHTML)}`;
    const provenance: DetectedFieldProvenance = {
      source: 'drop-zone',
      selector: up.containerSelector,
      visibilityState: getVisibilityState(up.container),
      labelSource: 'parent-heading',
      labelConfidence: 'inferred',
      maxLength: undefined,
      helperText: undefined,
    };
    fields.push({
      fieldId,
      domSelector: up.containerSelector,
      label: up.label,
      type: 'file',
      constraints: { required: up.required, manualUploadOnly: true },
      rawElementInfo: { tagName: 'div', classes: [] },
      provenance,
    });
    fieldEls.push(up.container);
  }

  // Pass 2: standard HTML inputs.
  const elements = collectFillableElements(root).filter((el) => !consumed.has(el));
  for (const el of elements) {
    const fieldId = `af-field-${counter++}-${stableHash(el.outerHTML.slice(0, 200))}`;
    const detected = analyzeElement(el, fieldId);
    if (detected) {
      fields.push(detected);
      fieldEls.push(el);
    }
  }

  // Order to match how a human reads the page: top→bottom, then left→right
  // within a row. Detection runs in passes BY TYPE (ARIA / native choice /
  // upload / plain inputs), so the raw push order is type-grouped, not visual.
  // Geometry (getBoundingClientRect) is the truth for two-column / grid layouts
  // where DOM order ≠ visual order (深创赛: left text column + right upload
  // column on the same row). When there's no layout (zero-sized rects — e.g.
  // happy-dom in tests, pre-paint), readingOrder returns null and we fall back
  // to DOM document order (the prior behavior — keeps fixtures byte-identical).
  const rects = fieldEls.map((el) => {
    const r = el?.getBoundingClientRect?.();
    return r ? { top: r.top, left: r.left, width: r.width, height: r.height } : { top: 0, left: 0, width: 0, height: 0 };
  });
  let order = readingOrder(rects);
  if (!order) {
    order = fields.map((_, i) => i);
    order.sort((a, b) => {
      const ea = fieldEls[a];
      const eb = fieldEls[b];
      if (!ea || !eb || ea === eb) return a - b;
      const rel = ea.compareDocumentPosition(eb);
      if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return a - b;
    });
  }
  const ordered = order.map((i) => fields[i]!);

  // G4 (2026-06-06): collapse duplicate file inputs that resolve to the SAME
  // label — multi-slot uploaders expose several hidden <input type=file> for one
  // logical field (HiCool 商业计划书 exposed upfile-1/2/3). Keep the first.
  const seenFileLabels = new Set<string>();
  return ordered.filter((f) => {
    if (f.type !== 'file') return true;
    if (seenFileLabels.has(f.label)) return false;
    seenFileLabels.add(f.label);
    return true;
  });
}

/**
 * Find ARIA choice groups (radio / checkbox / listbox) — the controls that
 * are invisible to the standard input/textarea/select scan because they're
 * built from styled divs with ARIA roles.
 */
interface ChoiceGroup {
  type: 'radio' | 'checkbox' | 'select';
  container: HTMLElement;
  containerSelector: string;
  containerHTML: string;
  label: string;
  /** UX iteration 2026-05-23 (T13): which DOM hook supplied the label. */
  labelSource: DetectedFieldProvenance['labelSource'];
  labelConfidence: DetectedFieldProvenance['labelConfidence'];
  required: boolean;
  options: { text: string; el: HTMLElement }[];
}

function collectChoiceGroups(root: Document | ShadowRoot, depth: number = 0): ChoiceGroup[] {
  // UX iteration 2026-05-23 (T19): bounded recursion into shadow roots.
  // Web Components (LWC, Shoelace, etc.) hide their radio/checkbox groups
  // inside shadow trees that querySelectorAll on the host document can't
  // reach. Without this, those forms reported "0 choice groups detected"
  // even when 5 radio questions were visible on screen.
  const MAX_DEPTH = 5; // arbitrary safety bound; real shadow nesting rarely exceeds 3
  if (depth > MAX_DEPTH) return [];

  const groups: ChoiceGroup[] = [];
  const seenContainers = new Set<Element>();

  // We look for option elements first, then walk up to a sensible container
  // (the question's wrapper). Google Forms wraps each question in a
  // role="listitem"; many other form libs use role="radiogroup" or just a
  // role="group". Fallback: find the nearest common ancestor with a heading.
  const radios = Array.from(root.querySelectorAll<HTMLElement>('[role="radio"]'));
  const checkboxes = Array.from(root.querySelectorAll<HTMLElement>('[role="checkbox"]'));
  const listboxOpts = Array.from(root.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]'));

  pushAriaGroup('radio', radios);
  pushAriaGroup('checkbox', checkboxes);
  pushAriaGroup('select', listboxOpts);

  // Recurse into open shadow roots. We deliberately cap with a node limit
  // (max 1000 elements scanned) to prevent extreme DOMs from hanging the scan.
  let nodeBudget = 1000;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    if (--nodeBudget <= 0) break;
    const sr = (el as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (sr) {
      groups.push(...collectChoiceGroups(sr, depth + 1));
    }
  }

  return groups;

  function pushAriaGroup(type: ChoiceGroup['type'], elements: HTMLElement[]) {
    // Group by the closest containing element that holds the full question.
    // Priority order matters: a Google Form question is structured as
    //   <div role="listitem">  ← the LABEL/HEADING lives here
    //     <div role="heading">问题标题</div>
    //     <div role="radiogroup">  ← but the options live inside this child
    //        <div role="radio">...</div>
    //     </div>
    //   </div>
    // If we pick radiogroup as the container, detectGroupLabel can't find the
    // heading (it's in the listitem ancestor, not a descendant). So prefer
    // the broader question wrapper when one exists.
    const byContainer = new Map<Element, HTMLElement[]>();
    for (const el of elements) {
      const container =
        el.closest('[role="listitem"]') ||
        el.closest('fieldset') ||
        el.closest('[role="radiogroup"]') ||
        el.closest('[role="listbox"]') ||
        el.closest('[role="group"]') ||
        el.parentElement;
      if (!container) continue;
      const arr = byContainer.get(container) ?? [];
      arr.push(el);
      byContainer.set(container, arr);
    }
    for (const [container, opts] of byContainer.entries()) {
      if (seenContainers.has(container)) continue;
      seenContainers.add(container);
      // Skip groups whose container itself is admin UI or invisible.
      if (!isLikelyRespondentField(container as HTMLElement)) {
        // isLikelyRespondentField excludes containers in toolbars / aria-hidden,
        // even though the container isn't strictly an "input".
        // Note: a radiogroup container with no fillable input descendant would
        // already be invisible-filtered upstream, but ARIA groups bypass that
        // path, so we re-apply the check here.
      }
      const labelResult = detectGroupLabel(container as HTMLElement);
      if (!labelResult.value) continue; // skip unlabeled — would just hallucinate
      if (isAdminLabel(labelResult.value)) continue; // skip admin-UI groups
      const required = /[**]\s*$/.test(labelResult.value) || /必填|必须/.test(labelResult.value);
      groups.push({
        type,
        container: container as HTMLElement,
        containerSelector: buildSelector(container as HTMLElement),
        containerHTML: (container as HTMLElement).outerHTML.slice(0, 200),
        label: labelResult.value.replace(/[*\s]+$/, '').replace(/\s*必填$/, '').trim(),
        labelSource: labelResult.source,
        labelConfidence: labelResult.confidence,
        required,
        options: opts.map((o) => ({
          text: ariaOptionText(o),
          el: o,
        })).filter((o) => !!o.text),
      });
    }
  }
}

function ariaOptionText(el: HTMLElement): string {
  // Priority: aria-label > data-value > text content > value attribute
  const aria = el.getAttribute('aria-label');
  if (aria) return cleanText(aria);
  const dv = el.getAttribute('data-value');
  if (dv) return cleanText(dv);
  // Some libraries render the label as the only text child
  const txt = cleanText(el.textContent || '');
  if (txt && txt.length < 200) return txt;
  return el.getAttribute('value') || '';
}

interface GroupLabelResult {
  value: string;
  source: DetectedFieldProvenance['labelSource'];
  confidence: DetectedFieldProvenance['labelConfidence'];
}

function detectGroupLabel(container: HTMLElement): GroupLabelResult {
  // Build a candidate list: the container itself + ancestors up to body that
  // commonly hold question labels (listitem, fieldset, .form-item, etc.).
  // This handles both "container = listitem (contains heading)" and the
  // pure-radiogroup case where the heading is a sibling of the radiogroup.
  const candidates: Element[] = [container];
  let parent = container.parentElement;
  let depth = 0;
  while (parent && parent !== document.body && depth < 4) {
    const role = parent.getAttribute('role');
    const tag = parent.tagName.toLowerCase();
    if (
      role === 'listitem' || role === 'group' || tag === 'fieldset' ||
      /(form-item|question|field-group|field-wrapper|form-row)/i.test(parent.className || '')
    ) {
      candidates.push(parent);
    }
    parent = parent.parentElement;
    depth++;
  }

  for (const c of candidates) {
    // 1. aria-label on this candidate
    const aria = c.getAttribute('aria-label');
    if (aria) {
      const value = cleanText(aria);
      if (value) return { value, source: 'aria-label', confidence: 'exact' };
    }
    // 2. aria-labelledby
    const labelledBy = c.getAttribute('aria-labelledby');
    if (labelledBy) {
      const refs = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '');
      const value = cleanText(refs.join(' '));
      if (value) return { value, source: 'aria-labelledby', confidence: 'exact' };
    }
    // 3. heading or legend inside this candidate (but NOT inside one of the
    // option elements themselves — that would just grab the option's text)
    const headings = c.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"], legend');
    for (const h of Array.from(headings)) {
      // Skip if this heading is inside a role=radio/checkbox/option (i.e. it
      // describes an option, not the question itself).
      if (h.closest('[role="radio"], [role="checkbox"], [role="option"]')) continue;
      if (h.textContent) {
        const value = cleanText(h.textContent);
        if (value) return { value, source: 'parent-heading', confidence: 'inferred' };
      }
    }
  }
  return { value: '', source: 'inferred', confidence: 'fallback' };
}

function collectFillableElements(root: Document | ShadowRoot): HTMLElement[] {
  const out: HTMLElement[] = [];
  const directQuery = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), textarea, select';

  out.push(...Array.from(root.querySelectorAll<HTMLElement>(directQuery)));

  // File inputs explicitly: Qualtrics, Typeform, and most modern forms hide
  // the native <input type=file> behind a styled drop-zone div, so it gets
  // dropped by the visibility filter below. We still need to know they exist
  // — to tell the user "this field needs a manual upload" — so we collect
  // them separately and bypass the visibility check.
  out.push(...Array.from(root.querySelectorAll<HTMLElement>('input[type="file"]')));

  // Open shadow roots: walk recursively
  root.querySelectorAll('*').forEach((el) => {
    const sr = (el as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (sr) out.push(...collectFillableElements(sr));
  });

  // Same-origin iframes
  if (root instanceof Document) {
    root.querySelectorAll('iframe').forEach((iframe) => {
      try {
        const iDoc = (iframe as HTMLIFrameElement).contentDocument;
        if (iDoc) out.push(...collectFillableElements(iDoc));
      } catch {
        // cross-origin — silently ignore; user will be warned in UI
      }
    });
  }
  // Dedupe (file inputs may have been picked up by both queries) and filter
  // to user-facing elements. File inputs bypass the visibility filter — they
  // are routinely hidden by CSS while the styled drop zone takes over.
  const seen = new Set<HTMLElement>();
  return out.filter((el) => {
    if (seen.has(el)) return false;
    seen.add(el);
    const isFileInput = el instanceof HTMLInputElement && el.type === 'file';
    if (isFileInput) {
      // Still respect "disabled" + aria-hidden + admin containers — but skip
      // the layout/size check.
      const inp = el as HTMLInputElement;
      if (inp.disabled) return false;
      if (el.closest('[aria-hidden="true"]')) return false;
      if (el.closest('[role="toolbar"], [role="menubar"], [role="menu"]')) return false;
      return true;
    }
    return isLikelyRespondentField(el);
  });
}

/**
 * Decide whether an element is plausibly a field the user is meant to fill in
 * on a published form (vs. a hidden field, admin UI control, modal-dialog
 * input, etc.).
 *
 * This is the single most important quality lever in the scanner: too lax
 * and we report 50+ phantom fields from a form's admin UI; too strict and
 * we miss real fields that happen to be off-screen at scan time. The checks
 * below are deliberately conservative — each one targets a specific category
 * of false positive observed in the wild.
 */
function isLikelyRespondentField(el: HTMLElement): boolean {
  // 1. Disabled / readonly → user can't interact with it anyway.
  const inp = el as HTMLInputElement;
  if (inp.disabled || inp.readOnly) return false;

  // 2. Inside an aria-hidden subtree → screen readers ignore it; we should too.
  if (el.closest('[aria-hidden="true"]')) return false;

  // 3. Inside admin/secondary UI containers (toolbar, menu, status, banner).
  //    Dialogs that aren't currently open also count — Google Forms keeps
  //    inactive editor modals in the DOM with hidden ancestors.
  if (el.closest('[role="toolbar"], [role="menubar"], [role="menu"], [role="status"], [role="banner"]')) return false;

  // 4. Size — must actually be laid out on screen.
  //    Some libraries position offscreen inputs at left:-9999px for sr-only
  //    purposes; we treat any near-zero-size element as not user-facing.
  //
  //    Two-fold change from the previous version (UX iteration 2026-05-23):
  //    (a) `docHasLayout` gate preserved so happy-dom/jsdom tests still pass —
  //        without layout, every element measures 0×0 and the test would
  //        reject everything.
  //    (b) Threshold loosened from "width<4 OR height<4" to "width<1 AND height<1".
  //        The previous threshold rejected legit sr-only / hidden-but-not-display:none
  //        inputs that Qualtrics, Tally, and modern form libraries use for
  //        file uploads, A/B tests, and conditionally-rendered fields. Now
  //        we only reject TRULY zero-area elements; the computed-style check
  //        below (display:none / visibility:hidden / opacity:0) still catches
  //        intentionally-hidden admin UI.
  const bodyRect = el.ownerDocument?.body?.getBoundingClientRect?.();
  const docHasLayout = !!bodyRect && bodyRect.width > 0;
  if (docHasLayout) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 && rect.height < 1) return false;
  }

  // 5. Computed style — works the same in tests and real browsers (both
  //    happy-dom and jsdom respect CSS rules). Catches display:none and
  //    visibility:hidden regardless of layout.
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  }
  return true;
}

/**
 * Visibility gate for NATIVE <input type=radio|checkbox> — deliberately LAXER
 * than isLikelyRespondentField. A custom-styled radio/checkbox almost always
 * HIDES the native <input> (opacity:0 / 1px / off-screen) and renders a styled
 * sibling in its place, so rejecting on opacity or size would miss the whole
 * control. We only reject when the input is in a genuinely non-rendered subtree
 * (display:none / visibility:hidden / aria-hidden / admin chrome) — which is
 * also how hidden template rows hide, so those still get skipped.
 *
 * UX iteration 2026-06-06: HiCool 是否成立公司 used opacity:0 native radios that
 * the strict gate dropped entirely.
 */
function isRenderedChoiceInput(inp: HTMLInputElement): boolean {
  if (inp.disabled) return false;
  if (inp.closest('[aria-hidden="true"]')) return false;
  if (inp.closest('[role="toolbar"], [role="menubar"], [role="menu"], [role="status"], [role="banner"]')) return false;
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    let node: HTMLElement | null = inp;
    let hops = 0;
    while (node && node !== document.body && hops < 12) {
      const st = window.getComputedStyle(node);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      node = node.parentElement;
      hops++;
    }
  }
  return true;
}

/**
 * Compute the visibility state of an element for provenance tracking.
 * Distinct from `isLikelyRespondentField` (which returns boolean accept/reject):
 * this returns a tristate so the UI can show "this field was included even
 * though it has zero layout — could be a hidden drop-zone input."
 *
 * Caller is expected to have already passed `isLikelyRespondentField` — this
 * function returns `'hidden-skipped'` only as a defensive fallback.
 */
export function getVisibilityState(el: HTMLElement): 'visible' | 'layout-zero-but-include' | 'hidden-skipped' {
  // First: are we in a real browser with layout? If not, we can't tell — assume visible.
  const bodyRect = el.ownerDocument?.body?.getBoundingClientRect?.();
  const docHasLayout = !!bodyRect && bodyRect.width > 0;
  if (!docHasLayout) return 'visible';

  // Check computed style — if CSS says hidden, that's definitive.
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return 'hidden-skipped';
    }
  }

  // Else check size.
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return 'layout-zero-but-include';
  return 'visible';
}

/** OTP / one-time verification-code fields — the AI must never invent these. */
const OTP_LABEL_RE = /验证码|verification\s*code|captcha|短信码|动态码|one[\s-]?time\s*code|\botp\b/i;
/** Personal / contact identity fields — the user's own data, not AI-generated. */
const PERSONAL_LABEL_RE = /姓名|联系人|联系方式|手机号?|电话|邮箱|电子邮件|微信|wechat|qq\s*号|身份证|证件号|护照|\be-?mail\b/i;

/**
 * Classify a field as something the AI must NOT fill: a one-time code (OTP), or
 * the user's own personal/contact identity. Drives constraints.noAiFill so the
 * generator skips it and the sidepanel asks the user to fill it themselves.
 * Chinese labels have no word boundaries, so we match on substring (not \b) for
 * the CJK tokens. UX iteration 2026-06-06 (HiCool 验证码 + 联系人 block dogfood).
 */
export function detectSensitiveKind(label: string, placeholder: string): 'otp' | 'personal' | undefined {
  const hay = `${label} ${placeholder}`;
  if (OTP_LABEL_RE.test(hay)) return 'otp';
  if (PERSONAL_LABEL_RE.test(hay)) return 'personal';
  return undefined;
}

/**
 * G4 (2026-06-06): some custom uploaders pair their <input type=file> with a
 * read-only TEXT box that just displays the chosen filename ("上传文件"). That
 * box looks like a fillable text field but isn't — skip it when an upload-ish
 * placeholder/value sits next to a real file input in the same neighbourhood.
 */
function isUploaderDisplayBox(el: HTMLElement): boolean {
  const ph = (el as HTMLInputElement).placeholder || '';
  const val = (el as HTMLInputElement).value || '';
  if (!/上传文件|点击上传|选择文件|未选择文件|尚未上传|choose\s*file|no\s*file/i.test(`${ph} ${val}`)) return false;
  let p: HTMLElement | null = el.parentElement;
  let depth = 0;
  while (p && depth < 4) {
    if (p.querySelector('input[type="file"]')) return true;
    p = p.parentElement;
    depth++;
  }
  return false;
}

function analyzeElement(el: HTMLElement, fieldId: string): DetectedField | null {
  const tagName = el.tagName.toLowerCase();
  const type = detectFieldType(el);
  if (type === 'unknown' && tagName !== 'textarea' && tagName !== 'select') return null;

  // G4: skip the read-only "上传文件" display box that custom uploaders place
  // beside their <input type=file>. The file input is detected separately.
  if ((type === 'text' || type === 'unknown') && isUploaderDisplayBox(el)) return null;

  // Detect the immediate label (e.g. "1. 路演人") and ALSO the parent
  // question's title (e.g. "出席项目队员名字 及 职业/职称") if any. The two
  // get merged: a sub-input under a multi-input question gets a compound
  // label, while a top-level input keeps just its own label.
  const inner = detectLabelWithSource(el);
  const parentLabel = detectParentQuestionLabel(el);
  let label = inner.value;
  let labelSource: DetectedFieldProvenance['labelSource'] = inner.source;
  let labelConfidence: DetectedFieldProvenance['labelConfidence'] = inner.confidence;
  if (parentLabel && inner.value && !inner.value.includes(parentLabel) && !parentLabel.includes(inner.value)) {
    label = `${parentLabel} - ${inner.value}`;
    // Compound label — keep the inner source but mark as inferred since we synthesized.
    labelConfidence = 'inferred';
  } else if (!inner.value && parentLabel) {
    // No direct label (common on file-upload drop zones where the styled UI
    // has the label but the hidden input does not). Fall back to parent.
    label = parentLabel;
    labelSource = 'parent-heading';
    labelConfidence = 'inferred';
  }
  if (!label) return null; // skip unlabeled — would just hallucinate

  if (isAdminLabel(label)) return null;

  const constraintsResult = detectConstraintsWithSource(el, label);

  // File inputs: capture the `accept` attribute so we can tell the user what
  // file types are expected ("PNG, JPG" / "PDF, PPT" / etc.) without making
  // them open the page to find out.
  if (type === 'file') {
    const accept = (el as HTMLInputElement).accept || '';
    if (accept) constraintsResult.constraints.placeholder = `允许文件类型: ${accept}`;
  }

  // G5: a verification code or the user's own personal/contact info → the AI
  // must not invent it. Flag so the generator skips it (like file fields) and
  // the sidepanel shows a "fill this yourself" note. (Not applied to file
  // fields — those have their own manual path.)
  if (type !== 'file') {
    const sensitive = detectSensitiveKind(label, (el as HTMLInputElement).placeholder || '');
    if (sensitive) {
      constraintsResult.constraints.noAiFill = true;
      constraintsResult.constraints.sensitiveKind = sensitive;
    }
  }

  // Determine source: drop-zone detection (T15) → if this is a file input AND
  // we can find a styled drop zone wrapping it, mark provenance.source so the
  // UI can show "drop-zone" not "html-input". Helps users debug "is this
  // really the upload field I see in the page?"
  const source: DetectedFieldProvenance['source'] =
    type === 'file' && hasDropZoneContainer(el)
      ? 'drop-zone'
      : el.getRootNode() instanceof ShadowRoot
        ? 'shadow-dom'
        : 'html-input';

  const provenance: DetectedFieldProvenance = {
    source,
    selector: buildSelector(el),
    visibilityState: getVisibilityState(el),
    labelSource,
    labelConfidence,
    maxLength: constraintsResult.maxLengthSource ? { value: constraintsResult.maxLengthSource.value, matchedPattern: constraintsResult.maxLengthSource.matchedPattern } : undefined,
    helperText: constraintsResult.helperSource ? { value: constraintsResult.helperSource.value, source: constraintsResult.helperSource.source } : undefined,
  };

  // Clean the DISPLAY label into a 主标题: drop the placeholder (副标题) the
  // heuristic merged in via " - ", any "请输入…" prompt prefix, and the trailing
  // "（最少200字…）" length parenthetical (already parsed into constraints above).
  // Constraint + sensitive detection already ran on the RAW label, so nothing is
  // lost. The 副标题 lives on in constraints.placeholder (rendered as the input's
  // gray placeholder in the sidepanel, matching the page).
  const displayLabel = cleanDisplayLabel(label, constraintsResult.constraints.placeholder);

  return {
    fieldId,
    domSelector: buildSelector(el),
    label: displayLabel,
    type,
    constraints: constraintsResult.constraints,
    rawElementInfo: {
      tagName,
      id: el.id || undefined,
      name: (el as HTMLInputElement).name || undefined,
      classes: Array.from(el.classList),
    },
    provenance,
  };
}

/**
 * Look up the DOM for a styled drop-zone ancestor of a file input. T15:
 * Qualtrics, Tally, and most modern form libraries wrap <input type="file">
 * with a styled div that has text like "拖拽" / "drop" / "上传" / "upload".
 * If we find one, we tag the field's provenance as `drop-zone` so the UI can
 * surface that "the visible upload widget is this drop zone, not the hidden
 * file input." Keeps the user oriented when their click goes to one place
 * but our selector points elsewhere.
 */
function hasDropZoneContainer(input: HTMLElement): boolean {
  let parent = input.parentElement;
  let depth = 0;
  while (parent && depth < 5) {
    // Heuristic 1: text content of immediate wrapper hints at drag-and-drop.
    // Cheap: just look at first 200 chars.
    const text = (parent.textContent || '').slice(0, 200).toLowerCase();
    if (/拖拽|拖动|拖放|drag|drop|上传|upload|选择文件|choose file|browse/.test(text)) {
      return true;
    }
    // Heuristic 2: known class patterns.
    const cls = (parent.className || '').toString().toLowerCase();
    if (/(dropzone|drop-zone|upload-area|upload-zone|file-drop|filedrop)/.test(cls)) {
      return true;
    }
    parent = parent.parentElement;
    depth++;
  }
  return false;
}

/**
 * Collect the text inside `container` that appears BEFORE its first form
 * control (input/textarea/select). For flat row-style questions whose label is
 * a bare TEXT NODE (no <label>/heading element), this leading text IS the
 * question label.
 *
 * UX iteration 2026-05-30: added to support simple/hand-written forms (esp.
 * Chinese gov / incubator / university registration) shaped like:
 *   <div class="form-row">*项目简介(不超过 200 字)<br><textarea></textarea></div>
 * where the previous element-based detection found nothing.
 */
function leadingLabelText(container: HTMLElement): string {
  let out = '';
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      out += node.textContent || '';
    } else if (node.nodeType === 1 /* ELEMENT_NODE */) {
      const tag = (node as Element).tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') break; // reached the control
      if (tag === 'br' || tag === 'script' || tag === 'style') continue;
      out += (node as Element).textContent || '';
    }
    if (out.length > 220) break;
  }
  return out;
}

/** Strip the leading required-marker (*) and trailing colon from a row label. */
function cleanRowLabel(raw: string): string {
  let t = cleanText(raw);
  t = t.replace(/^[*＊✱\s]+/, '');
  t = t.replace(/[：:]\s*$/, '');
  return t.trim();
}

/**
 * Climb to the nearest container that scopes ONE question — a form-row /
 * fieldset / [role=group]. Used to group native radio/checkbox inputs and to
 * find their shared label. UX iteration 2026-05-30.
 */
function nearestChoiceContainer(el: HTMLElement): HTMLElement {
  // The choice type lets us recognise the field CELL in two-column layouts that
  // don't use a known wrapper class (e.g. HiCool t-col-r): it's the smallest
  // ancestor that holds the WHOLE choice set (≥2 same-type inputs).
  const choiceType = (el as HTMLInputElement).type;
  let p = el.parentElement;
  let depth = 0;
  while (p && p !== document.body && depth < 5) {
    const cls = (p.className || '').toString();
    if (/form-row|form-line|field-row|form-item|form-group/i.test(cls) || p.tagName.toLowerCase() === 'fieldset' || p.getAttribute('role') === 'group') {
      return p;
    }
    if (choiceType && p.querySelectorAll(`input[type="${choiceType}"]`).length >= 2) {
      return p;
    }
    p = p.parentElement;
    depth++;
  }
  return el.parentElement || el;
}

/**
 * Best-effort accessible name for a NATIVE <input type=radio|checkbox> option:
 * label[for], wrapping <label>, then the adjacent text after the input
 * (the common "<input>是" inline pattern). UX iteration 2026-05-30.
 */
function nativeOptionLabel(inp: HTMLInputElement): string {
  if (inp.id) {
    const l = document.querySelector(`label[for="${cssEscape(inp.id)}"]`);
    if (l?.textContent) { const t = cleanText(l.textContent); if (t) return t; }
  }
  const wrap = inp.closest('label');
  if (wrap?.textContent) { const t = cleanText(wrap.textContent); if (t) return t; }
  let n: ChildNode | null = inp.nextSibling;
  while (n) {
    if (n.nodeType === 3 /* TEXT_NODE */) {
      const t = cleanText(n.textContent || ''); if (t) return t;
    } else if (n.nodeType === 1 /* ELEMENT_NODE */) {
      const tag = (n as Element).tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') break;
      if (tag !== 'br') { const t = cleanText((n as Element).textContent || ''); if (t) return t; }
    }
    n = n.nextSibling;
  }
  return inp.value || '';
}

/**
 * Group NATIVE <input type=radio/checkbox> into choice fields.
 * UX iteration 2026-05-30 — complements collectChoiceGroups (which only handles
 * ARIA role=radio styled divs). Grouping key is the nearest row/fieldset
 * container (each question lives in one <div class="form-row"> / <fieldset>),
 * which is more robust than the `name` attribute (some forms reuse names).
 */
function collectNativeChoiceGroups(root: Document | ShadowRoot): ChoiceGroup[] {
  const groups: ChoiceGroup[] = [];
  const seen = new Set<Element>();
  build('radio', Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]')));
  build('checkbox', Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')));
  return groups;

  function build(type: 'radio' | 'checkbox', inputs: HTMLInputElement[]) {
    const byContainer = new Map<Element, HTMLInputElement[]>();
    for (const inp of inputs) {
      // G3 (2026-06-06): native radio/checkbox are commonly opacity:0 when
      // custom-styled — use the relaxed gate, not isLikelyRespondentField.
      if (!isRenderedChoiceInput(inp)) continue;
      const container = nearestChoiceContainer(inp);
      const arr = byContainer.get(container) ?? [];
      arr.push(inp);
      byContainer.set(container, arr);
    }
    for (const [container, els] of byContainer.entries()) {
      if (seen.has(container)) continue;
      seen.add(container);
      // In two-column layouts leadingLabelText(container) returns the OPTION
      // text (有公司 无公司), not the question — so prefer the sibling label cell
      // (是否成立公司), falling back to leading text for flat hand-written rows.
      const raw = leadingLabelText(container as HTMLElement);
      const labelCell = findSiblingLabelCell(container as HTMLElement);
      const label = labelCell ? cleanRowLabel(labelCell.textContent || '') : cleanRowLabel(raw);
      if (!label || label.length < 2 || isAdminLabel(label)) continue;
      const labelCellText = cleanText(labelCell?.textContent || '');
      const required =
        /^[*＊✱]/.test(labelCellText) || /必填|必须/.test(labelCellText) ||
        /^[*＊✱]/.test(cleanText(raw)) || /必填|必须/.test(raw);
      const options = els
        .map((e) => ({ text: nativeOptionLabel(e), el: e as HTMLElement }))
        .filter((o) => !!o.text);
      if (!options.length) continue;
      groups.push({
        type,
        container: container as HTMLElement,
        containerSelector: buildSelector(container as HTMLElement),
        containerHTML: (container as HTMLElement).outerHTML.slice(0, 200),
        label,
        labelSource: 'parent-heading',
        labelConfidence: 'inferred',
        required,
        options,
      });
    }
  }
}

/** Text on a button/link that triggers a custom (JS) file upload. */
const UPLOAD_TRIGGER_RE = /^(?:上传(?:文件)?|点击上传|选择文件|添加文件|browse|upload|choose\s*file)$/i;
/** Status text shown by a custom uploader when nothing is attached yet. */
const UPLOAD_STATUS_RE = /尚未上传|未上传|未选择文件|暂无文件|no\s*file|not\s*uploaded/i;

/**
 * UX iteration 2026-05-30: detect CUSTOM JS upload fields that have NO
 * <input type=file> in the DOM — e.g. an <a>上传</a> + a "尚未上传任何文件"
 * status, where clicking opens the OS file dialog. These can't be auto-filled
 * (browser security + no input to inject into), but we still want them to
 * SHOW UP in the sidepanel so we can match the user's asset + offer a
 * one-click download for manual upload. Marked constraints.manualUploadOnly.
 *
 * Real-form trigger: 上海创业训练营报名表's "项目商业计划书" / "其他材料"
 * blocks (<div class="list-content"><span>label</span><a>上传</a><h2>尚未上传…</h2></div>).
 */
function collectCustomUploadFields(root: Document | ShadowRoot): { container: HTMLElement; containerSelector: string; containerHTML: string; label: string; required: boolean }[] {
  const out: { container: HTMLElement; containerSelector: string; containerHTML: string; label: string; required: boolean }[] = [];
  const seen = new Set<Element>();
  const triggers = Array.from(root.querySelectorAll<HTMLElement>('a, span, button, div, label'))
    .filter((el) => {
      const t = cleanText(el.textContent || '');
      return t.length <= 8 && UPLOAD_TRIGGER_RE.test(t);
    });
  for (const trig of triggers) {
    // Climb to the block holding this trigger + an upload-status hint, with NO
    // real <input type=file> inside (those go through the normal file path).
    let block: HTMLElement | null = trig.parentElement;
    let found: HTMLElement | null = null;
    for (let i = 0; i < 4 && block && block !== document.body; i++) {
      if (block.querySelector('input[type="file"]')) { found = null; break; }
      if (UPLOAD_STATUS_RE.test(block.textContent || '')) { found = block; break; }
      block = block.parentElement;
    }
    if (!found || seen.has(found)) continue;
    seen.add(found);
    // Reject over-climbed blocks: a real custom-upload block holds only a
    // label + trigger + status — NO form controls. If the block contains
    // inputs/textareas/selects we grabbed a whole form section by mistake.
    if (found.querySelector('input, textarea, select')) continue;
    // Label = block text minus the STATUS phrase (first — it contains "上传"),
    // then minus the trigger word.
    const raw = cleanText(found.textContent || '')
      .replace(/尚未上传任何文件|尚未上传|未上传文件|未上传|未选择文件|暂无文件|no\s*file\w*|not\s*uploaded/gi, '')
      .replace(/上传文件|点击上传|选择文件|添加文件|上传|choose\s*file|browse|upload/gi, '');
    const label = cleanRowLabel(raw);
    if (!label || label.length < 2 || isAdminLabel(label)) continue;
    const required = /^[*＊✱]/.test(cleanText(raw)) || /必填|必须|必传/.test(raw);
    out.push({ container: found, containerSelector: buildSelector(found), containerHTML: found.outerHTML.slice(0, 200), label, required });
  }
  return out;
}

// Button text that is an ACTION, never a choice option — used to reject
// toolbars / footer button rows so they aren't mistaken for a choice group.
const ACTION_BTN_RE = /^(submit|save|save changes|cancel|close|next|previous|prev|back|continue|confirm|ok|reset|delete|remove|edit|add|apply|done|提交|保存|取消|关闭|下一步|上一步|确定|确认|继续|删除|添加|编辑|重置|完成|应用)$/i;

/**
 * Collect BUTTON-GROUP choice fields (UX iteration 2026-05-31). Some forms
 * render single/multi-select as a row of styled `<button type="button">`
 * (or `[role=button]`) instead of native radios or ARIA `role=radio` — e.g.
 * Epic Connector's "Main Track: [Agent] [Skill] [Application]" pickers, where
 * the only "selected" signal is a CSS class. These fall through every other
 * pass (no input, no role=radio), so detect a container holding >= 2
 * option-like buttons that has a resolvable label.
 */
function collectButtonChoiceGroups(root: Document | ShadowRoot): ChoiceGroup[] {
  const groups: ChoiceGroup[] = [];
  const seen = new Set<Element>();
  const containers = new Set<HTMLElement>();
  for (const b of Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"]'))) {
    if (b.parentElement) containers.add(b.parentElement);
  }
  for (const container of containers) {
    if (seen.has(container)) continue;
    const btns = Array.from(container.children).filter(
      (c): c is HTMLElement =>
        c.tagName.toLowerCase() === 'button' || c.getAttribute('role') === 'button',
    );
    // A choice group is 2..12 buttons. Fewer = a lone action button; more =
    // likely a toolbar / keypad, not a question.
    if (btns.length < 2 || btns.length > 12) continue;
    // Navigation / tabs / toolbars are button rows but NOT form choice fields.
    // Excluding by ancestor role removes the biggest false-positive source
    // (e.g. an Overview/Features/Guides nav bar getting picked up as a field).
    if (container.closest('nav, [role="navigation"], [role="tablist"], [role="menu"], [role="menubar"], [role="toolbar"], header, footer, [role="banner"]')) continue;
    const options = btns
      .map((b) => ({ text: cleanText(b.textContent || ''), el: b }))
      .filter((o) => o.text.length >= 1 && o.text.length <= 30 && !ACTION_BTN_RE.test(o.text));
    // Require EVERY button to be option-like — if any is an action button
    // (Save / Cancel / 提交 …) this is a button row, not a choice group.
    if (options.length < 2 || options.length !== btns.length) continue;
    if (!options.some((o) => isLikelyRespondentField(o.el))) continue;
    // Label: the question usually sits in the container's preceding sibling
    // (a <label>), else fall back to the question-wrapper climb.
    const prev = container.previousElementSibling;
    let rawLabel = '';
    if (prev) {
      const ptag = prev.tagName.toLowerCase();
      const pcls = (prev.className || '').toString();
      // Accept the preceding sibling as the question ONLY if it's label-like.
      // A form question is a <label>/heading; a nav bar's preceding element is
      // a random countdown/title that must not be borrowed as a bogus label.
      const labelish =
        ptag === 'label' || ptag === 'legend' || /^h[1-6]$/.test(ptag) ||
        prev.getAttribute('role') === 'heading' ||
        /(^|[\s-])(label|question|field-title|form-label|field-label)/i.test(pcls);
      if (labelish) rawLabel = cleanText(prev.textContent || '');
    }
    const label = (rawLabel || detectParentQuestionLabel(container)).replace(/[*＊✱\s]+$/, '').trim();
    if (!label || label.length < 2 || label.length > 200 || isAdminLabel(label)) continue;
    seen.add(container);
    // Multi-select hints. Beyond "multi"/"多选", catch count-bounded phrasings
    // like "select up to 2" / "choose up to 2" / "最多选 2 个" / "选 2 项" —
    // the Epic Connector "Track (select up to 2)" picker is multi, not single.
    // Note: "single select" deliberately does NOT match any branch below.
    const multi = /(multi[\s-]?select|select all|select any|select\s+up\s+to|choose\s+up\s+to|up\s+to\s+\d|至多|最多.{0,6}(个|项)|多选|复选|可多选|可多个|选\s*\d+\s*(个|项))/i.test(rawLabel);
    const required = /[*＊✱]/.test(rawLabel) || /必填|必须|required/i.test(rawLabel);
    groups.push({
      type: multi ? 'checkbox' : 'radio',
      container,
      containerSelector: buildSelector(container),
      containerHTML: container.outerHTML.slice(0, 200),
      label,
      labelSource: 'parent-heading',
      labelConfidence: 'inferred',
      required,
      options,
    });
  }
  return groups;
}

/**
 * Walk up from an input and find the nearest "question container" heading.
 * Useful when several sub-inputs (e.g. team-member name slots numbered
 * 1/2/3) share a single question title displayed above them — the immediate
 * <label> next to each input only carries the sub-label, not the full
 * question. Also rescues unlabeled inputs (file-upload drop zones) by
 * inheriting the parent's heading text.
 */
/**
 * Two-column "label cell | field cell" layouts — extremely common in Chinese
 * gov / 创赛 / 孵化器 / 高校 forms and Element-UI-style grid forms. The label
 * sits in a SIBLING cell, not as leading text inside the field's own container,
 * and the row/cell classes (e.g. `t-row` / `t-col-l` / `t-col-r`) don't match
 * our question-wrapper regex — so detectParentQuestionLabel finds nothing, every
 * field degrades to its placeholder, and placeholder-less controls (<select>,
 * radio groups, file inputs) get DROPPED for lack of a label.
 *
 * Returns the nearest preceding sibling cell (climbing a few levels) that holds
 * short label text but NO form control — generalises beyond any class naming.
 * UX iteration 2026-06-06 (HiCool moore.hicool.com dogfood).
 */
/** Clickable trigger/action words that look like labels but aren't (an upload
 *  row's "选择" / "上传" sits between the real label cell and the file input). */
const TRIGGER_WORD_RE = /^(?:选择|选择文件|上传|上传文件|点击上传|添加|添加文件|浏览|删除|browse|upload|choose(?:\s*file)?|select(?:\s*file)?|attach|remove)$/i;

function findSiblingLabelCell(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el;
  let depth = 0;
  // A trailing colon ("商业计划书：") is a strong label signal, so we prefer the
  // nearest colon-terminated cell over a nearer non-colon one — that's what lets
  // us skip the "选择" upload trigger and reach the real label cell behind it.
  let fallback: HTMLElement | null = null;
  while (cur && cur !== document.body && depth < 4) {
    let sib = cur.previousElementSibling;
    while (sib) {
      const hasControl = sib.querySelector(
        'input, textarea, select, button, [role="button"], [role="radio"], [role="checkbox"], [role="listbox"]',
      );
      if (!hasControl) {
        const rawTxt = cleanText(sib.textContent || '');
        const t = cleanRowLabel(rawTxt);
        // Short, label-shaped text only (avoids grabbing a paragraph or a
        // section's intro copy); skip clickable trigger words.
        if (t && t.length >= 2 && t.length <= 40 && !isAdminLabel(t) && !TRIGGER_WORD_RE.test(t)) {
          if (/[：:]\s*$/.test(rawTxt)) return sib as HTMLElement;
          if (!fallback) fallback = sib as HTMLElement;
        }
      }
      sib = sib.previousElementSibling;
    }
    cur = cur.parentElement;
    depth++;
  }
  return fallback;
}

/** Cleaned label text from the sibling label cell, or '' if none. */
function detectSiblingCellLabel(el: HTMLElement): string {
  const cell = findSiblingLabelCell(el);
  return cell ? cleanRowLabel(cell.textContent || '') : '';
}

function detectParentQuestionLabel(el: HTMLElement): string {
  let parent = el.parentElement;
  let depth = 0;
  // Whether we've already passed the input's NEAREST question wrapper. The
  // bare-text-node fallback below is only trustworthy on that nearest wrapper;
  // see the comment at its guard.
  let nearestWrapperSeen = false;
  while (parent && parent !== document.body && depth < 6) {
    // Match common question-wrapper classes from Qualtrics, Google Forms,
    // SurveyMonkey, and generic form libraries. UX iteration 2026-05-30 added
    // form-row / form-line / field-row for flat hand-written forms.
    const cls = (parent.className || '').toString();
    const role = parent.getAttribute('role');
    const isQuestionWrapper =
      /QuestionBody|QuestionText|question-wrapper|question-container|form-question|survey-question|form-group|form-item|form-row|form-line|field-row/i.test(cls) ||
      role === 'listitem' ||
      parent.tagName.toLowerCase() === 'fieldset';
    if (isQuestionWrapper) {
      // 1. Look for a heading-ish element inside this wrapper but OUTSIDE any
      // nested input/label that belongs to a specific sub-input.
      const candidates = parent.querySelectorAll(
        '.QuestionText, [role="heading"], h1, h2, h3, h4, h5, h6, legend, .question-title, .form-label-text',
      );
      for (const c of Array.from(candidates)) {
        if (c.contains(el)) continue;
        // A question title sits ABOVE its input(s). Require the heading to
        // PRECEDE `el` in document order; otherwise a group wrapper holding
        // many rows (e.g. `form-row-group`, which matches the regex via the
        // "form-row" substring) would hand this input a LATER section's
        // heading — the bug where a sibling upload widget's "尚未上传任何文件"
        // <h2> leaked onto 项目名称/申请人姓名 as a label prefix.
        if (!(c.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        const t = cleanText(c.textContent || '');
        if (t && t.length > 1 && t.length < 200 && !isAdminLabel(t)) return t;
      }
      // 2. UX iteration 2026-05-30: bare-text-node label. When the wrapper has
      // no heading element, take its leading text (before the first control),
      // stripping the * marker / trailing colon. Rescues textareas like
      // "*项目简介(不超过 200 字)" — and the 200-char limit gets picked up by
      // the MAX_LENGTH_PATTERNS scan downstream since it's now in the label.
      //
      // UX iteration 2026-05-31: ONLY trust this on the NEAREST wrapper. If an
      // input's own row carries no real label (e.g. its leading text is just
      // the "*" required marker, common for placeholder-labelled text inputs),
      // climbing further up and grabbing an ANCESTOR's leading text pollutes
      // the label with unrelated content — e.g. a sibling custom-upload
      // widget's "尚未上传任何文件" status leaking in as
      // "尚未上传任何文件 - 申请人姓名". In that case the input's own label
      // (placeholder) is the correct answer, so we return '' (no parent label).
      if (!nearestWrapperSeen) {
        const rowLabel = cleanRowLabel(leadingLabelText(parent));
        if (rowLabel && rowLabel.length > 1 && rowLabel.length < 200 && !isAdminLabel(rowLabel)) {
          return rowLabel;
        }
      }
      nearestWrapperSeen = true;
    }
    parent = parent.parentElement;
    depth++;
  }
  // Fallback: two-column "label cell | field cell" layouts where the label is a
  // sibling cell, not leading text in a recognised wrapper (HiCool t-col-l/-r,
  // Element-UI grid forms, etc.). UX iteration 2026-06-06.
  return detectSiblingCellLabel(el);
}

function isAdminLabel(label: string): boolean {
  return ADMIN_LABEL_PATTERNS.some((p) => p.test(label));
}

function detectFieldType(el: HTMLElement): FieldType {
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return 'select';
  if (tag === 'input') {
    const t = (el as HTMLInputElement).type.toLowerCase();
    if (['text', 'email', 'url', 'tel', 'number', 'date', 'checkbox', 'radio', 'file'].includes(t)) {
      return t as FieldType;
    }
    return 'text';
  }
  return 'unknown';
}

/**
 * Multi-source label detection in priority order:
 * 1. <label for="X"> → input id="X"
 * 2. el.closest('label')
 * 3. aria-label
 * 4. aria-labelledby
 * 5. preceding sibling text node / heuristic neighbor
 * 6. placeholder
 *
 * UX iteration 2026-05-23 (T13): returns the label PLUS source metadata so
 * the FieldExplainer UI can show "this field's label came from aria-label"
 * (exact) vs "we inferred it from a nearby span" (fallback).
 */
interface LabelDetectionResult {
  value: string;
  source: DetectedFieldProvenance['labelSource'];
  confidence: DetectedFieldProvenance['labelConfidence'];
}

function detectLabelWithSource(el: HTMLElement): LabelDetectionResult {
  // 1. <label for=…> — direct HTML association, highest confidence.
  const id = el.id;
  if (id) {
    const lab = document.querySelector(`label[for="${cssEscape(id)}"]`);
    if (lab?.textContent) {
      const value = cleanText(lab.textContent);
      if (value) return { value, source: 'label-tag', confidence: 'exact' };
    }
  }
  // 2. closest label
  const closest = el.closest('label');
  if (closest?.textContent) {
    const value = cleanText(closest.textContent);
    if (value) return { value, source: 'label-tag', confidence: 'exact' };
  }
  // 3. aria-label
  const aria = el.getAttribute('aria-label');
  if (aria) {
    const value = cleanText(aria);
    if (value) return { value, source: 'aria-label', confidence: 'exact' };
  }
  // 4. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const refs = labelledBy.split(/\s+/).map((rid) => document.getElementById(rid)?.textContent || '');
    const value = cleanText(refs.join(' '));
    if (value) return { value, source: 'aria-labelledby', confidence: 'exact' };
  }
  // 5. heuristic: previous sibling. Lower confidence.
  const prev = el.previousElementSibling;
  if (prev && /label|span|div|h\d/.test(prev.tagName.toLowerCase())) {
    const value = cleanText(prev.textContent || '');
    if (value && value.length < 200) return { value, source: 'sibling-text', confidence: 'inferred' };
  }
  // 6. placeholder as last resort. Lowest-quality label since placeholder text
  // is usually a hint, not a name.
  const ph = (el as HTMLInputElement).placeholder;
  if (ph) return { value: ph, source: 'placeholder', confidence: 'fallback' };
  return { value: '', source: 'inferred', confidence: 'fallback' };
}

/**
 * UX iteration 2026-05-23 (T13): wraps detectConstraints to also return which
 * MAX_LENGTH pattern matched and which helper-text source produced the hint.
 * This metadata flows into DetectedFieldProvenance so the FieldExplainer UI
 * can answer "where did the 200-char limit come from?" — invaluable for
 * debugging mis-detected constraints.
 */
interface ConstraintDetectionResult {
  constraints: FieldConstraints;
  maxLengthSource?: { value: number; matchedPattern: string } | undefined;
  helperSource?: { value: string; source: NonNullable<DetectedFieldProvenance['helperText']>['source'] } | undefined;
}

function detectConstraintsWithSource(el: HTMLElement, label: string): ConstraintDetectionResult {
  const c: FieldConstraints = {};
  const input = el as HTMLInputElement & HTMLTextAreaElement;
  let maxLengthSource: ConstraintDetectionResult['maxLengthSource'] = undefined;

  if (input.maxLength && input.maxLength > 0) {
    c.maxLength = input.maxLength;
    maxLengthSource = { value: input.maxLength, matchedPattern: 'attr:maxlength' };
  }
  if (input.minLength && input.minLength > 0) c.minLength = input.minLength;
  if (input.required) c.required = true;
  if (input.pattern) c.pattern = input.pattern;
  if (input.placeholder) c.placeholder = input.placeholder;

  const helper = detectHelperTextWithSource(el);
  if (helper) {
    c.helperText = helper.value;
  }

  // Extract length hints from label / placeholder / helper that the page
  // ONLY communicates via gray text — exactly the case Claude for Chrome misses.
  const hayStack = `${label} ${input.placeholder || ''} ${helper?.value || ''}`;
  for (const pat of MAX_LENGTH_PATTERNS) {
    const m = hayStack.match(pat);
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      // Only override if either no maxLength yet, or the hint is stricter
      if (!c.maxLength || n < c.maxLength) {
        c.maxLength = n;
        // Record the regex source (.toString gives "/pattern/flags") — useful
        // for debugging in FieldExplainer ("matched pattern /控制在.../").
        maxLengthSource = { value: n, matchedPattern: pat.toString().slice(1, 60) + '…' };
      }
      break;
    }
  }
  // Min-length FLOOR from gray text the page only states in words — "最少 200 字"
  // / "至少 X 字" / "at least N words". A hard generation constraint (the form
  // rejects shorter answers) the DOM has no attribute for. attr minLength wins.
  if (!c.minLength) {
    const minHint = extractMinLength(hayStack);
    if (minHint) c.minLength = minHint;
  }
  // Required from label asterisk / "必填" markers
  if (!c.required) {
    for (const pat of REQUIRED_PATTERNS) {
      if (pat.test(label)) {
        c.required = true;
        break;
      }
    }
  }
  // <select> options
  if (el.tagName.toLowerCase() === 'select') {
    c.options = Array.from((el as HTMLSelectElement).options)
      .map((o) => o.text.trim())
      .filter(Boolean);
  }
  return { constraints: c, maxLengthSource, helperSource: helper };
}

/**
 * Helper text detection with provenance tracking. Returns where the hint
 * came from — aria-describedby (definitive), sibling .help class (good),
 * <small> tag (T18 addition for shadcn-style forms), or .text-muted
 * (Tailwind / shadcn ubiquitous pattern).
 */
function detectHelperTextWithSource(el: HTMLElement): NonNullable<ConstraintDetectionResult['helperSource']> | undefined {
  // aria-describedby — the most reliable source
  const describedBy = el.getAttribute('aria-describedby');
  if (describedBy) {
    const refs = describedBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '');
    const joined = cleanText(refs.join(' '));
    if (joined) return { value: joined, source: 'aria-describedby' };
  }
  // Heuristic: next sibling with helper-ish class
  const next = el.nextElementSibling;
  if (next) {
    const cls = (next.getAttribute('class') || '').toLowerCase();
    if (/(help|hint|note|tip|description|caption|muted)/.test(cls)) {
      const t = cleanText(next.textContent || '');
      if (t) return { value: t, source: 'sibling-help' };
    }
  }
  // <small> sibling/parent-descendant — shadcn / Bootstrap idiom for hints.
  // UX iteration 2026-05-23 — was missed before; many modern form libs use
  // <small class="text-muted-foreground"> for hints rather than .help-text.
  const parent = el.parentElement;
  if (parent) {
    const small = parent.querySelector('small');
    if (small && !small.contains(el)) {
      const t = cleanText(small.textContent || '');
      if (t) return { value: t, source: 'small-tag' };
    }
  }
  // Parent's helper child via known utility / framework classes.
  if (parent) {
    const candidates = parent.querySelectorAll('.help-text, .helper-text, .form-help, .ant-form-item-explain, .el-form-item__error, .field-help, .text-muted, [class*="muted" i], [class*="hint" i]');
    for (const c of Array.from(candidates)) {
      const t = cleanText(c.textContent || '');
      if (t) return { value: t, source: 'muted-class' };
    }
  }
  return undefined;
}

function buildSelector(el: HTMLElement): string {
  if (el.id) return `#${cssEscape(el.id)}`;
  const name = (el as HTMLInputElement).name;
  if (name) {
    return `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
  }
  // Path-based fallback
  const path: string[] = [];
  let cur: HTMLElement | null = el;
  while (cur && cur !== document.body) {
    let part = cur.tagName.toLowerCase();
    if (cur.classList.length) part += '.' + Array.from(cur.classList).slice(0, 2).map(cssEscape).join('.');
    const siblings = cur.parentElement ? Array.from(cur.parentElement.children).filter((c) => c.tagName === cur!.tagName) : [];
    if (siblings.length > 1) {
      part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
    }
    path.unshift(part);
    cur = cur.parentElement;
  }
  return path.join(' > ');
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function stableHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36).slice(0, 6);
}

/**
 * Write a value back into a single field. Three execution paths:
 *
 *   - Native <input>/<textarea>/<select>: use the native-setter trick so React
 *     controlled inputs actually update. Dispatch input/change/blur.
 *   - ARIA radio group container: find the [role="radio"] option whose
 *     accessible name matches `value`, then click it.
 *   - ARIA checkbox container: split `value` on commas/Chinese commas,
 *     click each matching [role="checkbox"]. (For multi-select.)
 *   - ARIA listbox (custom dropdown): click the matching [role="option"].
 *
 * Returns true if at least one matching control was activated.
 *
 * Why the native-input gymnastics: React tracks an internal `_valueTracker`
 * for controlled inputs. Setting `el.value = x` directly bypasses React's
 * setter, so React thinks nothing changed and reverts the value on the next
 * render. The canonical workaround is to grab the **native prototype's**
 * setter (HTMLInputElement.prototype, not the element's own prototype) and
 * call it with the element as `this`, then dispatch a synthetic `input`
 * event whose bubble React's onChange listens for.
 */
export function fillField(selector: string, value: string): boolean {
  const target = document.querySelector(selector) as HTMLElement | null;
  if (!target) return false;

  // -------- ARIA choice paths --------
  // Detect by what's INSIDE the targeted container. Google Forms / shadcn /
  // most modern form libs render styled divs with role="radio" etc.; the
  // selector for these fields points at the question's wrapper, not at a
  // specific input.
  const radios = Array.from(target.querySelectorAll<HTMLElement>('[role="radio"]'));
  const checkboxes = Array.from(target.querySelectorAll<HTMLElement>('[role="checkbox"]'));
  const listboxOptions = Array.from(target.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"], [role="option"]'));

  if (radios.length > 0) {
    return clickMatchingOption(radios, value);
  }
  if (checkboxes.length > 0) {
    // Multi-select: try each comma-separated value
    const wanted = value.split(/[,，、;；/]/).map((s) => s.trim()).filter(Boolean);
    let any = false;
    for (const w of wanted) {
      if (clickMatchingOption(checkboxes, w)) any = true;
    }
    return any;
  }
  if (listboxOptions.length > 0) {
    return clickMatchingOption(listboxOptions, value);
  }

  // -------- Native radio/checkbox group (UX iteration 2026-05-30) --------
  // When the selector points at a group CONTAINER (a div/fieldset, not a single
  // input) holding native <input type=radio|checkbox>, set .checked on the
  // matching option(s). The old code fell through to the text path below and
  // set .value on a radio — which never actually checks it.
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLSelectElement)) {
    const nativeRadios = Array.from(target.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    if (nativeRadios.length > 0) {
      return checkMatchingNative(nativeRadios, [value]);
    }
    const nativeChecks = Array.from(target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    if (nativeChecks.length > 0) {
      const wanted = value.split(/[,，、;；/]/).map((s) => s.trim()).filter(Boolean);
      return checkMatchingNative(nativeChecks, wanted);
    }
    // Button-group choice (UX iteration 2026-05-31): styled <button> options
    // with no input + no role=radio. Click the matching button(s); the form's
    // own handler toggles the selected CSS class. Action buttons are excluded
    // so we never click Save/Cancel.
    const choiceButtons = Array.from(
      target.querySelectorAll<HTMLElement>('button, [role="button"]'),
    ).filter((b) => !ACTION_BTN_RE.test(cleanText(b.textContent || '')));
    if (choiceButtons.length > 0) {
      const wanted = value.split(/[,，、;；/]/).map((s) => s.trim()).filter(Boolean);
      let any = false;
      for (const w of wanted) {
        if (clickMatchingOption(choiceButtons, w)) any = true;
      }
      return any;
    }
  }

  // -------- Native input / textarea / select path --------
  const el = target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const ProtoCtor =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement
    : el instanceof HTMLSelectElement ? HTMLSelectElement
    : el instanceof HTMLInputElement ? HTMLInputElement
    : null;
  if (!ProtoCtor) return false;

  const setter = Object.getOwnPropertyDescriptor(ProtoCtor.prototype, 'value')?.set;

  try { el.focus(); } catch { /* may be disabled */ }

  if (setter) {
    setter.call(el, value);
  } else {
    (el as { value: string }).value = value;
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch { /* ignore */ }

  return true;
}

/**
 * Programmatically attach a file to an <input type="file">. The trick is
 * DataTransfer: native `input.files` is a read-only FileList, but you CAN
 * assign a FileList obtained from a DataTransfer object you constructed.
 * Setting it via the prototype setter (same React workaround pattern as for
 * text inputs) then dispatching change/input events makes the form's JS
 * believe a user actually selected the file.
 *
 * For drop-zone-only UIs (no real input present): we also dispatch a
 * synthetic `drop` event on the zone with the DataTransfer attached — many
 * drag-drop libraries (Qualtrics, react-dropzone) honor this and ingest the
 * file. Worst-case: the zone ignores synthetic events and the user has to
 * upload manually — we return false so the caller can flag it.
 */
export function fillFileField(selector: string, bytes: ArrayBuffer, mimeType: string, filename: string): boolean {
  const target = document.querySelector(selector);
  if (!target) return false;

  const file = new File([bytes], filename, { type: mimeType });
  const dt = new DataTransfer();
  dt.items.add(file);

  // Path 1: target IS the file input
  if (target instanceof HTMLInputElement && target.type === 'file') {
    try { target.focus(); } catch { /* may be hidden */ }
    // Use the prototype's `files` setter so React/Vue's controlled-input
    // valueTracker sees the change (same trick as for text inputs).
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
    if (setter) {
      setter.call(target, dt.files);
    } else {
      (target as { files: FileList }).files = dt.files;
    }
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // Path 2: target is a drop zone container — look for a nested input first
  const nestedInput = (target as HTMLElement).querySelector?.('input[type="file"]') as HTMLInputElement | null;
  if (nestedInput) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
    if (setter) {
      setter.call(nestedInput, dt.files);
    } else {
      nestedInput.files = dt.files;
    }
    nestedInput.dispatchEvent(new Event('input', { bubbles: true }));
    nestedInput.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // Path 3: pure drop zone — simulate drag events
  try {
    const opts: DragEventInit = { bubbles: true, cancelable: true, dataTransfer: dt };
    (target as HTMLElement).dispatchEvent(new DragEvent('dragenter', opts));
    (target as HTMLElement).dispatchEvent(new DragEvent('dragover', opts));
    (target as HTMLElement).dispatchEvent(new DragEvent('drop', opts));
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the option whose accessible name best matches the wanted value, then
 * click it (Google Forms responds to click; the page's own JS toggles
 * aria-checked and updates the underlying state).
 *
 * Match strategy, from most strict to most permissive:
 *   1) exact case-insensitive match on aria-label / data-value / text
 *   2) the option's text is a substring of `wanted` (or vice versa)
 *   3) Levenshtein-style similarity > 0.7 (placeholder: simple includes)
 */
function clickMatchingOption(options: HTMLElement[], wanted: string): boolean {
  const w = wanted.trim().toLowerCase();
  if (!w) return false;
  // Pass 1: exact
  for (const o of options) {
    const t = ariaOptionText(o).toLowerCase();
    if (t === w) {
      o.click();
      return true;
    }
  }
  // Pass 2: substring either way
  for (const o of options) {
    const t = ariaOptionText(o).toLowerCase();
    if (t && (t.includes(w) || w.includes(t))) {
      o.click();
      return true;
    }
  }
  return false;
}

/**
 * Check the native <input type=radio|checkbox> whose option label matches each
 * wanted value. Sets `.checked` via the prototype setter (React-controlled
 * forms) + dispatches input/change. UX iteration 2026-05-30.
 *
 * For radios `wanted` is a single value; for checkboxes it's the split list.
 */
function checkMatchingNative(inputs: HTMLInputElement[], wanted: string[]): boolean {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
  let any = false;
  for (const raw of wanted) {
    const w = raw.trim().toLowerCase();
    if (!w) continue;
    // exact match first, then substring either way
    let hit = inputs.find((i) => nativeOptionLabel(i).toLowerCase() === w);
    if (!hit) {
      hit = inputs.find((i) => {
        const t = nativeOptionLabel(i).toLowerCase();
        return !!t && (t.includes(w) || w.includes(t));
      });
    }
    if (hit) {
      try { hit.focus(); } catch { /* may be hidden */ }
      if (setter) setter.call(hit, true);
      else hit.checked = true;
      hit.dispatchEvent(new Event('input', { bubbles: true }));
      hit.dispatchEvent(new Event('change', { bubbles: true }));
      any = true;
    }
  }
  return any;
}
