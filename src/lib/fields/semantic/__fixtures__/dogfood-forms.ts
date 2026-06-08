// R8 — recall regression corpus.
//
// IMPORTANT / HONEST LABELLING: these fixtures are **representative** — hand-authored to
// reproduce the DOM STRUCTURES of forms we dogfooded (HiCool two-column t-row/t-col, 上海创业营
// flat form-row, standard <label for>). They are NOT scraped real HTML. Real recall is measured
// on live forms during manual dogfood; this corpus guards against the scanner regressing on the
// structural families it already supports, and gives the hybrid pipeline a non-regression check.

export interface FormFixture {
  name: string;
  html: string;
  /** The fields a human would fill — the recall denominator. */
  keyLabels: string[];
  /**
   * Minimum heuristic recall this fixture must hit (regression floor). Defaults to 0.5. Some
   * families are genuinely hard for the pure heuristic — e.g. styled-button choice groups — and a
   * LOWER floor here is an HONEST record of that gap, which is precisely what the LLM hybrid pass
   * closes (hybrid recall ≥ heuristic is asserted separately).
   */
  minRecall?: number;
}

export const FIXTURES: FormFixture[] = [
  {
    name: 'hicool-two-column (li.t-row > t-col-l 标签 + t-col-r 控件)',
    html: `
      <ul>
        <li class="t-row"><div class="t-col"><div class="t-col-l">项目名称：</div><div class="t-col-r"><input type="text" maxlength="50"></div></div></li>
        <li class="t-row"><div class="t-col"><div class="t-col-l">参赛赛道：</div><div class="t-col-r"><select><option value="">请选择</option><option>AI</option><option>硬件</option></select></div></div></li>
        <li class="t-row"><div class="t-col"><div class="t-col-l">项目简介：</div><div class="t-col-r"><textarea maxlength="200"></textarea></div></div></li>
      </ul>`,
    keyLabels: ['项目名称', '参赛赛道', '项目简介'],
  },
  {
    name: 'shanghai-flat (div.form-row + 纯文本前导标签)',
    html: `
      <div class="form-row">申请人姓名 <input type="text"></div>
      <div class="form-row">职位 <input type="text"></div>
      <div class="form-row">项目一句话介绍 <input type="text" placeholder="不超过200字"></div>`,
    keyLabels: ['申请人姓名', '职位', '项目一句话介绍'],
  },
  {
    name: 'standard-label-for (经典 <label for> + select)',
    html: `
      <form>
        <label for="a">公司名称</label><input id="a" type="text">
        <label for="b">融资阶段</label><select id="b"><option>种子</option><option>A轮</option></select>
        <label for="c">团队规模</label><input id="c" type="number">
      </form>`,
    keyLabels: ['公司名称', '融资阶段', '团队规模'],
  },
  {
    name: 'epic-connector-button-group (styled <button> 单/复选 + label)',
    html: `
      <div><label>CURRENT ROLE</label>
        <button type="button">Founder</button><button type="button">Student</button><button type="button">Professional</button>
      </div>
      <div><label>Project Name</label><input type="text"></div>
      <div><label>MAIN TRACK</label>
        <button type="button">Agent</button><button type="button">Skill</button><button type="button">Application</button>
      </div>`,
    keyLabels: ['CURRENT ROLE', 'Project Name', 'MAIN TRACK'],
    // Pure heuristic only reliably catches the text input here (~0.33) — the styled-button groups
    // are the family the LLM semantic pass is meant to recover. Honest floor, not a gamed one.
    minRecall: 0.3,
  },
  {
    name: 'gowithdream-step2 (多步表单第二页的新字段)',
    html: `
      <div class="form-row">项目概况 <textarea maxlength="500"></textarea></div>
      <div class="form-row">落地规划 <textarea maxlength="500"></textarea></div>
      <div class="form-row">参赛期望 <input type="text"></div>`,
    keyLabels: ['项目概况', '落地规划', '参赛期望'],
  },
];
