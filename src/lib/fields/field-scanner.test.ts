// Tests for field-scanner — the core differentiator.
// Specifically validates that we extract the constraint info that Claude for Chrome
// is documented to miss (placeholder char limits, helper text, required markers).

import { describe, expect, it, beforeEach } from 'vitest';
import { scanFields, inspectPage, fillField } from './field-scanner';

function setupDOM(html: string) {
  document.body.innerHTML = html;
}

describe('field-scanner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('extracts label, type, and maxLength', () => {
    setupDOM(`
      <label for="x">项目名</label>
      <input id="x" type="text" maxlength="100" required />
    `);
    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]?.label).toBe('项目名');
    expect(fields[0]?.constraints.maxLength).toBe(100);
    expect(fields[0]?.constraints.required).toBe(true);
  });

  it('detects Chinese "200字以内" from helper text — the Claude for Chrome miss', () => {
    setupDOM(`
      <div>
        <label for="bio">项目愿景</label>
        <textarea id="bio" aria-describedby="bio-help"></textarea>
        <div id="bio-help">请用 200 字以内描述</div>
      </div>
    `);
    const fields = scanFields();
    expect(fields[0]?.constraints.maxLength).toBe(200);
    expect(fields[0]?.constraints.helperText).toContain('200 字以内');
  });

  it('detects English "max 500 characters" from placeholder', () => {
    setupDOM(`
      <label for="desc">Description</label>
      <textarea id="desc" placeholder="Brief intro, max 500 characters"></textarea>
    `);
    const fields = scanFields();
    expect(fields[0]?.constraints.maxLength).toBe(500);
  });

  it('detects required from asterisk in label', () => {
    setupDOM(`
      <label for="r">Project Name *</label>
      <input id="r" type="text" />
    `);
    const fields = scanFields();
    expect(fields[0]?.constraints.required).toBe(true);
  });

  it('preserves stricter constraint when both maxlength attr and hint disagree', () => {
    setupDOM(`
      <label for="s">介绍</label>
      <input id="s" type="text" maxlength="500" placeholder="不超过 200 字" />
    `);
    const fields = scanFields();
    // The 200 hint is stricter — we should adopt it.
    expect(fields[0]?.constraints.maxLength).toBe(200);
  });

  it('collects select options', () => {
    setupDOM(`
      <label for="sel">行业</label>
      <select id="sel">
        <option>AI</option>
        <option>电商</option>
        <option>硬件</option>
      </select>
    `);
    const fields = scanFields();
    expect(fields[0]?.constraints.options).toEqual(['AI', '电商', '硬件']);
  });

  it('skips unlabeled fields to avoid hallucination', () => {
    setupDOM(`<input type="text" />`);
    const fields = scanFields();
    expect(fields).toHaveLength(0);
  });

  // Regression: Google Form label "请用 200 字介绍你的项目" was not catching
  // the 200 because the existing patterns required "最多"/"以内" suffixes.
  // The bare "用 N 字 介绍/描述/说明" form is the most common Chinese pattern.
  it('extracts maxLength from "用 200 字介绍" instruction-style label', () => {
    setupDOM(`
      <label for="bio">请用 200 字介绍你的项目</label>
      <textarea id="bio"></textarea>
    `);
    const fields = scanFields();
    expect(fields[0]?.constraints.maxLength).toBe(200);
  });

  // Regression: Google Forms renders radios as styled divs with role="radio"
  // inside a role="listitem" container. The plain input scan misses them
  // entirely and worse — picks up the inline "Other" text input as a
  // standalone field, mislabeled by adjacent text.
  it('detects ARIA radio group + ignores nested "Other" input', () => {
    setupDOM(`
      <div role="listitem">
        <div role="heading" aria-level="3">所在城市 *</div>
        <div role="radiogroup">
          <div role="radio" aria-label="北京"></div>
          <div role="radio" aria-label="上海"></div>
          <div role="radio" aria-label="深圳"></div>
          <div role="radio" aria-label="其他">
            <input type="text" placeholder="其他回复" />
          </div>
        </div>
      </div>
    `);
    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]?.type).toBe('radio');
    expect(fields[0]?.label).toContain('所在城市');
    expect(fields[0]?.constraints.options).toEqual(['北京', '上海', '深圳', '其他']);
    expect(fields[0]?.constraints.required).toBe(true);
  });

  // Regression: scanner was returning 57 fields on a 5-field Google Form
  // because it scooped up every "Add option" / "Question number" / etc.
  // admin input. The label denylist filters those out by label pattern.
  it('skips Google Forms editor admin inputs by label pattern', () => {
    setupDOM(`
      <label for="q1">问题编号</label>
      <input id="q1" type="number" />
      <label for="q2">回复编号</label>
      <input id="q2" type="number" />
      <label for="q3">默认分值</label>
      <input id="q3" type="number" />
      <label for="q4">添加选项</label>
      <input id="q4" type="text" />
      <label for="q5">真实问题：项目名称</label>
      <input id="q5" type="text" />
    `);
    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]?.label).toContain('项目名称');
  });

  it('skips inputs inside aria-hidden / role=toolbar / role=menu', () => {
    setupDOM(`
      <div aria-hidden="true">
        <label for="a">隐藏字段</label>
        <input id="a" type="text" />
      </div>
      <div role="toolbar">
        <label for="b">工具栏字段</label>
        <input id="b" type="text" />
      </div>
      <div role="menu">
        <label for="c">菜单字段</label>
        <input id="c" type="text" />
      </div>
      <label for="d">真实字段</label>
      <input id="d" type="text" />
    `);
    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]?.label).toBe('真实字段');
  });

  it('skips display:none inputs even when label is plausible', () => {
    setupDOM(`
      <label for="h" style="display:none">隐藏的真实字段</label>
      <input id="h" type="text" style="display:none" />
      <label for="v">可见字段</label>
      <input id="v" type="text" />
    `);
    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]?.label).toBe('可见字段');
  });

  // Regression: Qualtrics-style file upload renders the native <input
  // type=file> with display:none and a styled drop zone on top. The visibility
  // filter was excluding it — so the user never saw the field at all.
  it('detects hidden input[type=file] and prefixes with parent question label', () => {
    setupDOM(`
      <div class="QuestionBody">
        <div class="QuestionText">项目照片（PNG, JPG）</div>
        <input type="file" accept="image/png,image/jpeg" style="display:none" id="upload1" />
      </div>
    `);
    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]?.type).toBe('file');
    expect(fields[0]?.label).toContain('项目照片');
    // accept= attribute surfaced as placeholder hint
    expect(fields[0]?.constraints.placeholder).toContain('image/png');
  });

  it('prefixes sub-inputs with parent question heading', () => {
    setupDOM(`
      <div class="QuestionBody">
        <div class="QuestionText">出席项目队员名字 及 职业/职称</div>
        <label for="m1">1. 路演人</label>
        <input id="m1" type="text" />
        <label for="m2">2. 成员</label>
        <input id="m2" type="text" />
      </div>
    `);
    const fields = scanFields();
    expect(fields).toHaveLength(2);
    expect(fields[0]?.label).toBe('出席项目队员名字 及 职业/职称 - 1. 路演人');
    expect(fields[1]?.label).toBe('出席项目队员名字 及 职业/职称 - 2. 成员');
  });

  it('inspectPage detects Google Forms /edit URL as editor', () => {
    expect(inspectPage('https://docs.google.com/forms/d/abc123/edit').isEditor).toBe(true);
    expect(inspectPage('https://docs.google.com/forms/d/e/abc123/viewform').isEditor).toBe(false);
    expect(inspectPage('https://admin.typeform.com/form/abc/create').isEditor).toBe(true);
    expect(inspectPage('https://example.com/form').isEditor).toBe(false);
  });

  it('detects ARIA checkbox group with multiple options', () => {
    setupDOM(`
      <div role="group" aria-label="选择你感兴趣的方向">
        <div role="checkbox" aria-label="AI Agent"></div>
        <div role="checkbox" aria-label="电商"></div>
        <div role="checkbox" aria-label="硬件"></div>
      </div>
    `);
    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]?.type).toBe('checkbox');
    expect(fields[0]?.constraints.options).toEqual(['AI Agent', '电商', '硬件']);
  });

  // UX iteration 2026-05-23 — MAX_LENGTH_PATTERNS expansion tests.
  // PMs report Chinese forms using "约"/"控制在"/"字左右" variants that the
  // original "最多/不超过" patterns missed, letting Claude generate over-limit
  // content that the server silently truncated.
  describe('MAX_LENGTH variants — new patterns from UX iteration', () => {
    it('extracts maxLength from "约 200 字" (approximate)', () => {
      setupDOM(`
        <label for="x">项目简介</label>
        <textarea id="x" aria-describedby="x-help"></textarea>
        <div id="x-help">约 300 字</div>
      `);
      const fields = scanFields();
      expect(fields[0]?.constraints.maxLength).toBe(300);
    });

    it('extracts maxLength from "控制在 500 字" pattern', () => {
      setupDOM(`
        <label for="x">愿景</label>
        <textarea id="x" placeholder="控制在 500 字以内"></textarea>
      `);
      const fields = scanFields();
      expect(fields[0]?.constraints.maxLength).toBe(500);
    });

    it('extracts maxLength from "200 字左右" pattern', () => {
      setupDOM(`
        <label for="x">摘要</label>
        <textarea id="x" placeholder="200 字左右"></textarea>
      `);
      const fields = scanFields();
      expect(fields[0]?.constraints.maxLength).toBe(200);
    });

    it('extracts maxLength from English "about 500 words"', () => {
      setupDOM(`
        <label for="x">Summary</label>
        <textarea id="x" placeholder="About 500 words"></textarea>
      `);
      const fields = scanFields();
      expect(fields[0]?.constraints.maxLength).toBe(500);
    });
  });

  // UX iteration 2026-05-23 — FORM_EDITOR_URL_PATTERNS coverage.
  describe('Form editor URLs — extended coverage', () => {
    it('detects Qualtrics editor URL', () => {
      expect(inspectPage('https://uni.eu.qualtrics.com/survey-builder/SV_abc/edit-survey').isEditor).toBe(true);
      expect(inspectPage('https://hku.qualtrics.com/jfe/form/SV_abc').isEditor).toBe(false);
    });

    it('detects Tally editor URL', () => {
      expect(inspectPage('https://tally.so/forms/abc123/edit').isEditor).toBe(true);
      expect(inspectPage('https://tally.so/r/abc123').isEditor).toBe(false);
    });

    it('detects Jotform builder URL', () => {
      expect(inspectPage('https://www.jotform.com/build/123').isEditor).toBe(true);
      expect(inspectPage('https://form.jotform.com/123').isEditor).toBe(false);
    });

    it('detects 问卷星 editor URL', () => {
      expect(inspectPage('https://www.wjx.cn/newwjx/manage/myquestionnaires.aspx').isEditor).toBe(true);
      expect(inspectPage('https://wjx.cn/jq/abc.aspx').isEditor).toBe(false);
    });
  });

  // UX iteration 2026-05-23 (T13) — provenance tracking.
  describe('provenance — field metadata', () => {
    it('populates provenance.source = html-input for plain inputs', () => {
      setupDOM(`<label for="x">项目名</label><input id="x" type="text" />`);
      const fields = scanFields();
      expect(fields[0]?.provenance?.source).toBe('html-input');
      expect(fields[0]?.provenance?.labelSource).toBe('label-tag');
      expect(fields[0]?.provenance?.labelConfidence).toBe('exact');
    });

    it('populates provenance.source = aria-group for ARIA radios', () => {
      setupDOM(`
        <div role="group" aria-label="所在城市">
          <div role="radio" aria-label="北京"></div>
          <div role="radio" aria-label="上海"></div>
        </div>
      `);
      const fields = scanFields();
      expect(fields[0]?.provenance?.source).toBe('aria-group');
      expect(fields[0]?.provenance?.labelSource).toBe('aria-label');
    });

    it('populates provenance.source = drop-zone for file input inside upload widget', () => {
      setupDOM(`
        <div class="QuestionBody">
          <div class="QuestionText">项目照片</div>
          <div class="upload-zone">
            <p>拖拽文件到这里或点击上传</p>
            <input type="file" accept="image/*" style="display:none" id="up1" />
          </div>
        </div>
      `);
      const fields = scanFields();
      expect(fields[0]?.provenance?.source).toBe('drop-zone');
    });

    it('records matched max-length pattern in provenance', () => {
      setupDOM(`
        <label for="x">摘要</label>
        <textarea id="x" placeholder="控制在 200 字以内"></textarea>
      `);
      const fields = scanFields();
      expect(fields[0]?.provenance?.maxLength?.value).toBe(200);
      // matchedPattern includes the regex source — earlier patterns win first.
      // Any of the "字" patterns is acceptable; the important thing is it's
      // recorded for debugging.
      expect(fields[0]?.provenance?.maxLength?.matchedPattern).toContain('字');
    });

    it('labels placeholder-derived labels as fallback confidence', () => {
      setupDOM(`<input type="text" placeholder="你的姓名" />`);
      const fields = scanFields();
      // No <label for=...>, no aria-label, no parent heading — only placeholder
      // remains. confidence='fallback' tells the user this might be unreliable.
      expect(fields[0]?.provenance?.labelSource).toBe('placeholder');
      expect(fields[0]?.provenance?.labelConfidence).toBe('fallback');
    });
  });

  // UX iteration 2026-05-23 — admin label patterns for other form builders.
  it('skips Jotform admin labels by pattern', () => {
    setupDOM(`
      <label for="q1">Field Label</label>
      <input id="q1" type="text" />
      <label for="q2">Question Settings</label>
      <input id="q2" type="text" />
      <label for="q3">真实问题：项目名称</label>
      <input id="q3" type="text" />
    `);
    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]?.label).toContain('项目名称');
  });
});

