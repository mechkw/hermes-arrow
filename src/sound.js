// Game sounds. Six recorded clips (assets/sfx, inlined by the build because the Desktop loader only
// resolves code) are replayed at different pitches, lengths and volumes to make every cue below.
// Until the clips have decoded, or if they cannot, a synthesised note stands in.
//
// To re-voice the game, edit CUES: each entry names a clip and how to play it.

import soft from '../assets/sfx/soft.mp3';         // steady low chime (C5)
import tick from '../assets/sfx/tick.mp3';         // steady mid chime (G5)
import ding from '../assets/sfx/ding.mp3';         // bright bell (C6)
import rise from '../assets/sfx/rise.mp3';         // three notes climbing
import fall from '../assets/sfx/fall.mp3';         // three notes dropping onto a thump
import flourish from '../assets/sfx/flourish.mp3'; // quick run up, then a chord

const CLIPS = { soft, tick, ding, rise, fall, flourish };
// Output gain at full volume. The slider is squared, so the default 70% sits near half of this.
const MASTER = 1;
const semis = n => 2 ** (n / 12);
// Arrows cleared in quick succession climb this scale; a pause starts it over.
const CLIMB = [0, 2, 4, 7, 9, 12, 14, 16];
const COMBO_MS = 1400;

// name: o => ({ clip, rate, dur (seconds heard, before the fade), gain, synth (stand-in cue) })
const CUES = {
  // o.k is board progress 0..1, o.step the place in the current run of quick moves.
  move: o => ({ clip: o.step % 3 === 2 ? 'soft' : 'tick', rate: (o.step % 3 === 2 ? 1.5 : 1) * semis(CLIMB[Math.min(o.step, CLIMB.length - 1)] - 3 + 3 * o.k) * (0.985 + 0.03 * o.jitter), dur: 0.34, gain: 0.5, synth: 'move' }),
  blocked: () => ({ clip: 'fall', rate: 1.06, dur: 0.5, gain: 0.55, synth: 'blocked' }),
  lastLife: () => ({ clip: 'fall', rate: 0.8, dur: 0.95, gain: 0.7, synth: 'blocked' }),
  jam: () => ({ clip: 'fall', rate: 0.6, dur: 2, gain: 0.75, synth: 'loss' }),
  win: () => ({ clip: 'flourish', rate: 1, dur: 1.4, gain: 0.75, synth: 'win' }),
  deal: () => ({ clip: 'rise', rate: 1, dur: 0.75, gain: 0.3 }),
  hint: () => ({ clip: 'ding', rate: 1.5, dur: 0.4, gain: 0.3 }),
  previewClear: () => ({ clip: 'soft', rate: 2, dur: 0.16, gain: 0.28 }),
  previewBlocked: () => ({ clip: 'soft', rate: 0.75, dur: 0.24, gain: 0.32 }),
  // o.k is how far in the zoom is, 0 (fit) to 1 (closest).
  zoom: o => ({ clip: 'tick', rate: 0.75 + 0.75 * o.k, dur: 0.09, gain: 0.2 }),
  agentDone: () => ({ clip: 'ding', rate: 1, dur: 1, gain: 0.6 }),
  streak: () => ({ clip: 'rise', rate: 1.5, dur: 0.7, gain: 0.4 })
};
export const CUE_NAMES = Object.keys(CUES);

function bytes(base64) {
  const raw = atob(base64), out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

export function createSound(isOn, volume = () => 0.7) {
  let ctx = null, out = null, lastMove = 0, step = 0;
  const buffers = {}, played = [];

  // Decoding needs no user gesture on an offline context, so the clips are ready before the first tap.
  try {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const decoder = OAC ? new OAC(1, 1, 44100) : null;
    if (decoder) for (const [name, data] of Object.entries(CLIPS)) {
      const done = decoder.decodeAudioData(bytes(data), b => { buffers[name] = b; }, () => {});
      if (done?.catch) done.then(b => { if (b) buffers[name] = b; }).catch(() => {});
    }
  } catch { /* the synth stands in */ }

  const audio = () => {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC(); out = ctx.createGain(); out.connect(ctx.destination);
    }
    const v = Math.max(0, Math.min(1, Number(volume()) || 0));
    out.gain.value = MASTER * v * v;
    return ctx;
  };

  const sample = (ac, { clip, rate = 1, dur = 1, gain = 0.5 }) => {
    const src = ac.createBufferSource(), amp = ac.createGain(), t = ac.currentTime;
    src.buffer = buffers[clip]; src.playbackRate.value = Math.max(0.25, Math.min(4, rate));
    const length = Math.min(dur, src.buffer.duration / src.playbackRate.value), fade = Math.min(0.12, length * 0.5);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.setValueAtTime(gain, t + length - fade);
    amp.gain.linearRampToValueAtTime(0.0001, t + length);
    src.connect(amp).connect(out);
    src.start(t); src.stop(t + length + 0.02);
  };

  // One enveloped oscillator note, optionally gliding to `to` Hz.
  const note = (ac, { at = 0, freq, to, dur, type = 'triangle', gain = 0.14 }) => {
    const t = ac.currentTime + at, osc = ac.createOscillator(), amp = ac.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(out);
    osc.start(t); osc.stop(t + dur + 0.02);
  };
  const synth = {
    move: (ac, o) => note(ac, { freq: 430 + 260 * o.k, to: 760 + 420 * o.k, dur: 0.1, gain: 0.11 }),
    blocked: ac => { note(ac, { freq: 150, to: 82, dur: 0.17, type: 'square', gain: 0.1 }); note(ac, { freq: 96, to: 60, dur: 0.2, type: 'sawtooth', gain: 0.07 }); },
    win: ac => [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => note(ac, { at: i * 0.095, freq, dur: i === 3 ? 0.42 : 0.16 })),
    loss: ac => [392, 311.13, 233.08].forEach((freq, i) => note(ac, { at: i * 0.17, freq, to: freq * 0.94, dur: i === 2 ? 0.5 : 0.22, type: 'sawtooth', gain: 0.08 }))
  };

  const fire = (ac, name, o) => {
    const cue = CUES[name](o);
    if (buffers[cue.clip]) sample(ac, cue); else if (cue.synth) synth[cue.synth](ac, o); else return;
    played.push(name); if (played.length > 200) played.shift();
  };

  return {
    /** Cue names actually sounded, oldest first. For tests. */
    played,
    /** Output gain in use, 0..1. */
    gain: () => out?.gain.value ?? 0,
    ready: () => Object.keys(CLIPS).every(name => buffers[name]),
    play(name, k = 0) {
      if (!isOn() || !CUES[name]) return;
      try {
        const ac = audio();
        if (!ac) return;
        const o = { k: Math.max(0, Math.min(1, Number(k) || 0)), step: 0, jitter: Math.random() };
        if (name === 'move') {
          const t = Date.now();
          step = t - lastMove < COMBO_MS ? step + 1 : 0; lastMove = t; o.step = step;
        }
        if (ac.state === 'running') return fire(ac, name, o);
        // Not unlocked yet. A cue that comes from a tap unlocks it at once; one that does not is dropped
        // rather than left to burst out later.
        const asked = performance.now();
        ac.resume().then(() => { if (performance.now() - asked < 250 && isOn()) fire(ac, name, o); }).catch(() => {});
      } catch { /* sound is optional */ }
    },
    dispose() { try { ctx?.close(); } catch { /* already closed */ } ctx = null; out = null; }
  };
}
