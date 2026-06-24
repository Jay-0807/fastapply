import { describe, expect, it } from 'vitest';
import { deriveEventType, deriveTopicTags, scoreEventSimilarity } from './event-similarity';
import type { EventContext } from '@/lib/db/types';

function evt(p: Partial<EventContext>): EventContext {
  return {
    id: 'x', name: '', theme: '', organizer: '', location: '', url: '',
    deadline: null, extraNotes: '', pageMetaJson: {}, createdAt: 0, ...p,
  };
}

describe('deriveEventType', () => {
  it('classifies common Chinese event families', () => {
    expect(deriveEventType({ name: '2026 黑客松', theme: '', organizer: '' })).toBe('hackathon');
    expect(deriveEventType({ name: '', theme: '', organizer: '某加速器' })).toBe('accelerator');
    expect(deriveEventType({ name: '高新技术专项申报', theme: '', organizer: '' })).toBe('policy');
    expect(deriveEventType({ name: '路演日', theme: '', organizer: '' })).toBe('roadshow');
    expect(deriveEventType({ name: '创新创业大赛', theme: '', organizer: '' })).toBe('venture');
  });

  it('prefers the more specific category (accelerator over the broad venture rule)', () => {
    // Contains both 创业 (venture) and 孵化器 (accelerator) — accelerator must win.
    expect(deriveEventType({ name: '创业孵化器项目', theme: '', organizer: '' })).toBe('accelerator');
  });

  it('falls back to other when nothing matches', () => {
    expect(deriveEventType({ name: 'Annual Gala', theme: 'networking', organizer: 'Club' })).toBe('other');
  });
});

describe('deriveTopicTags', () => {
  it('extracts deduped topic tokens and drops stopwords', () => {
    const tags = deriveTopicTags({ name: 'AI Agent 创新大赛', theme: 'AI Agent' });
    expect(tags).toContain('ai');
    expect(tags).toContain('agent');
    expect(tags).not.toContain('大赛'); // stopword
  });
});

describe('scoreEventSimilarity', () => {
  const current = evt({ name: 'AI Agent 黑客松', theme: 'AI Agent', organizer: 'MiroMind', location: '上海' });

  it('scores a near-identical event high', () => {
    const past = evt({ name: 'AI Agent Hackathon', theme: 'AI Agent', organizer: 'MiroMind', location: '上海' });
    expect(scoreEventSimilarity(current, past).score).toBeGreaterThan(0.8);
  });

  it('scores an unrelated event low', () => {
    const past = evt({ name: '新能源政策申报', theme: '储能补贴', organizer: '某市政府', location: '深圳' });
    expect(scoreEventSimilarity(current, past).score).toBeLessThan(0.2);
  });

  it('ranks a same-theme event above a different-theme one', () => {
    const sameTheme = evt({ name: 'Agent 创赛', theme: 'AI Agent 智能体', organizer: '别的主办方', location: '北京' });
    const diffTheme = evt({ name: '生物医药大赛', theme: '医疗器械', organizer: '别的主办方', location: '北京' });
    expect(scoreEventSimilarity(current, sameTheme).score).toBeGreaterThan(scoreEventSimilarity(current, diffTheme).score);
  });

  it('never returns NaN when fields are empty', () => {
    const empty = evt({});
    expect(Number.isNaN(scoreEventSimilarity(empty, empty).score)).toBe(false);
  });
});
