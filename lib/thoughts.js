'use strict';
/**
 * lib/thoughts.js: short, dated notes kept in one Markdown file per month.
 *
 *   content/thoughts/2026-10.md
 *
 *   ## 2026-10-14 22:46:05
 *   The thought, in Markdown. [[Wikilinks]] work.
 *
 *   ## 2026-10-14 23:10:40
 *   Another one.
 *
 * Timestamps are local time, as written. The id of a thought is derived from
 * its timestamp (t-20261014-224605) and doubles as its permalink anchor.
 */

const HEADING = /^## (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::(\d{2}))?\s*$/;
const STAMP = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

const idOf = (stamp) => `t-${stamp.slice(0, 10).replace(/-/g, '')}-${stamp.slice(11).replace(/:/g, '')}`;
const monthOf = (stamp) => stamp.slice(0, 7);
const fileFor = (stamp) => `content/thoughts/${monthOf(stamp)}.md`;

/** "2026-10-14 22:46:05" -> a local Date, or null. */
function dateOf(stamp) {
  const m = String(stamp).match(STAMP);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s);
  // Date silently rolls 13th months and 32nd days forward; insist every part survives.
  const same =
    date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d &&
    date.getHours() === h && date.getMinutes() === mi && date.getSeconds() === s;
  return same ? date : null;
}

const isStamp = (stamp) => dateOf(stamp) !== null;

/** Id -> stamp, or null if it isn't one of ours. */
function stampOfId(id) {
  const m = String(id).match(/^t-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : null;
}

/** Text of a month file -> [{ stamp, id, body }] in file order. */
function parse(text) {
  const out = [];
  let cur = null;
  for (const line of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    const h = line.match(HEADING);
    if (h) {
      cur = { stamp: `${h[1]} ${h[2]}:${h[3] || '00'}`, lines: [] };
      out.push(cur);
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  return out
    .map((t) => ({ stamp: t.stamp, id: idOf(t.stamp), body: t.lines.join('\n').trim() }))
    .filter((t) => t.body);
}

/** [{ stamp, body }] -> month file text. Keeps file order; sort before calling if needed. */
function serialize(thoughts) {
  return thoughts.map((t) => `## ${t.stamp}\n${t.body.trim()}\n`).join('\n');
}

module.exports = { parse, serialize, idOf, stampOfId, fileFor, monthOf, dateOf, isStamp };
