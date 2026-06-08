// FieldExplainer — "why was this field scanned?" debugger / trust-builder.
//
// Each DetectedField carries a `provenance` blob (see lib/db/types.ts)
// describing exactly which DOM element it came from, which heuristic matched
// the label, the visibility state, etc. Showing this in a collapsible panel
// lets users debug "why is this field here / why is that field missing"
// without me having to remote-debug their browser.
//
// Also serves a trust function: when the user sees the scanner can explain
// itself, they trust it more.

import { useState } from 'react';
import { Sparkles, CheckCircle2 } from 'lucide-react';
import type { DetectedFieldProvenance } from '@/lib/db/types';

interface FieldExplainerProps {
  provenance: DetectedFieldProvenance | undefined;
  /** Compact mode — single line summary. */
  compact?: boolean;
}

export function FieldExplainer({ provenance, compact = false }: FieldExplainerProps) {
  const [open, setOpen] = useState(false);
  if (!provenance) return null;

  // Quick summary visible before opening the panel.
  const summary = `${sourceLabel(provenance.source)} · 标签来自 ${labelSourceLabel(provenance.labelSource)}${provenance.maxLength ? ` · 限 ${provenance.maxLength.value} 字` : ''}`;

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1">
        <SemanticSourceBadge source={provenance.source} />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          title={summary}
        >
          ⓘ 来源
        </button>
      </span>
    );
  }

  return (
    <div className="text-[11px] text-muted-foreground">
      <SemanticSourceBadge source={provenance.source} />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 hover:text-foreground"
        aria-expanded={open}
      >
        <span>ⓘ {open ? '收起' : '为什么扫到这个字段？'}</span>
      </button>
      {open && (
        <div className="mt-1 ml-2 pl-2 border-l-2 border-border space-y-0.5 font-mono text-[10px]">
          <div>
            <span className="text-muted-foreground/70">来源：</span>
            {sourceLabel(provenance.source)}
          </div>
          <div className="break-all">
            <span className="text-muted-foreground/70">selector：</span>
            <code>{provenance.selector}</code>
          </div>
          <div>
            <span className="text-muted-foreground/70">可见性：</span>
            {visibilityLabel(provenance.visibilityState)}
          </div>
          <div>
            <span className="text-muted-foreground/70">字段名来源：</span>
            {labelSourceLabel(provenance.labelSource)}（{provenance.labelConfidence}）
          </div>
          {provenance.maxLength && (
            <div>
              <span className="text-muted-foreground/70">字数限制：</span>
              {provenance.maxLength.value} 字
              <span className="text-muted-foreground/50 ml-1">
                （匹配 <code>{provenance.maxLength.matchedPattern}</code>）
              </span>
            </div>
          )}
          {provenance.helperText && (
            <div className="break-words">
              <span className="text-muted-foreground/70">提示文本：</span>"
              {provenance.helperText.value}"
              <span className="text-muted-foreground/50 ml-1">（{provenance.helperText.source}）</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * V0.3.0: a small inline badge showing the field came from the LLM semantic pass
 * (Sparkles) or from heuristic + LLM consensus (CheckCircle2). Icons are lucide-react
 * (never emoji — durable rule #2). Renders nothing for the original heuristic sources.
 */
function SemanticSourceBadge({ source }: { source: DetectedFieldProvenance['source'] }) {
  if (source === 'llm-semantic') {
    return (
      <span className="inline-flex items-center gap-0.5 mr-1.5 text-violet-600" title="由 LLM 语义识别">
        <Sparkles size={12} aria-hidden /> LLM 识别
      </span>
    );
  }
  if (source === 'heuristic+llm') {
    return (
      <span className="inline-flex items-center gap-0.5 mr-1.5 text-green-600" title="启发式与 LLM 都识别到（一致）">
        <CheckCircle2 size={12} aria-hidden /> 启发式+LLM 一致
      </span>
    );
  }
  return null;
}

function sourceLabel(source: DetectedFieldProvenance['source']): string {
  switch (source) {
    case 'html-input':
      return 'HTML 表单元素';
    case 'aria-group':
      return 'ARIA 单选/复选组';
    case 'shadow-dom':
      return 'Shadow DOM（Web Component）';
    case 'drop-zone':
      return '文件拖拽区';
    case 'llm-semantic':
      return 'LLM 语义识别';
    case 'heuristic+llm':
      return '启发式 + LLM 一致';
    default:
      return source;
  }
}

function labelSourceLabel(source: DetectedFieldProvenance['labelSource']): string {
  switch (source) {
    case 'aria-label':
      return 'aria-label';
    case 'aria-labelledby':
      return 'aria-labelledby';
    case 'parent-heading':
      return '父级标题';
    case 'placeholder':
      return 'placeholder';
    case 'inferred':
      return 'AI 推断';
    case 'label-tag':
      return '<label> 标签';
    case 'sibling-text':
      return '相邻文本';
    case 'llm-semantic':
      return 'LLM 命名';
    default:
      return source;
  }
}

function visibilityLabel(state: DetectedFieldProvenance['visibilityState']): string {
  switch (state) {
    case 'visible':
      return '可见';
    case 'layout-zero-but-include':
      return '布局 0×0（仍纳入）';
    case 'hidden-skipped':
      return '已跳过';
    default:
      return state;
  }
}
