// V0.4.0 — QA → RAG corpus seeding rules.
//
// PRIVACY BOUNDARY (Code GAN 2026-06-24): when a personal field is auto-filled
// from a Person profile, its real value (phone / email / ID) lands in the
// QAPair.finalValue. Those values are fine in the QARecord + the locally
// downloaded markdown, but they must NOT enter the retrievable RAG chunk store
// — otherwise they'd be injected as "历史 Q&A" context into EVERY future
// draft-generation prompt for that project, leaking the user's PII to the LLM.
//
// So: personal / OTP / any `noAiFill` answer is NEVER seeded. This mirrors the
// generation-side guard (the draft generator already skips these fields); this
// closes the same hole on the persistence side.

import type { QAPair, EventContext } from '@/lib/db/types';

/**
 * A QA pair is seedable into the RAG corpus UNLESS it carries personal/OTP info.
 * Driven by the same constraints the scanner set (`noAiFill` / `sensitiveKind`),
 * which are persisted on every QAPair.
 */
export function isSeedableQaPair(qa: QAPair): boolean {
  const c = qa.fieldConstraints;
  if (!c) return true;
  if (c.noAiFill) return false;
  if (c.sensitiveKind) return false;
  return true;
}

/**
 * Format a QA pair into the chunk text used for keyword retrieval. Bakes the
 * full event identity (主办方 / 地点 / 主题 / 类型) in so similar-event matching
 * has signal both in the text and (via metadata) in the graph edge.
 */
export function buildQaChunkText(
  qa: QAPair,
  event: Pick<EventContext, 'name' | 'theme' | 'organizer' | 'location' | 'eventType'>,
): string {
  return `Q: ${qa.fieldLabel}\nContext: 赛事=${event.name}, 主题=${event.theme}, 主办方=${event.organizer}, 地点=${event.location}, 类型=${event.eventType ?? '未知'}\nA (最终版本): ${qa.finalValue}`;
}
