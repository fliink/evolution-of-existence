'use strict';
/**
 * lib/context.js: the small facts around a piece of writing.
 *
 * Posts may carry these frontmatter keys (the studio fills most of them in):
 *   time: 22:40                 when the writing started, 24h local
 *   place: Seattle              city-level is plenty; it's public
 *   weather: 52°F, light drizzle
 *   listening: Radiohead, In Rainbows
 *   watching: Severance
 *   reading: The Dawn of Everything
 *   mood: curious
 * The moon phase is computed from the post date, so nothing to store.
 */

const CONTEXT_KEYS = ['time', 'place', 'weather', 'listening', 'watching', 'reading', 'mood'];

/** The context keys present in a frontmatter object, trimmed, as strings. */
function pickContext(data) {
  const out = {};
  for (const k of CONTEXT_KEYS) {
    const v = data[k];
    if (v === undefined || v === null || v === false) continue;
    const s = String(v).trim();
    if (s) out[k] = s;
  }
  return out;
}

const SYNODIC_MONTH = 29.530588853; // days
const REFERENCE_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // a well-documented new moon
const PHASES = ['new', 'waxing crescent', 'first quarter', 'waxing gibbous', 'full', 'waning gibbous', 'last quarter', 'waning crescent'];

/** Phase of the moon on a date: { name, fraction (0..1), illumination (0..100) }. */
function moonPhase(date) {
  const days = (date.getTime() - REFERENCE_NEW_MOON) / 86400000;
  const fraction = (((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH) / SYNODIC_MONTH;
  const name = PHASES[Math.round(fraction * 8) % 8];
  const illumination = Math.round(((1 - Math.cos(2 * Math.PI * fraction)) / 2) * 100);
  return { name, fraction, illumination };
}

/** "22:40" -> "10:40 pm". Anything else passes through. */
function formatTime(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(value || '');
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'pm' : 'am'}`;
}

/** Which albums, shows and books come up across posts, most frequent first. */
function contextStats(posts, keys = ['listening', 'watching', 'reading']) {
  const out = {};
  for (const key of keys) {
    const map = new Map();
    for (const p of posts) {
      const v = p.context && p.context[key];
      if (!v) continue;
      const k = v.toLowerCase();
      if (!map.has(k)) map.set(k, { value: v, posts: [] });
      map.get(k).posts.push(p);
    }
    out[key] = [...map.values()].sort((a, b) => b.posts.length - a.posts.length || a.value.localeCompare(b.value));
  }
  return out;
}

module.exports = { CONTEXT_KEYS, pickContext, moonPhase, formatTime, contextStats };
