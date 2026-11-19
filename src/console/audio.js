// The console's sound engine. It knows no cue of its own: each game hands it a "voice", a set of
// recorded clips (base64, inlined by the build because the Desktop loader only resolves code) and
// the cues that replay them at different pitches, lengths and volumes. One output, one volume.
// Until a clip has decoded, or if it cannot, the cue's synthesised stand-in plays instead.

function bytes(base64) {
  const raw = atob(base64), out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}
// Output gain at full volume. The slider is squared, so the default 70% sits near half of this.
const MASTER = 1;

export function createAudio(isOn, volume = () => 0.7) {
  let ctx = null, out = null, decoder = null;
  const played = [], voices = [];
  // Decoding needs no user gesture on an offline context, so clips are ready before the first tap.
  try { const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext; decoder = OAC ? new OAC(1, 1, 44100) : null; } catch { /* the synth stands in */ }

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

  const sample = (ac, buffer, { rate = 1, dur = 1, gain = 0.5 }) => {
    const src = ac.createBufferSource(), amp = ac.createGain(), t = ac.currentTime;
    src.buffer = buffer; src.playbackRate.value = Math.max(0.25, Math.min(4, rate));
    const length = Math.min(dur, src.buffer.duration / src.playbackRate.value), fade = Math.min(0.12, length * 0.5);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.setValueAtTime(gain, t + length - fade);
    amp.gain.linearRampToValueAtTime(0.0001, t + length);
    src.connect(amp).connect(out);
    src.start(t); src.stop(t + length + 0.02);
  };

  // One enveloped oscillator note, optionally gliding to `to` Hz. Handed to a voice's stand-ins.
  const note = ac => ({ at = 0, freq, to, dur, type = 'triangle', gain = 0.14 }) => {
    const t = ac.currentTime + at, osc = ac.createOscillator(), amp = ac.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(out);
    osc.start(t); osc.stop(t + dur + 0.02);
  };

  /**
   * Register a set of sounds and get back `play(name, k)`.
   *   clips  { name: base64 audio }
   *   cues   { name: o => ({ clip, rate, dur (seconds heard, before the fade), gain, synth }) }
   *          `o.k` is the 0..1 number passed to play, `o.step` the place in a run of quick repeats
   *          (see `combo`), `o.jitter` a random 0..1.
   *   synth  { name: (note, o) => void }  stand-ins, named by a cue's `synth`
   *   combo  { cueName: ms }  repeats of that cue inside the window count up in `o.step`
   */
  function voice({ clips = {}, cues = {}, synth = {}, combo = {} } = {}) {
    const buffers = {}, runs = {};
    const names = Object.keys(clips);
    if (decoder) for (const name of names) {
      try {
        const done = decoder.decodeAudioData(bytes(clips[name]), b => { buffers[name] = b; }, () => {});
        if (done?.catch) done.then(b => { if (b) buffers[name] = b; }).catch(() => {});
      } catch { /* the synth stands in */ }
    }
    const fire = (ac, name, o) => {
      const cue = cues[name](o);
      if (buffers[cue.clip]) sample(ac, buffers[cue.clip], cue); else if (synth[cue.synth]) synth[cue.synth](note(ac), o); else return;
      played.push(name); if (played.length > 200) played.shift();
    };
    const self = {
      ready: () => names.every(name => buffers[name]),
      play(name, k = 0) {
        if (!isOn() || !cues[name]) return;
        try {
          const ac = audio();
          if (!ac) return;
          const o = { k: Math.max(0, Math.min(1, Number(k) || 0)), step: 0, jitter: Math.random() };
          if (combo[name]) {
            const t = Date.now(), run = runs[name] || { at: 0, step: 0 };
            run.step = t - run.at < combo[name] ? run.step + 1 : 0; run.at = t; runs[name] = run; o.step = run.step;
          }
          if (ac.state === 'running') return fire(ac, name, o);
          // Not unlocked yet. A cue that comes from a tap unlocks it at once; one that does not is dropped
          // rather than left to burst out later.
          const asked = performance.now();
          ac.resume().then(() => { if (performance.now() - asked < 250 && isOn()) fire(ac, name, o); }).catch(() => {});
        } catch { /* sound is optional */ }
      }
    };
    voices.push(self);
    return self;
  }

  return {
    voice,
    /** Cue names actually sounded, oldest first. For tests. */
    played,
    /** Output gain in use, 0..1. */
    gain: () => out?.gain.value ?? 0,
    ready: () => voices.every(v => v.ready()),
    dispose() { try { ctx?.close(); } catch { /* already closed */ } ctx = null; out = null; }
  };
}
