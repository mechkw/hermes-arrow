// The kit: the parts every game builds its bar, cards and settings from, so all games look like one
// console. A cartridge receives this as `api.kit` and never styles these things itself.
// skills/hermes-arrow-games/references/cartridge-guide.md lists every part with its props.

import { useEffect, useState } from 'react';
import { Button, host, Tip } from '@hermes/plugin-sdk';

import { clock, fmt, live, rate } from './kit-format.js';
export { clock, fmt, live, rate };

// The agent's own rolling tokens per second for the chat in view, when the Desktop reports it.
// Read on our own clock, never subscribed: nothing of ours runs inside the host's writes.
export const agentRate = () => { try { const v = Number(host.state.focusedUsage?.get?.()?.avg_tps); return v > 0 ? v : 0; } catch { return 0; } };

export const S = {
  page: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, outline: 'none', userSelect: 'none', WebkitUserSelect: 'none', color: 'var(--ui-text-primary)' },
  bar: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 12px', padding: '8px 12px', borderBottom: '1px solid var(--ui-stroke-tertiary)', fontSize: '0.8125rem', lineHeight: 1.2 },
  range: { width: '100%', height: 16, margin: 0, accentColor: 'var(--ui-accent)', cursor: 'pointer' },
  settings: { width: 330, padding: 12, display: 'grid', gap: 12, fontSize: '0.8125rem', color: 'var(--ui-text-primary)' },
  setting: { display: 'grid', gridTemplateColumns: '88px 1fr 84px', alignItems: 'center', gap: 8 },
  hidden: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' },
  grow: { flex: '1 1 0', minWidth: 0 },
  muted: { color: 'var(--ui-text-tertiary)' },
  faint: { color: 'var(--ui-text-quaternary)', fontSize: '0.6875rem' },
  num: { fontVariantNumeric: 'tabular-nums' },
  chip: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 3, fontSize: '0.6875rem', fontWeight: 600, background: 'var(--ui-bg-quaternary)' },
  stage: { position: 'relative', flex: '1 1 0', minHeight: 0, overflow: 'hidden', touchAction: 'none' },
  fill: { position: 'absolute', inset: 0, display: 'block' },
  veil: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, pointerEvents: 'none' },
  card: { pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', textAlign: 'center', padding: '18px 22px', minWidth: 220, maxWidth: 320,
    borderRadius: 5, background: 'var(--ui-bg-elevated)', border: '1px solid var(--ui-stroke-secondary)', boxShadow: '0 8px 30px color-mix(in srgb, var(--ui-base, transparent) 55%, transparent)' },
  title: { fontSize: '1.25rem', fontWeight: 650, letterSpacing: '-0.01em' },
  row: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'center' },
  done: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', fontSize: '0.8125rem', fontWeight: 600,
    background: 'color-mix(in srgb, var(--ui-green) 20%, transparent)', borderLeft: '3px solid var(--ui-green)' }
};
const TONES = { accent: 'var(--ui-accent)', yellow: 'var(--ui-yellow)', red: 'var(--ui-red)', green: 'var(--ui-green)', muted: 'var(--ui-text-tertiary)' };
const tone = name => TONES[name] || undefined;
const tipped = (tip, node) => (tip ? <Tip label={tip}>{node}</Tip> : node);
/** Re-render the calling component every `ms` milliseconds; 0 stops it. */
export function useTick(ms) {
  const [, tick] = useState(0);
  useEffect(() => { if (!ms) return; const id = window.setInterval(() => tick(n => n + 1), ms); return () => window.clearInterval(id); }, [ms]);
}

// ---- bar parts ------------------------------------------------------------------------------

