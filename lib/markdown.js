'use strict';
/**
 * A small Markdown -> HTML converter with no dependencies.
 *
 * Supported: ATX headings (# .. ######) with anchor ids, paragraphs, hard line
 * breaks (two trailing spaces or a backslash), **bold**, *italic*, ~~strike~~,
 * `inline code`, fenced code blocks (``` or ~~~ with a language class),
 * > blockquotes, nested bullet (-, *, +) and 1. lists, - [ ] task lists, | tables |,
 * [links](url), ![images](src), <autolinks>, bare URLs, --- rules, and raw
 * HTML passthrough.
 *
 * Deliberately not supported, to stay small: setext headings, indented code
 * blocks, reference-style links, footnotes. If you ever outgrow this, swap the
 * file for a library such as `marked`; build.js only uses the exports below.
 */

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const decodeEntities = (s) => String(s)
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

/** HTML -> plain text (tags removed, entities decoded, whitespace collapsed). */
const stripHtml = (s) => decodeEntities(String(s).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

/** "Hello, World!" -> "hello-world" */
function slugify(s) {
  return stripHtml(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

/** First paragraph of rendered HTML as plain text, trimmed to about `max` chars. */
function excerpt(html, max = 200) {
  const m = html.match(/<p>([\s\S]*?)<\/p>/);
  const text = stripHtml(m ? m[1] : html);
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

/* ------------------------------------------------------------------ */
/* Frontmatter                                                         */
/* ------------------------------------------------------------------ */

/**
 * Parses a leading block delimited by `---` lines. Values are strings unless
 * they are true/false or a [bracketed, list]. Quotes around values are removed.
 */
function parseFrontmatter(src) {
  const m = src.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: src };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) data[kv[1]] = parseValue(kv[2].trim());
  }
  return { data, body: src.slice(m[0].length) };
}

const unquote = (s) => s.replace(/^(["'])(.*)\1$/, '$2');

function parseValue(v) {
  if (v === '') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\[.*\]$/.test(v)) {
    return v.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
  }
  return unquote(v);
}

/* ------------------------------------------------------------------ */
/* Inline                                                              */
/* ------------------------------------------------------------------ */

// Set for the duration of render() by whoever knows every post and page.
// Gets the raw link target, returns { url, title } or null.
let wikilinkResolver = null;

function wikilink(target, label) {
  const hit = wikilinkResolver ? wikilinkResolver(decodeEntities(target)) : null;
  if (hit) return `<a class="wikilink" href="${hit.url}">${label || escapeHtml(hit.title)}</a>`;
  return `<span class="wikilink missing" title="Nothing written here yet">${label || target}</span>`;
}

function inline(src) {
  // Finished pieces of HTML are stashed and swapped for placeholders so the
  // later passes (escaping, emphasis) cannot mangle them.
  const stash = [];
  const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`;
  const attr = (s) => s.replace(/"/g, '&quot;'); // text is already escaped by then

  const s = src
    // `code spans`
    .replace(/(`+)([\s\S]+?)\1(?!`)/g, (_, _t, code) =>
      keep(`<code>${escapeHtml(code.replace(/^ (.+) $/, '$1'))}</code>`))
    // <https://autolinks>
    .replace(/<((?:https?|mailto):[^\s<>]+)>/g, (_, url) =>
      keep(`<a href="${escapeHtml(url)}">${escapeHtml(url.replace(/^mailto:/, ''))}</a>`))
    // raw inline HTML tags and comments pass through untouched
    .replace(/<!--[\s\S]*?-->|<\/?[a-zA-Z][\w-]*(?:\s+[^<>]*?)?\/?>/g, keep)
    // escape whatever is left
    .replace(/&(?![a-zA-Z][a-zA-Z0-9]*;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // [[wikilinks]] and [[target|label]], Foam style
    .replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, target, label) =>
      keep(wikilink(target.trim(), label ? label.trim() : '')))
    // ![alt](src "title")
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, url, title) =>
      keep(`<img src="${attr(url)}" alt="${attr(alt)}"${title ? ` title="${attr(title)}"` : ''} loading="lazy">`))
    // [text](href "title")  (text stays visible so emphasis inside still works)
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, text, href, title) =>
      keep(`<a href="${attr(href)}"${title ? ` title="${attr(title)}"` : ''}>`) + text + keep('</a>'))
    // bare URLs
    .replace(/(^|[\s(])(https?:\/\/(?:(?!&lt;|&gt;)[^\s\u0000])*[^\s\u0000.,;:!?)'"])/g, (_, pre, url) =>
      pre + keep(`<a href="${attr(url)}">${url}</a>`))
    // emphasis
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
    .replace(/\*(?=\S)([\s\S]*?\S)\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_(?=\S)([\s\S]*?\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
    // hard line breaks: two trailing spaces or a backslash
    .replace(/(?: {2,}|\\)\n/g, '<br>\n');

  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => stash[n]);
}

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const BLOCK_TAGS =
  'address|article|aside|audio|blockquote|canvas|center|details|dialog|div|dl|embed|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|iframe|img|main|math|nav|noscript|object|ol|p|picture|pre|script|section|style|summary|svg|table|ul|video';
const HTML_BLOCK = new RegExp(`^ {0,3}<(?:!--|/?(?:${BLOCK_TAGS})(?=[\\s>/]|$))`, 'i');

const isBlockStart = (l) =>
  FENCE.test(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l) || LIST.test(l) || HTML_BLOCK.test(l);

const leading = (l) => l.match(/^\s*/)[0].length;

function blocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;

    if (!line.trim()) { i++; continue; }

    // ``` fenced code
    if ((m = line.match(FENCE))) {
      const fence = m[1];
      const lang = m[2];
      const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`);
      const buf = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) buf.push(lines[i++]);
      i++; // closing fence
      out.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(buf.join('\n'))}\n</code></pre>`);
      continue;
    }

    // # heading
    if ((m = line.match(HEADING))) {
      const level = m[1].length;
      out.push(`<h${level} id="${slugify(m[2])}">${inline(m[2])}</h${level}>`);
      i++;
      continue;
    }

    // --- rule
    if (HR.test(line)) { out.push('<hr>'); i++; continue; }

    // > quote
    if (QUOTE.test(line)) {
      const buf = [];
      while (i < lines.length) {
        const l = lines[i];
        if (QUOTE.test(l)) { buf.push(l.replace(/^ {0,3}> ?/, '')); i++; }
        else if (l.trim() && buf.length && buf[buf.length - 1].trim() && !isBlockStart(l)) { buf.push(l); i++; }
        else break;
      }
      out.push(`<blockquote>\n${blocks(buf).join('\n')}\n</blockquote>`);
      continue;
    }

    // - list / 1. list
    if (LIST.test(line)) {
      const r = parseList(lines, i);
      out.push(r.html);
      i = r.i;
      continue;
    }

    // | table |
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('|') && TABLE_SEP.test(lines[i + 1])) {
      const r = parseTable(lines, i);
      out.push(r.html);
      i = r.i;
      continue;
    }

    // <div> raw HTML block, runs until a blank line
    if (HTML_BLOCK.test(line)) {
      const buf = [];
      while (i < lines.length && lines[i].trim()) buf.push(lines[i++]);
      out.push(buf.join('\n'));
      continue;
    }

    // paragraph
    const buf = [];
    while (i < lines.length && lines[i].trim() && (buf.length === 0 || !isBlockStart(lines[i]))) {
      buf.push(lines[i++].replace(/^\s+/, ''));
    }
    out.push(`<p>${inline(buf.join('\n'))}</p>`);
  }
  return out;
}

