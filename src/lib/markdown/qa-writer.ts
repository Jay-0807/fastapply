// Writes a single QARecord to a markdown file with full YAML frontmatter.
// This is the "experience vault" — what makes the extension better with each use.

import type { Project, EventContext, QARecord, UserAction } from '@/lib/db/types';

const USER_ACTION_LABELS: Record<UserAction, string> = {
  accepted: '直接采纳 ✅',
  edited_minor: '微改',
  edited_major: '大幅修改 🔄',
  rewritten: '完全重写',
  skipped: '跳过',
};

export function buildMarkdown(
  qaRecord: QARecord,
  project: Project,
  event: EventContext,
): string {
  const frontmatter = [
    '---',
    'applyforge_version: 1.0',
    `project: ${escapeYaml(project.name)}`,
    `project_id: ${project.id}`,
    `event_id: ${event.id}`,
    `event_name: ${escapeYaml(event.name)}`,
    `event_theme: ${escapeYaml(event.theme)}`,
    `event_organizer: ${escapeYaml(event.organizer)}`,
    `event_location: ${escapeYaml(event.location)}`,
    `event_url: ${escapeYaml(event.url)}`,
    event.deadline ? `event_deadline: ${event.deadline}` : null,
    `submitted_at: ${qaRecord.submittedAt ? new Date(qaRecord.submittedAt).toISOString() : 'null'}`,
    `page_url: ${escapeYaml(qaRecord.pageUrl)}`,
    `page_title: ${escapeYaml(qaRecord.pageTitle)}`,
    'stats:',
    `  total_fields: ${qaRecord.qaPairs.length}`,
    `  accepted: ${qaRecord.stats.accepted}`,
    `  edited_minor: ${qaRecord.stats.edited_minor}`,
    `  edited_major: ${qaRecord.stats.edited_major}`,
    `  rewritten: ${qaRecord.stats.rewritten}`,
    `  skipped: ${qaRecord.stats.skipped}`,
    'quality_signal:',
    '  default_excluded_from_rag: false',
    '---',
    '',
  ].filter(Boolean).join('\n');

  const header = `# ${event.name || '未命名活动'} · ${project.name}\n\n`;

  const eventBlock = [
    '## 活动背景',
    '',
    `- **主题**: ${event.theme || '—'}`,
    `- **主办方**: ${event.organizer || '—'}`,
    `- **地点**: ${event.location || '—'}`,
    event.deadline ? `- **截止**: ${event.deadline}` : null,
    `- **链接**: ${event.url || '—'}`,
    event.extraNotes ? `- **补充**: ${event.extraNotes}` : null,
    '',
    '---',
    '',
  ].filter(Boolean).join('\n');

  const qaBlocks = qaRecord.qaPairs
    .map((qa, idx) => {
      const constraintParts: string[] = [];
      if (qa.fieldConstraints.required) constraintParts.push('required');
      if (qa.fieldConstraints.maxLength) constraintParts.push(`maxLength=${qa.fieldConstraints.maxLength}`);
      if (qa.fieldConstraints.placeholder) constraintParts.push(`placeholder="${qa.fieldConstraints.placeholder}"`);
      const constraintLine = constraintParts.length ? ` (${constraintParts.join(' · ')})` : '';

      return [
        `### Q${idx + 1}: ${qa.fieldLabel}${constraintLine}`,
        '',
        `**字段类型**: ${qa.fieldType}${qa.fieldConstraints.helperText ? `  \n**辅助说明**: ${qa.fieldConstraints.helperText}` : ''}`,
        '',
        `**AI 草稿** (${qa.aiModel}):`,
        '```',
        qa.aiDraft,
        '```',
        '',
        '**最终版本**:',
        '```',
        qa.finalValue,
        '```',
        '',
        `**修改幅度**: \`${qa.userAction}\` — ${USER_ACTION_LABELS[qa.userAction]}`,
        '',
        qa.ragReferences.chunkIds.length
          ? `**RAG 参考**: ${qa.ragReferences.chunkIds.length} 个片段（相似度 ${qa.ragReferences.similarities.map((s) => s.toFixed(2)).join(', ')}）`
          : '**RAG 参考**: 无（首次类似问题）',
        '',
        '**用于训练（RAG 召回）**: 是',
        '',
        '---',
        '',
      ].join('\n');
    })
    .join('\n');

  const summary = buildSummary(qaRecord);

  return frontmatter + header + eventBlock + '## Q&A 全记录\n\n' + qaBlocks + summary;
}

function buildSummary(qaRecord: QARecord): string {
  const total = qaRecord.qaPairs.length || 1;
  const acceptanceRate = ((qaRecord.stats.accepted + qaRecord.stats.edited_minor) / total) * 100;

  return [
    '## 本次报名学习摘要',
    '',
    `- 总字段数: ${total}`,
    `- 直接采纳 + 微改: ${qaRecord.stats.accepted + qaRecord.stats.edited_minor} / ${total} (${acceptanceRate.toFixed(0)}%)`,
    `- 重写比例: ${(qaRecord.stats.rewritten / total * 100).toFixed(0)}%`,
    '',
    qaRecord.stats.rewritten / total > 0.3
      ? '> ⚠️ 这次重写比例偏高（>30%），AI 还在学习你的偏好。'
      : '> ✅ 这次大部分草稿都可用，经验库正在收敛。',
    '',
  ].join('\n');
}

function escapeYaml(s: string): string {
  // YAML strings with special chars get quoted.
  if (/[:#\n"]/.test(s)) return JSON.stringify(s);
  return s;
}

/** Slugify a string for use in filenames. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}

export function buildFilename(projectName: string, eventName: string, date: Date = new Date()): string {
  const dateStr = date.toISOString().slice(0, 10);
  return `${slugify(projectName)}-${slugify(eventName)}-${dateStr}.md`;
}
