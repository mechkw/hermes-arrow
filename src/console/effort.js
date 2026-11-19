// How much work the agent's current turn amounts to, in seconds. Pure, no DOM, and nothing about any game.
//
// Two signals feed it:
//   1. Before the turn: an estimate of how long the agent will work, from the prompt and from how
//      long this user's turns usually run.
//   2. During the turn: what the agent has really done so far (elapsed time, tool calls, subagents).
// The larger of the two is the task's `seconds`. Each game turns that into a level of its own.

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

/** Expected total work for a turn, in seconds: the estimate, or what it has shown so far if that is more. */
export const workSeconds = (task = {}) => Math.max(task.estimate || 0, heatSeconds(task));