// =============================================================================
// UX iteration 2026-05-30 — flat hand-written forms (bare text-node labels +
// native radio/checkbox). Modeled on the REAL structure of the Shanghai
// startup-camp registration form, where the original scanner detected only
// 8 / 19 fields (missed all 3 textareas + all native radio/checkbox groups).
// =============================================================================
describe('field-scanner — flat form-row + native controls (2026-05-30)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('detects a textarea whose label is a bare text node in a form-row, incl maxLength', () => {
    setupDOM(`
      <div class="form-row no-padding">*项目简介(不超过 200 字)<br><textarea name="intro"></textarea></div>
    `);
    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]?.type).toBe('textarea');
    expect(fields[0]?.label).toContain('项目简介');
    // 200-char limit comes from the bare-text label being read now
    expect(fields[0]?.constraints.maxLength).toBe(200);
  });

  it('detects "一句话项目介绍（不超过20字…）" textarea with 20-char limit', () => {
    setupDOM(`
      <div class="form-row no-padding">*一句话项目介绍（不超过20字，请用一句话描述您的项目）<br><textarea name="oneliner"></textarea></div>
    `);
    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]?.constraints.maxLength).toBe(20);
  });

  it('groups native <input type=radio> into ONE choice field with options', () => {
    setupDOM(`
      <div class="form-row no-padding">*是否成立公司:
        <input type="radio" name="gender" id="radio_yes">是
        <input type="radio" name="gender" id="radio_no">否
      </div>
    `);
    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]?.type).toBe('radio');
    expect(fields[0]?.label).toContain('是否成立公司');
    expect(fields[0]?.constraints.options).toEqual(['是', '否']);
    expect(fields[0]?.constraints.required).toBe(true);
  });

  it('groups native checkboxes into ONE multi-select field', () => {
    setupDOM(`
      <div class="form-row no-padding">*您如何定义您自己:
        <input type="checkbox" name="role" id="c1">连续创业者
        <input type="checkbox" name="role" id="c2">技术型创业者
        <input type="checkbox" name="role" id="c3">大学生创业者
      </div>
    `);
    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]?.type).toBe('checkbox');
    expect(fields[0]?.constraints.options).toEqual(['连续创业者', '技术型创业者', '大学生创业者']);
  });

  it('fillField checks the matching native radio (sets .checked, not .value)', () => {
    setupDOM(`
      <div class="form-row no-padding" id="grp">*是否成立公司:
        <input type="radio" name="gender" id="radio_yes">是
        <input type="radio" name="gender" id="radio_no">否
      </div>
    `);
    const ok = fillField('#grp', '是');
    expect(ok).toBe(true);
    expect((document.getElementById('radio_yes') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('radio_no') as HTMLInputElement).checked).toBe(false);
  });

  it('does NOT regress: plain input whose label is the placeholder still works', () => {
    setupDOM(`
      <div class="form-row no-padding"><i>*</i><input type="text" placeholder="项目名称"></div>
    `);
    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]?.label).toBe('项目名称');
  });

  // UX iteration 2026-05-30 — custom JS upload widgets (no <input type=file>).
  it('detects a custom JS upload field (上传 trigger + 尚未上传 status, no file input)', () => {
    setupDOM(`
      <div class="news-list-item no-image"><div class="list-content">
        <span class="list-category">项目商业计划书（建议包含项目介绍、市场分析等）</span>
        <a>上传</a>
        <h2 class="list-title">尚未上传任何文件</h2>
      </div></div>
    `);
    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]?.type).toBe('file');
    expect(fields[0]?.constraints.manualUploadOnly).toBe(true);
    expect(fields[0]?.label).toContain('项目商业计划书');
  });

  it('does NOT false-positive a whole form section as an upload field', () => {
    // A stray "上传" trigger whose only status-bearing ancestor also holds
    // form controls must be rejected (real upload blocks have no inputs).
    setupDOM(`
      <div class="form-row-group">
        <span class="list-category">真实问题：项目名</span>
        <input type="text" placeholder="项目名" />
        <a>上传</a>
        <h2>尚未上传任何文件</h2>
      </div>
    `);
    const fields = scanFields();
    // Should detect the text input, NOT a phantom upload field for the whole block.
    expect(fields.some((f) => f.type === 'file')).toBe(false);
  });
});

