// How hard a board should be for the task the agent is working on. Pure, no DOM.
//
// Two signals feed it:
//   1. Before the turn: an estimate of how long the agent will work, from the prompt and from how
//      long this user's turns usually run.
//   2. During the turn: what the agent has really done so far (elapsed time, tool calls, subagents).
// The larger of the two picks the level. `secs` is roughly how long a level takes to clear.

export const LEVELS = [
  { n: 1, size: 6, maxLen: 3, secs: 15, name: 'Blink' },
  { n: 2, size: 9, maxLen: 4, secs: 35, name: 'Errand' },
  { n: 3, size: 13, maxLen: 5, secs: 55, name: 'Task' },
  { n: 4, size: 18, maxLen: 6, secs: 90, name: 'Project' },
  { n: 5, size: 24, maxLen: 7, secs: 150, name: 'Deep work' },
  { n: 6, size: 32, maxLen: 8, secs: 240, name: 'Marathon' },
  { n: 7, size: 40, maxLen: 9, secs: 360, name: 'Odyssey' }
];
export const MAX_LEVEL = LEVELS.length;
export const level = n => LEVELS[Math.max(1, Math.min(MAX_LEVEL, Math.round(n))) - 1];

// The biggest level a player could finish in the time the agent is expected to take.
export function levelForSeconds(seconds) {
  let pick = 1;
  for (const l of LEVELS) if (l.secs <= seconds) pick = l.n;
  return pick;
}

const HEAVY = /\b(refactor|implement|build|create|migrate|audit|research|investigate|analy[sz]e|review|debug|deploy|test|rewrite|generate|design|scrape|compare|benchmark|optimi[sz]e|install|convert|translate|summari[sz]e|plan|every|entire|comprehensive|thorough|deep|full|all)\b/gi;
const LIGHT = /^\s*(hi|hello|hey|thanks|thank you|ok|okay|yes|no|yep|nope|cool|great|nice|continue|go on|go ahead)\b[\s.!?]*$/i;

export const median = list => {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Expected working time in seconds for a prompt, given recent turn durations (seconds). */
export function estimateSeconds({ text = '', attachments = 0, history = [] } = {}) {
  const base = history.length >= 3 ? Math.max(12, median(history)) : 45;
  const words = (text.trim().match(/\S+/g) || []).length;
  if (LIGHT.test(text)) return Math.max(8, base * 0.3);
  // No prompt seen (a turn started elsewhere): fall back to the user's typical turn.
  let factor = !words ? 1 : words < 6 ? 0.6 : words < 25 ? 1 : words < 80 ? 1.5 : words < 250 ? 2.2 : 3;
  const heavy = new Set((text.match(HEAVY) || []).map(s => s.toLowerCase())).size;
  factor += Math.min(6, heavy) * 0.35;
  factor += Math.min(3, attachments) * 0.3;
  if (/\?\s*$/.test(text) && words < 15 && !heavy) factor *= 0.6;
  return Math.max(8, Math.min(1800, base * factor));
}

/** What the turn has shown so far, as seconds of expected total work. */
export const heatSeconds = ({ elapsed = 0, tools = 0, subagents = 0 } = {}) => elapsed * 1.25 + tools * 6 + subagents * 40;

/** Level for the next board dealt during a task. */
export const levelForTask = task => levelForSeconds(Math.max(task.estimate || 0, heatSeconds(task)));

const SHAPE_POOL = ['rect', 'disc', 'diamond', 'ring', 'cross', 'hourglass', 'heart', 'wing', 'letter'];

/** Concrete generator settings for a level, fitted to the viewport's aspect ratio. */
export function boardSpec(n, { aspect = 1, seed = 1 } = {}) {
  const l = level(n), a = Math.max(0.6, Math.min(1.7, aspect || 1));
  const w = Math.max(4, Math.round(l.size * Math.sqrt(a))), h = Math.max(4, Math.round(l.size / Math.sqrt(a)));
  // Small boards stay rectangular: a silhouette needs room to read.
  const shape = l.n < 3 ? 'rect' : SHAPE_POOL[(seed >>> 3) % SHAPE_POOL.length];
  return { w, h, shape, maxLen: l.maxLen, straight: 0.5 + ((seed >>> 7) % 20) / 100, seed };
}
