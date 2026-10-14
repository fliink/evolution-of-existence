#!/usr/bin/env node
'use strict';
/**
 * build.js: turns content/ + templates.js + static/ into dist/.
 *
 *   node build.js            production build
 *   node build.js --drafts   also include posts marked `draft: true`
 *
 * No dependencies. Everything it needs is in this folder.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const CONTENT = path.join(ROOT, 'content');
const STATIC = path.join(ROOT, 'static');

/** Require a module fresh each build so the dev server sees edits. */
function fresh(rel) {
  const p = require.resolve(path.join(ROOT, rel));
  delete require.cache[p];
  return require(p);
}

const exists = (p) => fs.existsSync(p);
const read = (p) => fs.readFileSync(p, 'utf8');

function write(rel, data) {
  const file = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

function copyDir(src, dest) {
  if (!exists(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function listMarkdown(dir) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => path.join(dir, f));
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Accepts "YYYY-MM-DD" (optionally followed by anything) from a value or a filename. */
function parseDate(value, fallbackName) {
  const m = String(value || '').match(DATE_RE) || String(fallbackName || '').match(DATE_RE);
  if (!m) return null;
  const [, y, mo, d] = m;
  return { date: new Date(+y, +mo - 1, +d, 12), iso: `${y}-${mo}-${d}` };
}

const longDate = (d) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

function normalizeTags(raw, slugify, pillarBySlug) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(',');
  const seen = new Set();
  return list
    .map((t) => String(t).trim())
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .map((name) => {
      const slug = slugify(name);
      const pillar = pillarBySlug.get(slug);
      // A tag that names a pillar links to the pillar page and carries its color.
      return pillar
        ? { name: pillar.title, slug, url: pillar.url, pillar: true, accent: pillar.accent }
        : { name, slug, url: `/tags/${slug}/`, pillar: false };
    });
}

function build(opts = {}) {
  const started = Date.now();
  const site = fresh('site.config.js');
  const md = fresh('lib/markdown.js');
  const X = fresh('lib/explore.js');
  const T = fresh('templates.js');
  const includeDrafts = Boolean(opts.drafts);
  const dev = Boolean(opts.dev);
  const explore = { maxWords: 100, minDocs: 1, stopwords: [], wordsFrom: 'posts', ...(site.explore || {}) };

  // 1. Clean output and copy static files verbatim.
  try {
    fs.rmSync(DIST, { recursive: true, force: true });
  } catch (e) {
    console.warn(`warn: could not fully clean dist (${e.message}); overwriting in place`);
  }
  copyDir(STATIC, DIST);

  // The three threads (mind / body / spirit). Each becomes a page at /<slug>/.
  const pillars = (site.pillars || []).map((p) => ({ ...p, url: `/${p.slug}/`, posts: [] }));
  const pillarBySlug = new Map(pillars.map((p) => [p.slug, p]));

  // 2. Read posts and pages. Rendering waits until every entry is known so that
  //    [[wikilinks]] can resolve against the full set of slugs and titles.
  const posts = listMarkdown(path.join(CONTENT, 'posts'))
    .map((file) => {
      const name = path.basename(file, '.md');
      const { data, body } = md.parseFrontmatter(read(file));
      const when = parseDate(data.date, name);
      if (!when) {
        throw new Error(
          `${path.relative(ROOT, file)} needs a date: add "date: YYYY-MM-DD" to the frontmatter or prefix the filename with YYYY-MM-DD-`
        );
      }
      const slug = data.slug || name.replace(DATE_RE, '').replace(/^-+/, '') || name;
      return {
        kind: 'post',
        file,
        slug,
        url: `/blog/${slug}/`,
        title: data.title || slug,
        body,
        date: when.date,
        isoDate: when.iso,
        dateText: longDate(when.date),
        updated: parseDate(data.updated),
        tags: normalizeTags(data.tags, md.slugify, pillarBySlug),
        summary: data.summary || '',
        draft: data.draft === true,
      };
    })
    .filter((p) => includeDrafts || !p.draft)
    .sort((a, b) => b.date - a.date || a.title.localeCompare(b.title));

  const pages = listMarkdown(path.join(CONTENT, 'pages'))
    .map((file) => {
      const name = path.basename(file, '.md');
      const { data, body } = md.parseFrontmatter(read(file));
      const slug = data.slug || name;
      return {
        kind: 'page',
        file,
        slug,
        url: `/${slug}/`,
        title: data.title || slug,
        description: data.description || '',
        lede: data.lede || '',
        layout: data.layout || 'page',
        body,
        updated: parseDate(data.updated),
        tags: [],
        draft: data.draft === true,
      };
    })
    .filter((p) => includeDrafts || !p.draft);

  // Pillar pages: content/pages/<slug>.md supplies the intro if it exists;
  // otherwise the page is made from the config alone so /<slug>/ always works.
  for (const pillar of pillars) {
    let page = pages.find((p) => p.slug === pillar.slug);
    if (!page) {
      page = {
        kind: 'page',
        file: null,
        slug: pillar.slug,
        url: pillar.url,
        title: pillar.title,
        description: pillar.blurb,
        lede: '',
        body: '',
        updated: null,
        tags: [],
        draft: false,
      };
      pages.push(page);
    }
    page.layout = 'pillar';
    page.pillar = pillar;
    page.title = page.title || pillar.title;
    page.description = page.description || pillar.blurb;
    page.lede = page.lede || pillar.blurb;
  }

  // 3. Render everything. [[wikilinks]] resolve by slug, by title, or by slugified title.
  const entries = [...posts, ...pages];
  const byKey = new Map();
  const register = (key, entry) => {
    const k = String(key || '').trim().toLowerCase();
    if (k && !byKey.has(k)) byKey.set(k, entry);
  };
  for (const e of entries) {
    register(e.slug, e);
    register(e.title, e);
    register(md.slugify(e.title), e);
  }
  const unresolved = [];
  for (const e of entries) {
    e.html = md.render(e.body || '', {
      resolveWikilink: (target) => {
        const hit = byKey.get(target.trim().toLowerCase()) || byKey.get(md.slugify(target)) || null;
        if (!hit) unresolved.push(`[[${target}]] in ${e.file ? path.relative(ROOT, e.file) : e.url}`);
        return hit;
      },
    });
    e.text = md.toText(e.html);
    if (e.kind === 'post') {
      e.summary = e.summary || md.excerpt(e.html);
      e.readingTime = Math.max(1, Math.round(e.text.split(/\s+/).filter(Boolean).length / 220));
    }
    delete e.body;
  }
  posts.forEach((p, i) => {
    p.newer = posts[i - 1] || null;
    p.older = posts[i + 1] || null;
    for (const t of p.tags) if (t.pillar) pillarBySlug.get(t.slug).posts.push(p);
  });

  // 4. Tags, most-used first. Pillar tags have their own pages, so they are left out here.
  const tagMap = new Map();
  for (const p of posts) {
    for (const t of p.tags) {
      if (t.pillar) continue;
      if (!tagMap.has(t.slug)) tagMap.set(t.slug, { ...t, posts: [] });
      tagMap.get(t.slug).posts.push(p);
    }
  }
  const tags = [...tagMap.values()].sort(
    (a, b) => b.posts.length - a.posts.length || a.name.localeCompare(b.name)
  );

  // 5. The web: which entries link to which (via [[wikilinks]] or ordinary links),
  //    the backlinks that follow from it, and the word counts for the cloud.
  const byUrl = new Map(entries.map((e) => [e.url, e]));
  for (const e of entries) {
    const seen = new Set();
    e.links = [];
    for (const m of e.html.matchAll(/href="(\/[^"#?]*)"/g)) {
      const url = m[1].endsWith('/') ? m[1] : `${m[1]}/`;
      const target = byUrl.get(url);
      if (target && target !== e && !seen.has(url)) {
        seen.add(url);
        e.links.push(target);
      }
    }
  }
  for (const e of entries) e.backlinks = entries.filter((o) => o.links.includes(e));
  const graph = X.buildGraph(entries, pillars, tags);
  const words = X.buildWords(
    entries.filter((e) => explore.wordsFrom === 'all' || e.kind === 'post'),
    explore
  );

  // 6. Write every page.
  const ctx = {
    site,
    dev,
    posts,
    pages,
    tags,
    pillars,
    graph,
    words,
    now: pages.find((p) => p.slug === 'now') || null,
    buildDate: new Date(),
    neighborhood: (entry) => X.neighborhood(entry, graph),
  };

  let count = 0;
  const emit = (rel, html) => {
    write(rel, html);
    count++;
  };

  emit('index.html', T.home(ctx));
  emit('blog/index.html', T.blog(ctx));
  for (const post of posts) emit(`blog/${post.slug}/index.html`, T.post({ ...ctx, post }));
  for (const page of pages) emit(`${page.slug}/index.html`, T.page({ ...ctx, page }));
  emit('tags/index.html', T.tags(ctx));
  for (const tag of tags) emit(`tags/${tag.slug}/index.html`, T.tag({ ...ctx, tag }));
  emit('explore/index.html', T.explore(ctx));
  emit('404.html', T.notFound(ctx));
  emit('feed.xml', T.feed(ctx));
  emit('sitemap.xml', T.sitemap(ctx));

  if (unresolved.length) {
    console.warn(`warn: ${unresolved.length} wikilink${unresolved.length === 1 ? '' : 's'} point nowhere (shown as placeholders):\n  ${unresolved.join('\n  ')}`);
  }
  const drafts = posts.filter((p) => p.draft).length;
  const linkCount = graph.edges.filter((e) => e.kind === 'link').length;
  console.log(
    `built ${count} pages (${posts.length} posts${drafts ? `, ${drafts} draft` : ''}, ${pages.length} pages, ${pillars.length} pillars, ${tags.length} tags, ${linkCount} links, ${words.words.length} cloud words) in ${Date.now() - started}ms -> dist/`
  );
  return ctx;
}

module.exports = { build, ROOT, DIST, CONTENT, STATIC };

if (require.main === module) {
  try {
    build({ drafts: process.argv.includes('--drafts') });
  } catch (e) {
    console.error(`build failed: ${e.message}`);
    process.exit(1);
  }
}