function parseList(lines, i) {
  const first = lines[i].match(LIST);
  const indent = first[1].length;
  const ordered = /^\d/.test(first[2]);
  const start = ordered ? parseInt(first[2], 10) : 1;
  const items = [];
  let cur = null;
  let loose = false;
  let prevBlank = false;

  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(LIST);
    const lead = leading(line);

    // a sibling item
    if (m && lead === indent) {
      if (/^\d/.test(m[2]) !== ordered) break; // switched list type: new list
      cur = { head: m[3], body: [], width: m[1].length + m[2].length + 1 };
      items.push(cur);
      prevBlank = false;
      i++;
      continue;
    }

    // blank line: still part of the list if what follows is indented or another item
    if (!line.trim()) {
      let j = i;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j >= lines.length) { i = j; break; }
      const nm = lines[j].match(LIST);
      const nl = leading(lines[j]);
      const sibling = nm && nl === indent && /^\d/.test(nm[2]) === ordered;
      if (nl > indent || sibling) {
        loose = true;
        if (nl > indent) cur.body.push('');
        prevBlank = true;
        i = j;
        continue;
      }
      i = j;
      break;
    }

    // indented: nested content of the current item
    if (lead > indent) {
      cur.body.push(line.slice(Math.min(lead, cur.width)));
      prevBlank = false;
      i++;
      continue;
    }

    // lazy continuation of the item's paragraph
    if (!prevBlank && !isBlockStart(line)) {
      if (cur.body.length) cur.body.push(line.trim());
      else cur.head += '\n' + line.trim();
      i++;
      continue;
    }

    break;
  }

  let hasTask = false;
  const html = items.map((it) => {
    let head = it.head;
    let task = '';
    const t = head.match(/^\[([ xX])\]\s+/);
    if (t) {
      hasTask = true;
      task = `<input type="checkbox" disabled${t[1] !== ' ' ? ' checked' : ''}> `;
      head = head.slice(t[0].length);
    }
    const body = it.body.length ? blocks(it.body) : [];
    const headHtml = task + inline(head);
    const wrap = loose || body.some((b) => b.startsWith('<p>'));
    return `<li${task ? ' class="task"' : ''}>${wrap ? `<p>${headHtml}</p>` : headHtml}${body.length ? '\n' + body.join('\n') + '\n' : ''}</li>`;
  }).join('\n');

  const tag = ordered ? 'ol' : 'ul';
  const attrs = (ordered && start !== 1 ? ` start="${start}"` : '') + (hasTask ? ' class="task-list"' : '');
  return { html: `<${tag}${attrs}>\n${html}\n</${tag}>`, i };
}

