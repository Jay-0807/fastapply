// V0.4.0 knowledge graph — event similarity.
//
// The core of "调取类似赛事的历史答案": given the event the user is applying to
// RIGHT NOW, score every PAST event by how similar it is (type / organizer /
// location / topic), so the retriever can surface the answers given at the most
// similar past events first — instead of flat keyword overlap that ignores
// which competition a chunk came from.
//
// Pure functions only (no Dexie import) so the schema migration can reuse the
// derivers without a circular runtime dependency.

import type { EventContext, EventType } from '@/lib/db/types';

// ---------------------------------------------------------------------------
// Derivation — fill eventType / topicTags from the free-text fields the user
// (or the page extractor) already provides. Deterministic + stable: re-deriving
// an old event yields the same value, so it's safe to bake into the migration.
// ---------------------------------------------------------------------------

const EVENT_TYPE_RULES: { type: EventType; re: RegExp }[] = [
  { type: 'hackathon', re: /黑客松|hack[\s-]?a?thon|hackday|编程马拉松/i },
  { type: 'accelerator', re: /加速器|孵化器|incubat|accelerat/i },
  { type: 'policy', re: /政策|申报|专项|政府|高新|资质认定|立项/i },
  { type: 'roadshow', re: /路演|road\s?show|demo\s?day|展示日/i },
  { type: 'course', re: /训练营|课程|workshop|bootcamp|招生|报名学习/i },
  // 'venture' is broad (创投/创业大赛/pitch) — keep last so the more specific
  // categories above win first.
  { type: 'venture', re: /创投|创业|创新大赛|创赛|投融资|融资|pitch|startup|venture|competition|大赛/i },
];

/**
 * Best-effort coarse category from an event's name / theme / organizer.
 * Returns 'other' when nothing matches (never throws, never blocks retrieval).
 */
export function deriveEventType(e: Pick<EventContext, 'name' | 'theme' | 'organizer'>): EventType {
  const hay = `${e.name ?? ''} ${e.theme ?? ''} ${e.organizer ?? ''}`;
  for (const rule of EVENT_TYPE_RULES) {
    if (rule.re.test(hay)) return rule.type;
  }
  return 'other';
}

/** Stop tokens that carry no topical signal (drop from topic tags). */
const TOPIC_STOPWORDS = new Set([
  '大赛', '比赛', '报名', '活动', '项目', '创业', '创新', '征集', '招募', '挑战赛', '决赛', '初赛',
  'the', 'and', 'for', 'of', 'a', 'an', 'to', 'in', 'on', '2024', '2025', '2026', '2027',
]);

/**
 * Derive topic tags from theme + name. CJK strings are split per character then
 * we keep the multi-char raw tokens too; latin words are lowercased. Stopwords
 * dropped, deduped, capped. These are matching hints, not authoritative data.
 */
export function deriveTopicTags(e: Pick<EventContext, 'name' | 'theme'>): string[] {
  const raw = `${e.theme ?? ''} ${e.name ?? ''}`;
  const tags = new Set<string>();
  for (const tok of raw.split(/[\s,.;:!?()\[\]{}<>'"，。；：！？（）【】「」、\-_/\\]+/)) {
    const t = tok.trim().toLowerCase();
    if (!t || t.length < 2) continue;
    if (TOPIC_STOPWORDS.has(t)) continue;
    tags.add(t);
    if (tags.size >= 12) break;
  }
  return [...tags];
}

// ---------------------------------------------------------------------------
// Similarity scoring
// ---------------------------------------------------------------------------

function normalize(s: string | undefined | null): string {
  return (s ?? '').toLowerCase().replace(/[\s,.;:!?()\[\]{}<>'"，。；：！？（）【】「」、\-_/\\]+/g, '');
}

/** Token set for overlap scoring: CJK per-char + latin words. */
function tokenSet(s: string | undefined | null): Set<string> {
  const out = new Set<string>();
  for (const w of (s ?? '').toLowerCase().split(/[\s,.;:!?()\[\]{}<>'"，。；：！？（）【】「」、\-_/\\]+/)) {
    if (!w) continue;
    if (/^[一-鿿]+$/.test(w)) {
      for (const ch of w) out.add(ch);
    } else {
      out.add(w);
    }
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Component weights. eventType + topic dominate (they're what makes an event
 * "the same kind of thing"); organizer + location are secondary signals.
 * Sum of weights = 1, so the score is normalized to [0, 1].
 */
export const SIMILARITY_WEIGHTS = {
  type: 0.35,
  topic: 0.3,
  organizer: 0.2,
  location: 0.15,
} as const;

export interface EventSimilarityBreakdown {
  score: number;
  type: number;
  topic: number;
  organizer: number;
  location: number;
}

/**
 * Score how similar a PAST event is to the CURRENT event, in [0, 1].
 * Robust to missing fields (a missing component contributes 0, never NaN).
 */
export function scoreEventSimilarity(current: EventContext, past: EventContext): EventSimilarityBreakdown {
  // Type: only a confident, non-'other' match on both sides counts.
  const curType = current.eventType ?? deriveEventType(current);
  const pastType = past.eventType ?? deriveEventType(past);
  const typeScore = curType !== 'other' && curType === pastType ? 1 : 0;

  // Topic: jaccard over (topicTags ∪ theme tokens).
  const curTopics = new Set<string>([...(current.topicTags ?? deriveTopicTags(current)), ...tokenSet(current.theme)]);
  const pastTopics = new Set<string>([...(past.topicTags ?? deriveTopicTags(past)), ...tokenSet(past.theme)]);
  const topicScore = jaccard(curTopics, pastTopics);

  // Organizer: exact-normalized match → 1, else token overlap.
  const organizerScore =
    normalize(current.organizer) && normalize(current.organizer) === normalize(past.organizer)
      ? 1
      : jaccard(tokenSet(current.organizer), tokenSet(past.organizer));

  // Location: same idea.
  const locationScore =
    normalize(current.location) && normalize(current.location) === normalize(past.location)
      ? 1
      : jaccard(tokenSet(current.location), tokenSet(past.location));

  const score =
    SIMILARITY_WEIGHTS.type * typeScore +
    SIMILARITY_WEIGHTS.topic * topicScore +
    SIMILARITY_WEIGHTS.organizer * organizerScore +
    SIMILARITY_WEIGHTS.location * locationScore;

  return { score, type: typeScore, topic: topicScore, organizer: organizerScore, location: locationScore };
}