describe('field-scanner — DOM order + label isolation (2026-05-31 dogfood)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns fields in DOM order, not grouped by detection pass', () => {
    // A native radio group sits BETWEEN two text inputs. Detection runs in
    // passes by TYPE (choice groups before plain inputs), so without an
    // explicit document-order sort the radio would jump ahead of 项目名称.
    setupDOM(`
      <form>
        <div class="form-row"><i>*</i><input type="text" placeholder="项目名称"></div>
        <div class="form-row">*是否成立公司:
          <input type="radio" name="g" id="y">是
          <input type="radio" name="g" id="n">否
        </div>
        <div class="form-row"><i>*</i><input type="text" placeholder="申请人姓名"></div>
      </form>
    `);
    const fields = scanFields();
    expect(fields.map((f) => f.label)).toEqual(['项目名称', '是否成立公司', '申请人姓名']);
  });

  it('does NOT borrow a LATER sibling heading as a label (upload-status leak)', () => {
    // Reproduces the real form: a `form-row-group` (matches the wrapper regex
    // via the "form-row" substring) holds a placeholder-labelled text input
    // whose own row carries only the "*" marker, followed by a sibling custom
    // upload widget whose <h2> status is "尚未上传任何文件". The input must keep
    // its own placeholder label — NOT inherit the later h2.
    setupDOM(`
      <div class="form-row-group with-icons">
        <div class="form-row"><i>*</i><input type="text" placeholder="申请人姓名"></div>
        <h2 class="list-title">尚未上传任何文件</h2>
      </div>
    `);
    const fields = scanFields();
    const nameField = fields.find((f) => f.type === 'text');
    expect(nameField?.label).toBe('申请人姓名');
    expect(nameField?.label).not.toContain('尚未上传');
  });

  it('still inherits a PRECEDING shared question heading for sub-inputs', () => {
    // The legit case the heading climb exists for: one question title above
    // several sub-inputs. The heading PRECEDES the input, so it's still used.
    setupDOM(`
      <div class="form-group">
        <h3 class="question-title">出席项目队员</h3>
        <div class="form-row"><input type="text" placeholder="姓名"></div>
      </div>
    `);
    const fields = scanFields();
    const f = fields.find((x) => x.type === 'text');
    expect(f?.label).toContain('出席项目队员');
    expect(f?.label).toContain('姓名');
  });
});

