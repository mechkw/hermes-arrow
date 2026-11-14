// Lives, points and streaks. Pure, no DOM.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Harder boards forgive more: 2 lives at the bottom, 5 at the top. */
export const livesFor = n => clamp(2 + Math.floor((n - 1) / 2), 2, 5);

export const STREAK_IDLE_MS = 36 * 60 * 60 * 1000;

/** The streak as it stands right now: gone after 36 hours without play. */
export const liveStreak = (stats, now = Date.now()) =>
  stats?.lastPlay && now - stats.lastPlay > STREAK_IDLE_MS ? 0 : Math.max(0, stats?.streak || 0);

/**
 * Points for a cleared board. Four things multiply a base of 10 per arrow:
 *   difficulty  +25% per level above 1
 *   time        par is 2 s per arrow; twice as fast doubles it, slower than twice par halves it
 *   lives       +10% per life still held
 *   streak      +10% per consecutive win before this one, capped at +100%
 */
export function score({ level = 1, arrows = 0, seconds = 0, lives = 0, streak = 1 }) {
  const base = arrows * 10;
  const difficulty = 1 + (level - 1) * 0.25;
  const time = clamp((arrows * 2) / Math.max(1, seconds), 0.5, 2);
  const life = 1 + 0.1 * Math.max(0, lives);
  const run = 1 + 0.1 * clamp(streak - 1, 0, 10);
  return { points: Math.round(base * difficulty * time * life * run), base, difficulty, time, life, run };
}

/** Fold a finished board into the saved stats. Returns new stats; a win also returns its score. */
export function settle(stats, outcome, now = Date.now()) {
  const next = { boards: 0, arrows: 0, points: 0, best: 0, bestStreak: 0, ...stats, streak: liveStreak(stats, now), lastPlay: now };
  if (!outcome.won) return { stats: { ...next, streak: 0 }, result: null, lost: next.streak };
  next.streak += 1;
  const result = score({ ...outcome, streak: next.streak });
  next.boards += 1; next.points += result.points;
  next.best = Math.max(next.best, result.points); next.bestStreak = Math.max(next.bestStreak, next.streak);
  return { stats: next, result: { ...result, streak: next.streak }, lost: 0 };
}
