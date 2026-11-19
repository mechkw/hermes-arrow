// Number and time formats shared by every game. Pure, no DOM.

export const fmt = n => Math.round(n).toLocaleString('en-US');
export const clock = seconds => {
  const s = Math.max(0, Math.floor(seconds)), m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
};
/** One decimal under 10, whole numbers above: 8.4, 62. */
export const rate = v => (v >= 9.95 ? String(Math.round(v)) : v.toFixed(1));
/** A rate too small to print as anything but 0.0 counts as no rate. */
export const live = v => v >= 0.05;
