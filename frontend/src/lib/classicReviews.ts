import type { RoomAnalysis } from '../types/game';

const STORAGE_KEY = 'money-game-classic-reviews-v1';
const MAX_SAVED_REVIEWS = 12;

export interface SavedClassicReview {
  id: string;
  sourceKey: string;
  title: string;
  savedAt: string;
  analysis: RoomAnalysis;
}

function getSourceKey(analysis: RoomAnalysis): string {
  const results = analysis.players
    .map((player) => `${player.playerId}:${Math.round(player.score.total)}`)
    .join('|');
  return `${analysis.roomId}:${analysis.currentAge}:${results}`;
}

function isSavedClassicReview(value: unknown): value is SavedClassicReview {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SavedClassicReview>;
  return Boolean(
    candidate.id &&
    candidate.sourceKey &&
    candidate.title &&
    candidate.savedAt &&
    candidate.analysis &&
    typeof candidate.analysis.roomId === 'string' &&
    Array.isArray(candidate.analysis.players),
  );
}

export function readClassicReviews(): SavedClassicReview[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSavedClassicReview) : [];
  } catch {
    return [];
  }
}

export function saveClassicReview(analysis: RoomAnalysis): SavedClassicReview[] {
  const savedAt = new Date();
  const sourceKey = getSourceKey(analysis);
  const current = readClassicReviews().filter((review) => review.sourceKey !== sourceKey);
  const review: SavedClassicReview = {
    id: globalThis.crypto?.randomUUID?.() ?? `${savedAt.getTime()}-${analysis.roomId}`,
    sourceKey,
    title: `房間 ${analysis.roomId} · ${savedAt.toLocaleDateString('zh-TW')}`,
    savedAt: savedAt.toISOString(),
    analysis,
  };
  const next = [review, ...current].slice(0, MAX_SAVED_REVIEWS);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function deleteClassicReview(reviewId: string): SavedClassicReview[] {
  const next = readClassicReviews().filter((review) => review.id !== reviewId);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
