// Arrow's sounds: six recorded clips and the cues that replay them. To re-voice the game, edit `cues`.

import soft from '../../../assets/sfx/soft.mp3';         // steady low chime (C5)
import tick from '../../../assets/sfx/tick.mp3';         // steady mid chime (G5)
import ding from '../../../assets/sfx/ding.mp3';         // bright bell (C6)
import rise from '../../../assets/sfx/rise.mp3';         // three notes climbing
import fall from '../../../assets/sfx/fall.mp3';         // three notes dropping onto a thump
import flourish from '../../../assets/sfx/flourish.mp3'; // quick run up, then a chord

const semis = n => 2 ** (n / 12);
// Arrows cleared in quick succession climb this scale; a pause starts it over.
const CLIMB = [0, 2, 4, 7, 9, 12, 14, 16];

export default {
  clips: { soft, tick, ding, rise, fall, flourish },
  combo: { move: 1400 },
  cues: {
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
    streak: () => ({ clip: 'rise', rate: 1.5, dur: 0.7, gain: 0.4 })
  },
  synth: {
    move: (note, o) => note({ freq: 430 + 260 * o.k, to: 760 + 420 * o.k, dur: 0.1, gain: 0.11 }),
    blocked: note => { note({ freq: 150, to: 82, dur: 0.17, type: 'square', gain: 0.1 }); note({ freq: 96, to: 60, dur: 0.2, type: 'sawtooth', gain: 0.07 }); },
    win: note => [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => note({ at: i * 0.095, freq, dur: i === 3 ? 0.42 : 0.16 })),
    loss: note => [392, 311.13, 233.08].forEach((freq, i) => note({ at: i * 0.17, freq, to: freq * 0.94, dur: i === 2 ? 0.5 : 0.22, type: 'sawtooth', gain: 0.08 }))
  }
};
