import { describe, expect, it } from 'vitest';
import { isSeedableQaPair, buildQaChunkText } from './qa-seed';
import type { QAPair, EventContext, FieldConstraints } from '@/lib/db/types';

function qa(finalValue: string, fieldConstraints: FieldConstraints): QAPair {
  return {
    fieldId: 'f', fieldLabel: '联系电话', fieldType: 'tel', fieldConstraints,
    aiDraft: '', aiModel: '', finalValue, userAction: 'accepted',
    ragReferences: { chunkIds: [], similarities: [] }, generatedAt: 0, retryCount: 0,
  };
}

const event: Pick<EventContext, 'name' | 'theme' | 'organizer' | 'location' | 'eventType'> = {
  name: 'X 大赛', theme: 'AI', organizer: 'Org', location: '上海', eventType: 'venture',
};

describe('isSeedableQaPair — PII never enters the RAG corpus', () => {
  it('seeds normal answers', () => {
    expect(isSeedableQaPair(qa('我们做 AI Agent', { maxLength: 200 }))).toBe(true);
  });

  it('NEVER seeds personal answers (real phone/email/ID would leak into future prompts)', () => {
    expect(isSeedableQaPair(qa('13800000000', { noAiFill: true, sensitiveKind: 'personal' }))).toBe(false);
  });

  it('NEVER seeds OTP answers', () => {
    expect(isSeedableQaPair(qa('123456', { noAiFill: true, sensitiveKind: 'otp' }))).toBe(false);
  });

  it('treats any noAiFill field as non-seedable even without sensitiveKind', () => {
    expect(isSeedableQaPair(qa('secret', { noAiFill: true }))).toBe(false);
  });
});

describe('buildQaChunkText', () => {
  it('bakes the full event identity into the chunk text', () => {
    const text = buildQaChunkText(qa('答案内容', { maxLength: 100 }), event);
    expect(text).toContain('主办方=Org');
    expect(text).toContain('地点=上海');
    expect(text).toContain('类型=venture');
    expect(text).toContain('答案内容');
  });
});