describe('field-scanner — <button> choice groups (2026-05-31 Epic Connector)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('detects a <button> group (no input, no role=radio) as a radio choice field', () => {
    setupDOM(`
      <div class="form-item">
        <label>Main Track (Single Select) *</label>
        <div class="flex flex-wrap gap-2">
          <button type="button">Agent</button>
          <button type="button">Skill</button>
          <button type="button">Application</button>
        </div>
      </div>
    `);
    const fields = scanFields();
    const f = fields.find((x) => x.label.includes('Main Track'));
    expect(f).toBeTruthy();
    expect(f?.type).toBe('radio');
    expect(f?.constraints.options).toEqual(['Agent', 'Skill', 'Application']);
    expect(f?.constraints.required).toBe(true);
  });

  it('fillField clicks the matching button in a button-group', () => {
    setupDOM(`
      <div class="form-item">
        <label>Main Track</label>
        <div id="grp" class="flex"><button type="button">Agent</button><button type="button">Skill</button></div>
      </div>
    `);
    let clicked = '';
    document.querySelectorAll('#grp button').forEach((b) =>
      b.addEventListener('click', () => {
        clicked = (b.textContent || '').trim();
      }),
    );
    const ok = fillField('#grp', 'Skill');
    expect(ok).toBe(true);
    expect(clicked).toBe('Skill');
  });

  it('does NOT treat an action button row (Cancel / Save) as a choice field', () => {
    setupDOM(`
      <div class="modal">
        <label>Footer</label>
        <div class="flex gap-2">
          <button type="button">Cancel</button>
          <button type="submit">Save Changes</button>
        </div>
      </div>
    `);
    const fields = scanFields();
    expect(fields.some((f) => f.constraints.options?.includes('Cancel'))).toBe(false);
  });

  it('does NOT treat a nav/tab bar as a choice field (non-<label> preceding text + nav ancestor)', () => {
    setupDOM(`
      <header>
        <div class="progress">Ends In 10D 11H · Your Progress</div>
        <div class="flex">
          <button type="button">Overview</button>
          <button type="button">Features</button>
          <button type="button">Guides</button>
        </div>
      </header>
    `);
    const fields = scanFields();
    expect(fields.some((f) => f.constraints.options?.includes('Overview'))).toBe(false);
  });

  it('treats "(select up to 2)" as multi-select (checkbox), not single', () => {
    setupDOM(`
      <div class="form-item">
        <label>Track * (select up to 2)</label>
        <div class="flex flex-wrap gap-2">
          <button type="button">Agent</button>
          <button type="button">Skill</button>
          <button type="button">Application</button>
          <button type="button">DeepResearch</button>
        </div>
      </div>
    `);
    const fields = scanFields();
    const f = fields.find((x) => x.label.includes('Track'));
    expect(f?.type).toBe('checkbox');
    expect(f?.constraints.options).toEqual(['Agent', 'Skill', 'Application', 'DeepResearch']);
  });
});