/** − label +. `compact` is the bar form (the label is a chip); the roomy form goes on cards. */
export function Stepper({ value, min = 1, max, label, tip, compact = false, noun = 'level', onChange }) {
  const variant = compact ? 'ghost' : 'outline';
  const text = <span style={{ minWidth: compact ? 0 : 96, ...S.num, ...(compact ? { ...S.chip, padding: '2px 6px' } : null) }}>{label ?? value}</span>;
  return (
    <span style={{ ...S.row, gap: compact ? 2 : 6, flexWrap: 'nowrap' }}>
      <Button size="sm" variant={variant} aria-label={`Lower ${noun}`} disabled={value <= min} onClick={() => onChange(value - 1)}>−</Button>
      {compact ? tipped(tip, text) : text}
      <Button size="sm" variant={variant} aria-label={`Higher ${noun}`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</Button>
    </span>
  );
}

/** A small labelled chip: a mode, a multiplier, a streak. `color` is a tone name. */
export const Tag = ({ tip, color, children }) => tipped(tip, <span style={{ ...S.chip, color: tone(color) }}>{children}</span>);

/** A bold number and a quiet word: "12 left". */
export const Count = ({ value, label, tip }) => tipped(tip, <span style={{ ...S.num, fontWeight: 600 }}>{value}{label && <span style={{ ...S.muted, fontWeight: 400 }}> {label}</span>}</span>);

/** A row of squares, filled for what is held. The last one turns red. */
export function Pips({ value, max, noun = 'lives', tip }) {
  const low = value <= 1;
  return tipped(tip ?? `${value} of ${max} ${noun}`,
    <span style={{ display: 'inline-flex', gap: 3 }} aria-label={`${value} of ${max} ${noun}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} style={{ width: 8, height: 8, borderRadius: 2, boxSizing: 'border-box',
          background: i < value ? (low ? 'var(--ui-red)' : 'var(--ui-accent)') : 'transparent',
          border: i < value ? 'none' : '1px solid var(--ui-stroke-secondary)' }} />
      ))}
    </span>);
}

/** m:ss. `seconds` is a function the clock calls itself while `running`; `started` dims it before play. */
export function Clock({ seconds, running = false, started = true, label = 'Board time' }) {
  useTick(running ? 250 : 0);
  return <span style={{ ...S.num, color: started ? 'var(--ui-text-primary)' : 'var(--ui-text-quaternary)' }} aria-label={label}>{clock(started ? seconds() : 0)}</span>;
}

// One side of the race: a brain in the accent colour for the player, a robot in plain text colour for the agent.
// The brain is a top view: two scalloped halves either side of the centre line.
const LOBE = 'M8 3.5A1.9 1.9 0 0 0 4.4 3.5A2.2 2.2 0 0 0 2.5 6.9A2.3 2.3 0 0 0 3 10.9A2.2 2.2 0 0 0 5.9 13.4A1.5 1.5 0 0 0 8 12.6';
const WHO = {
  you: { color: 'var(--ui-accent)', label: 'You', icon: <><path d="M8 3.4v9.4" /><path d={LOBE} /><path d={LOBE} transform="translate(16 0) scale(-1 1)" /></> },
  agent: { color: 'var(--ui-text-primary)', label: 'Hermes', icon: <><rect x="2.75" y="5.5" width="10.5" height="7.75" rx="2" /><path d="M8 5.5V3" /><circle cx="8" cy="2.25" r="0.9" /><path d="M6 8.75v1.5M10 8.75v1.5M1 8.5v2.5M15 8.5v2.5" /></> }
};
/** A rate behind its icon: `who` is 'you' or 'agent'. Shows "–" when there is no rate. */
export function Rate({ who, value, unit = 't/s', spoken = 'tokens a second' }) {
  const { color, label, icon } = WHO[who], on = live(value);
  return (
    <span role="img" style={{ ...S.num, display: 'inline-flex', alignItems: 'center', gap: 4, color: on ? color : 'var(--ui-text-quaternary)', whiteSpace: 'nowrap' }} aria-label={`${label}: ${on ? `${rate(value)} ${spoken}` : 'no pace yet'}`} data-speed={who}>
      <svg width="1.2em" height="1.2em" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
      <span style={{ fontWeight: 600, minWidth: '2.5ch', textAlign: 'right' }}>{on ? rate(value) : '–'}</span><span style={{ opacity: 0.7 }}>{unit}</span>
    </span>
  );
}

/**
 * The player's rate beside the agent's. `value` is a function, called on the part's own timer. Both
 * slots are always drawn so the bar does not shift when the agent starts or stops.
 */
export function Pace({ value, running = false, tip }) {
  useTick(running ? 500 : 1000);
  return tipped(tip,
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <Rate who="you" value={value()} />
      <Rate who="agent" value={agentRate()} />
    </span>);
}

/** "×4 streak", shown from 2 up. */
export const Streak = ({ run, tip }) => (run < 2 ? null : <Tag tip={tip} color="yellow">×{run} streak</Tag>);

/** A bar button. `cost` is a small yellow note after the label ("−5%"). */
export function Action({ tip, label, cost, variant = 'ghost', children, ...rest }) {
  return tipped(tip, <Button size="sm" variant={variant} aria-label={label} {...rest}>{children}{cost ? <span style={{ ...S.num, marginLeft: 5, color: 'var(--ui-yellow)' }}>{cost}</span> : null}</Button>);
}

// ---- cards over the board ---------------------------------------------------------------------

/** A card centred over the stage: the end of a board, a pause, a message. `tone="red"` for a loss. */
export function Card({ label, tone: t, children }) {
  return <div style={S.veil}><div style={{ ...S.card, ...(t ? { borderColor: tone(t) } : null) }} role="dialog" aria-label={label}>{children}</div></div>;
}
/** The small capitals line at the top of a card. */
export const Eyebrow = ({ children }) => <div style={{ ...S.faint, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{children}</div>;
/** The card's headline. `big` is the points size. */
export const Headline = ({ big = false, color, children }) => <div style={{ ...S.title, ...S.num, ...(big ? { fontSize: '1.75rem', lineHeight: 1 } : null), color: tone(color) }}>{children}</div>;
/** A line of card text: `quiet` is the secondary grey, `faint` the small print. */
export const Line = ({ faint = false, children }) => <div style={{ ...(faint ? S.faint : S.muted), ...S.num }}>{children}</div>;
/** The player's rate and, when there is one, the agent's, side by side on a card. */
export function Rates({ you, agent }) {
  if (!live(you)) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 12, fontSize: '0.9375rem' }} data-pace>
      <Rate who="you" value={you} />
      {live(agent) && <Rate who="agent" value={agent} />}
    </div>
  );
}
/** Buttons side by side. */
export const Row = ({ children }) => <div style={S.row}>{children}</div>;

// ---- settings rows ------------------------------------------------------------------------------

/** One settings row: a name, a control, and the current value in words. */
export const Setting = ({ label, value, children }) => (
  <label style={S.setting}><span>{label}</span>{children}<span style={{ ...S.num, ...S.muted, textAlign: 'right' }}>{value}</span></label>
);
export const Range = ({ label, style, ...rest }) => <input type="range" aria-label={label} {...rest} style={{ ...S.range, ...style }} />;
/** The small print under a setting. */
export const SettingNote = ({ children }) => <div style={{ ...S.faint, marginTop: -6 }}>{children}</div>;

/**
 * A background for a game's own surfaces that thins with the player's Transparency setting, so the
 * chat stays readable behind the game. `soft` thins half as far, for pieces that must always read.
 * Solid on the full page.
 */
export const surface = (color = 'var(--ui-bg-quaternary)', soft = false) =>
  `color-mix(in srgb, ${color} var(${soft ? '--game-solid-soft' : '--game-solid'}, 100%), transparent)`;

export const kit = {
  S, fmt, clock, rate, live, agentRate, useTick, Button, Tip, surface,
  Stepper, Tag, Count, Pips, Clock, Rate, Pace, Streak, Action,
  Card, Eyebrow, Headline, Line, Rates, Row,
  Setting, Range, SettingNote
};