function parseTable(lines, i) {
  const split = (l) => {
    l = l.trim();
    if (l.startsWith('|')) l = l.slice(1);
    if (l.endsWith('|') && !l.endsWith('\\|')) l = l.slice(0, -1);
    return l.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  };
  const head = split(lines[i]);
  const align = split(lines[i + 1]).map((c) =>
    /^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : /^:-+$/.test(c) ? 'left' : '');
  i += 2;
  const rows = [];
  while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(split(lines[i++]));

  const cell = (tag, text, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(text)}</${tag}>`;
  const thead = `<thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead>`;
  const tbody = `<tbody>\n${rows.map((r) => `<tr>${head.map((_, k) => cell('td', r[k] ?? '', k)).join('')}</tr>`).join('\n')}\n</tbody>`;
  return { html: `<div class="table-wrap"><table>\n${thead}\n${tbody}\n</table></div>`, i };
}

/**
 * Markdown string -> HTML string.
 * opts.resolveWikilink(target) may return { url, title } for [[wikilinks]].
 */
function render(src, opts = {}) {
  wikilinkResolver = typeof opts.resolveWikilink === 'function' ? opts.resolveWikilink : null;
  try {
    const lines = String(src).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
    return blocks(lines).join('\n');
  } finally {
    wikilinkResolver = null;
  }
}

/** Rendered HTML -> readable plain text, skipping code, comments and markup. */
const toText = (html) =>
  stripHtml(
    String(html)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<pre[\s\S]*?<\/pre>/g, ' ')
      .replace(/<code[\s\S]*?<\/code>/g, ' ')
  );

module.exports = { render, inline, parseFrontmatter, slugify, escapeHtml, stripHtml, toText, excerpt };