// HiCool (moore.hicool.com) dogfood 2026-06-06: two-column "label cell | field
// cell" layout (li.t-row > div.t-col > div.t-col-l[label] + div.t-col-r[field]).
// The wrapper classes don't match any known regex and the label is a SIBLING
// cell, so before V2.8 every field degraded to its placeholder and the select /
// radio / file controls (which have no placeholder) were dropped entirely.
describe('field-scanner — two-column sibling-cell layouts (HiCool dogfood 2026-06-06)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // HiCool-shaped row: label lives in the .t-col-l sibling of the field cell.
  const row = (label: string, inner: string) => `
    <li class="t-row"><div class="t-col">
      <div class="t-col-l">${label}</div>
      <div class="t-col-r">${inner}</div>
    </div></li>`;

  it('G1: reads the label from a sibling cell when the wrapper class is unknown', () => {
    setupDOM(`<ul>${row('*项目名称：', '<input type="text" placeholder="请填写项目全称" />')}</ul>`);
    const fields = scanFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]?.label).toContain('项目名称');
  });

  it('G2: recovers a native <select> with no placeholder (was dropped for lack of a label)', () => {
    setupDOM(`<ul>${row('*参赛赛道：', '<select><option>请选择</option><option>具身智能</option><option>AI智能体</option></select>')}</ul>`);
    const f = scanFields().find((x) => x.type === 'select');
    expect(f?.label).toContain('参赛赛道');
    expect(f?.constraints.options).toEqual(['请选择', '具身智能', 'AI智能体']);
  });

  it('G3: detects opacity:0 native radios (custom-styled) with sibling label + required', () => {
    setupDOM(`<ul>${row('*是否成立公司：',
      '<label><input type="radio" name="c" style="opacity:0" />有公司</label>' +
      '<label><input type="radio" name="c" style="opacity:0" />无公司</label>')}</ul>`);
    const f = scanFields().find((x) => x.type === 'radio');
    expect(f?.label).toBe('是否成立公司');
    expect(f?.constraints.options).toEqual(['有公司', '无公司']);
    expect(f?.constraints.required).toBe(true);
  });

  it('G4: labels file inputs from the real cell (skips the "选择" trigger) + drops the decoy text box', () => {
    setupDOM(`<ul>${row('*商业计划书：',
      '<input type="text" placeholder="上传文件" />' +
      '<a class="btn">选择</a>' +
      '<input type="file" name="upfile-1" accept=".pdf" />')}</ul>`);
    const fields = scanFields();
    expect(fields.find((x) => x.label.includes('上传文件'))).toBeUndefined();
    const f = fields.find((x) => x.type === 'file');
    expect(f?.label).toBe('商业计划书');
  });

  it('G4: dedupes multiple file inputs that resolve to the same label', () => {
    setupDOM(`<ul>${row('*商业计划书：',
      '<input type="file" name="bp-1" accept=".pdf" />' +
      '<input type="file" name="bp-2" accept=".pdf" />')}</ul>`);
    expect(scanFields().filter((x) => x.type === 'file')).toHaveLength(1);
  });

  it('G5: flags 验证码 as OTP and contact fields as personal (noAiFill)', () => {
    setupDOM(`<ul>
      ${row('*验证码：', '<input type="text" placeholder="请输入验证码" />')}
      ${row('*姓名：', '<input type="text" placeholder="联系人姓名" />')}
    </ul>`);
    const fields = scanFields();
    const code = fields.find((x) => x.label.includes('验证码'));
    expect(code?.constraints.noAiFill).toBe(true);
    expect(code?.constraints.sensitiveKind).toBe('otp');
    const name = fields.find((x) => x.label.includes('姓名'));
    expect(name?.constraints.noAiFill).toBe(true);
    expect(name?.constraints.sensitiveKind).toBe('personal');
  });
});

// 深创赛 dogfood (2026-06-29): a 主标题 + (字数限制) heading above a textarea whose
// placeholder is the 副标题 content hint. The clean title, the separated 副标题,
// and BOTH the min and max char limits must all be recovered.
describe('field-scanner — 主标题 / 副标题 / 字数限制 (深创赛)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('splits 主标题 from placeholder 副标题 and parses min+max char limits', () => {
    setupDOM(`
      <div class="form-row">
        <span>* 项目概要 （最少200字，最多不超过1000字）</span>
        <textarea placeholder="产品开发：生产策略、行业特点、竞争焦点。本公司技术、产品及服务的新颖性、先进性和独特性。"></textarea>
      </div>
    `);
    const f = scanFields().find((x) => x.type === 'textarea');
    expect(f).toBeTruthy();
    // 主标题 only — no 副标题, no length parenthetical.
    expect(f?.label).toBe('项目概要');
    expect(f?.label).not.toContain('产品开发');
    expect(f?.label).not.toContain('最少');
    // 副标题 preserved as the placeholder (rendered gray in the sidepanel).
    expect(f?.constraints.placeholder).toContain('产品开发');
    // Both limits are hard generation constraints.
    expect(f?.constraints.minLength).toBe(200);
    expect(f?.constraints.maxLength).toBe(1000);
  });

  it('parses a max-only heading "项目阶段（最多不超过100字）"', () => {
    setupDOM(`
      <div class="form-row">
        <span>* 项目阶段 （最多不超过100字）</span>
        <input type="text" placeholder="早期PMF验证期" />
      </div>
    `);
    const f = scanFields().find((x) => x.type === 'text');
    expect(f?.label).toBe('项目阶段');
    expect(f?.constraints.maxLength).toBe(100);
    expect(f?.constraints.minLength).toBeUndefined();
  });

  // 深创赛 真机 dogfood (2026-06-29, via Chrome MCP): Element UI + Bootstrap col
  // grid nests the control 4–5 wrappers below its grid cell, with the label in a
  // SIBLING cell (inline) or a PRECEDING row (full-width). findSiblingLabelCell's
  // depth<4 stopped short → every input vanished / fell back to placeholder.
  it('深创赛: Element-UI col grid — label cell is the field cell prev-sibling (deep nesting)', () => {
    setupDOM(`
      <div class="sc-main_form_group"><div class="row">
        <div class="col-xs-5">*参赛项目名称</div>
        <div class="col-xs-7 sc-main_form_field">
          <div class="el-form-item is-required"><div class="el-form-item__content">
            <div class="el-input"><input class="el-input__inner" type="text"></div>
          </div></div>
        </div>
      </div></div>
    `);
    const f = scanFields().find((x) => x.type === 'text');
    expect(f?.label).toBe('参赛项目名称');
  });

  it('深创赛: full-width textarea — label in a PRECEDING row + both char limits', () => {
    setupDOM(`
      <div class="sc-main_form_group">
        <div class="row"><div class="col-xs-24">*项目概要（最少200字，最多不超过1000字）</div></div>
        <div class="row"><div class="col-xs-24 sc-main_form_field">
          <div class="el-form-item is-required"><div class="el-form-item__content">
            <div class="el-textarea"><textarea placeholder="产品开发：生产策略、行业特点。"></textarea></div>
          </div></div>
        </div></div>
      </div>
    `);
    const f = scanFields().find((x) => x.type === 'textarea');
    expect(f?.label).toBe('项目概要');
    expect(f?.constraints.minLength).toBe(200);
    expect(f?.constraints.maxLength).toBe(1000);
    expect(f?.constraints.placeholder).toContain('产品开发');
  });
});
