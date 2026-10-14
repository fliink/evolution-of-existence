'use strict';
/**
 * templates.js: every page on the site is assembled here, as plain functions
 * that return HTML strings. There is no template language to learn; it is
 * just JavaScript template literals. Markup lives here, styles in static/css.
 */

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const longDate = (d) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const base = (site) => site.url.replace(/\/$/, '');
const abs = (site, url) => base(site) + url;
/** Make root-relative links absolute, for the RSS feed. */
const absolutize = (site, html) => html.replace(/(href|src)="\/(?!\/)/g, `$1="${base(site)}/`);

/* ---------- small shared pieces ---------- */

const MARK = `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="markGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8f7dff"/><stop offset="1" stop-color="#3fd9c3"/></linearGradient></defs><circle cx="32" cy="32" r="24" fill="url(#markGrad)"/><circle cx="40" cy="25" r="18" style="fill:var(--bg)"/></svg>`;

const ICON_SUN = `<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`;

const ICON_MOON = `<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

const LIVE_RELOAD = `<script>new EventSource('/__events').onmessage = () => location.reload();</script>`;

/** JSON safe to embed inside a <script type="application/json"> block. */
const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

const tagChips = (tags) =>
  tags
    .map((t) =>
      t.pillar
        ? `<a class="tag pillar" href="${t.url}" style="--pillar:${esc(t.accent)}">${esc(t.name)}</a>`
        : `<a class="tag" href="${t.url}">${esc(t.name)}</a>`
    )
    .join('');

/** The three thread cards on the home page. */
function pillarCards(pillars) {
  if (!pillars.length) return '';
  return `<section class="pillars" aria-label="The three threads">
${pillars
  .map(
    (p) => `<a class="pillar-card" href="${p.url}" style="--pillar:${esc(p.accent)}">
  <h3>${esc(p.title)}</h3>
  <p>${esc(p.blurb)}</p>
  <span class="count">${p.posts.length ? `${p.posts.length} post${p.posts.length === 1 ? '' : 's'}` : 'Nothing written yet'}</span>
</a>`
  )
  .join('\n')}
</section>`;
}

/** Small Mind · Body · Spirit switcher used on thread pages and the blog index. */
function pillarSwitch(pillars, currentSlug) {
  if (!pillars.length) return '';
  return `<nav class="pillar-switch" aria-label="Threads">${pillars
    .map(
      (p) =>
        `<a href="${p.url}" style="--pillar:${esc(p.accent)}"${p.slug === currentSlug ? ' aria-current="page"' : ''}>${esc(p.title)}</a>`
    )
    .join('')}</nav>`;
}

function postList(posts) {
  if (!posts.length) return '<p class="muted">Nothing here yet.</p>';
  return `<ol class="post-list">
${posts
  .map(
    (p) => `<li class="post-item">
  <time datetime="${p.isoDate}">${esc(p.dateText)}</time>
  <div class="body">
    <h3><a href="${p.url}">${esc(p.title)}</a>${p.draft ? ' <span class="draft-badge">draft</span>' : ''}</h3>
    ${p.summary ? `<p class="summary">${esc(p.summary)}</p>` : ''}
    <div class="meta">${tagChips(p.tags)}<span>${p.readingTime} min read</span></div>
  </div>
</li>`
  )
  .join('\n')}
</ol>`;
}

function postNav(post) {
  if (!post.older && !post.newer) return '';
  const link = (p, cls, label) =>
    p
      ? `<a class="${cls}" href="${p.url}"><span class="label">${label}</span>${esc(p.title)}</a>`
      : '<span></span>';
  return `<nav class="post-nav" aria-label="More posts">
  ${link(post.older, 'prev', 'Older')}
  ${link(post.newer, 'next', 'Newer')}
</nav>`;
}

/**
 * "Connections": what an entry links to, what links to it, and a small graph of
 * that neighborhood. Empty when the entry is not linked to anything.
 */
function connections(ctx, entry) {
  const links = entry.links || [];
  const backlinks = entry.backlinks || [];
  if (!links.length && !backlinks.length) return { html: '', scripts: [] };

  const list = (items) =>
    `<ul>${items
      .map((e) => `<li><a href="${e.url}">${esc(e.title)}</a>${e.kind === 'page' ? ' <span class="kind">page</span>' : ''}</li>`)
      .join('')}</ul>`;

  const html = `<section class="connections">
  <div class="section-head"><h2>Connections</h2><a href="/explore/">The whole web →</a></div>
  <div class="graph-wrap small"><canvas class="graph" data-graph="graph-local" data-height="280"></canvas></div>
  <script type="application/json" id="graph-local">${json(ctx.neighborhood(entry))}</script>
  <div class="connection-lists">
    <div><h3>Links to</h3>${links.length ? list(links) : '<p class="muted small">Nothing yet.</p>'}</div>
    <div><h3>Linked from</h3>${backlinks.length ? list(backlinks) : '<p class="muted small">Nothing yet.</p>'}</div>
  </div>
</section>`;
  return { html, scripts: ['/js/graph.js'] };
}

/* ---------- the shell every page shares ---------- */

function layout(ctx, { title, description, url, type = 'website', content, bodyClass = '', scripts = [] }) {
  const { site, dev } = ctx;
  const pageTitle = title ? `${title} · ${site.title}` : `${site.title} · ${site.tagline}`;
  const desc = description || site.description;

  const nav = site.nav
    .map((n) => {
      const current = n.href === '/' ? url === '/' : url.startsWith(n.href);
      return `<li><a href="${n.href}"${current ? ' aria-current="page"' : ''}>${esc(n.label)}</a></li>`;
    })
    .join('');

  const footerLinks = (site.links || [])
    .map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`)
    .concat(`<a href="/feed.xml">RSS</a>`)
    .join('<span class="dot">·</span>');

  return `<!doctype html>
<html lang="${esc(site.language || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${abs(site, url)}">
<meta property="og:site_name" content="${esc(site.title)}">
<meta property="og:title" content="${esc(title || site.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${abs(site, url)}">
<meta property="og:type" content="${type}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#0b0d12">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${esc(site.title)}" href="/feed.xml">
<link rel="stylesheet" href="/css/style.css">
<script>try{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
<a class="skip" href="#main">Skip to content</a>
<div class="bg" aria-hidden="true"></div>
<header class="site-header">
  <nav class="wrap nav" aria-label="Main">
    <a class="brand" href="/">${MARK}<span>${esc(site.title)}</span></a>
    <ul class="nav-links">${nav}</ul>
    <button class="theme-toggle" type="button" aria-label="Toggle light and dark theme">${ICON_SUN}${ICON_MOON}</button>
  </nav>
</header>
<main id="main" class="wrap">
${content}
</main>
<footer class="site-footer">
  <div class="wrap footer-inner">
    <p>© ${ctx.buildDate.getFullYear()} ${esc(site.author)}. Hand-built, no CMS.</p>
    <p class="footer-links">${footerLinks}</p>
  </div>
</footer>
<script src="/js/site.js" defer></script>
${scripts.map((s) => `<script src="${s}" defer></script>`).join('\n')}
${dev ? LIVE_RELOAD : ''}
</body>
</html>
`;
}

/* ---------- pages ---------- */

function home(ctx) {
  const { site, posts, now, pillars } = ctx;
  const buttons = (site.heroLinks || [])
    .map((b) => `<a class="btn${b.primary ? ' primary' : ''}" href="${b.href}">${esc(b.label)}</a>`)
    .join('');

  const content = `<section class="hero">
  <p class="eyebrow">${esc(site.tagline)}</p>
  <h1 class="hero-title">${esc(site.title)}</h1>
  <p class="lede">${esc(site.description)}</p>
  ${buttons ? `<div class="cta">${buttons}</div>` : ''}
</section>
${pillarCards(pillars)}
<div class="home-grid">
  <section class="recent">
    <div class="section-head"><h2>Recent writing</h2><a href="/blog/">All posts →</a></div>
    ${posts.length ? postList(posts.slice(0, site.recentPosts || 5)) : '<p class="muted">Nothing here yet. The first post is on its way.</p>'}
  </section>
  ${
    now
      ? `<aside class="now card">
    <div class="section-head"><h2>Now</h2>${now.updated ? `<time class="muted small" datetime="${now.updated.iso}">${esc(longDate(now.updated.date))}</time>` : ''}</div>
    <div class="prose compact">${now.html}</div>
    <p class="small"><a href="/now/">Full now page →</a></p>
  </aside>`
      : ''
  }
</div>`;
  return layout(ctx, { url: '/', content, bodyClass: 'home' });
}

function post(ctx) {
  const { post } = ctx;
  const conn = connections(ctx, post);
  const content = `<article class="article">
  <header class="article-head">
    <p class="meta"><time datetime="${post.isoDate}">${esc(post.dateText)}</time><span class="dot">·</span><span>${post.readingTime} min read</span>${post.draft ? '<span class="dot">·</span><span class="draft-badge">draft</span>' : ''}</p>
    <h1>${esc(post.title)}</h1>
    ${post.tags.length ? `<div class="tags">${tagChips(post.tags)}</div>` : ''}
  </header>
  <div class="prose">
${post.html}
  </div>
  ${post.updated ? `<p class="muted small updated">Last updated ${esc(longDate(post.updated.date))}.</p>` : ''}
  ${conn.html}
  ${postNav(post)}
</article>`;
  return layout(ctx, {
    title: post.title,
    description: post.summary,
    url: post.url,
    type: 'article',
    content,
    scripts: conn.scripts,
  });
}

function pillarPage(ctx, page) {
  const { pillars } = ctx;
  const pillar = page.pillar;
  const content = `<article class="article pillar-page" style="--pillar:${esc(pillar.accent)}">
  <header class="article-head">
    ${pillarSwitch(pillars, pillar.slug)}
    <h1>${esc(page.title)}</h1>
    ${page.lede ? `<p class="lede">${esc(page.lede)}</p>` : ''}
  </header>
  ${page.html ? `<div class="prose">\n${page.html}\n  </div>` : ''}
  <section class="section">
    <div class="section-head"><h2>Writing</h2><a href="/blog/">All posts →</a></div>
    ${pillar.posts.length ? postList(pillar.posts) : `<p class="muted">Nothing written in this thread yet. It's coming.</p>`}
  </section>
</article>`;
  return layout(ctx, { title: page.title, description: page.description, url: page.url, content, bodyClass: 'pillar' });
}

function page(ctx) {
  const { page } = ctx;
  if (page.layout === 'pillar') return pillarPage(ctx, page);
  const conn = connections(ctx, page);
  const content = `<article class="article${page.layout === 'timeline' ? ' timeline' : ''}">
  <header class="article-head">
    <h1>${esc(page.title)}</h1>
    ${page.lede ? `<p class="lede">${esc(page.lede)}</p>` : ''}
    ${page.updated ? `<p class="meta">Updated <time datetime="${page.updated.iso}">${esc(longDate(page.updated.date))}</time></p>` : ''}
  </header>
  <div class="prose">
${page.html}
  </div>
  ${conn.html}
</article>`;
  return layout(ctx, {
    title: page.title,
    description: page.description || page.lede,
    url: page.url,
    content,
    scripts: conn.scripts,
  });
}

function explore(ctx) {
  const { pillars, graph, words } = ctx;
  const linkCount = graph.edges.filter((e) => e.kind === 'link').length;
  const entryCount = graph.nodes.filter((n) => n.kind === 'post' || n.kind === 'page').length;
  const legend = pillars
    .map((p) => `<li><span class="swatch" style="--pillar:${esc(p.accent)}"></span>${esc(p.title)}</li>`)
    .join('');

  const content = `<header class="article-head">
  <h1>Explore</h1>
  <p class="lede">Two ways into the web of ideas here: how the entries link to one another, and the words that keep coming up.</p>
</header>

<section class="section explore-graph">
  <div class="section-head">
    <h2>The web</h2>
    <div class="graph-controls">
      <label><input type="checkbox" id="graph-tags" data-graph-toggle-tags="graph" checked> Show tags</label>
      <button type="button" class="btn small" data-graph-reset="graph">Reset view</button>
    </div>
  </div>
  <p class="muted small">${entryCount} entr${entryCount === 1 ? 'y' : 'ies'}, ${linkCount} link${linkCount === 1 ? '' : 's'} between them. Drag to move, scroll to zoom, click a node to open it.</p>
  <div class="graph-wrap"><canvas id="graph" class="graph" data-graph="graph-data" data-height="560"></canvas></div>
  <ul class="graph-legend">${legend}<li><span class="swatch post"></span>Post</li><li><span class="swatch page"></span>Page</li><li><span class="swatch tag"></span>Tag</li></ul>
  <script type="application/json" id="graph-data">${json(graph)}</script>
</section>

<section class="section explore-words">
  <div class="section-head">
    <h2>Words</h2>
    <input id="word-filter" class="word-filter" type="search" placeholder="Find a word" aria-label="Filter the word cloud">
  </div>
  <p class="muted small">The ${words.words.length} words used most across ${words.entries.length} entr${words.entries.length === 1 ? 'y' : 'ies'}, sized by how often they appear. Click one to see where it shows up.</p>
  <div id="cloud" class="cloud"></div>
  <div id="word-results" class="word-results" aria-live="polite"></div>
  <script type="application/json" id="words-data">${json(words)}</script>
</section>`;

  return layout(ctx, {
    title: 'Explore',
    description: 'The web of linked entries and the words that keep coming up.',
    url: '/explore/',
    content,
    bodyClass: 'explore',
    scripts: ['/js/graph.js', '/js/explore.js'],
  });
}

function blog(ctx) {
  const { posts, site } = ctx;
  const years = new Map();
  for (const p of posts) {
    const y = p.date.getFullYear();
    if (!years.has(y)) years.set(y, []);
    years.get(y).push(p);
  }
  const content = `<header class="article-head">
  <h1>Blog</h1>
  <p class="lede">${posts.length} post${posts.length === 1 ? '' : 's'} so far. <a href="/feed.xml">Subscribe via RSS</a>, browse <a href="/tags/">by tag</a>, <a href="/explore/">explore the web</a>, or follow one thread:</p>
  ${pillarSwitch(ctx.pillars)}
</header>
${[...years].map(([y, ps]) => `<h2 class="year">${y}</h2>\n${postList(ps)}`).join('\n')}`;
  return layout(ctx, { title: 'Blog', description: `Everything written on ${site.title}.`, url: '/blog/', content });
}

function tags(ctx) {
  const { tags } = ctx;
  const content = `<header class="article-head">
  <h1>Tags</h1>
  <p class="lede">${tags.length ? 'Every topic that has come up so far.' : 'No tags yet.'}</p>
</header>
<ul class="tag-cloud">
${tags.map((t) => `<li><a class="tag" href="${t.url}">${esc(t.name)}<span class="count">${t.posts.length}</span></a></li>`).join('\n')}
</ul>`;
  return layout(ctx, { title: 'Tags', description: 'Posts by topic.', url: '/tags/', content });
}

function tag(ctx) {
  const { tag } = ctx;
  const content = `<header class="article-head">
  <p class="meta"><a href="/tags/">Tags</a><span class="dot">·</span>${tag.posts.length} post${tag.posts.length === 1 ? '' : 's'}</p>
  <h1>${esc(tag.name)}</h1>
</header>
${postList(tag.posts)}`;
  return layout(ctx, { title: `Tagged “${tag.name}”`, description: `Posts tagged ${tag.name}.`, url: tag.url, content });
}

function notFound(ctx) {
  const content = `<section class="hero">
  <p class="eyebrow">404</p>
  <h1 class="hero-title">Not here yet.</h1>
  <p class="lede">That page hasn't evolved into existence. It may have moved, or it may never have been.</p>
  <div class="cta"><a class="btn primary" href="/">Back home</a><a class="btn" href="/blog/">Browse the blog</a></div>
</section>`;
  return layout(ctx, { title: 'Page not found', url: '/404.html', content, bodyClass: 'not-found' });
}

/* ---------- feeds ---------- */

function feed(ctx) {
  const { site, posts } = ctx;
  const items = posts
    .filter((p) => !p.draft)
    .slice(0, 20)
    .map(
      (p) => `
  <item>
    <title>${esc(p.title)}</title>
    <link>${abs(site, p.url)}</link>
    <guid isPermaLink="true">${abs(site, p.url)}</guid>
    <pubDate>${p.date.toUTCString()}</pubDate>
    ${p.tags.map((t) => `<category>${esc(t.name)}</category>`).join('')}
    <description>${esc(p.summary)}</description>
    <content:encoded><![CDATA[${absolutize(site, p.html).replace(/]]>/g, ']]]]><![CDATA[>')}]]></content:encoded>
  </item>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>${esc(site.title)}</title>
  <link>${abs(site, '/')}</link>
  <description>${esc(site.description)}</description>
  <language>${esc(site.language || 'en')}</language>
  <lastBuildDate>${ctx.buildDate.toUTCString()}</lastBuildDate>
  <atom:link href="${abs(site, '/feed.xml')}" rel="self" type="application/rss+xml"/>${items}
</channel>
</rss>
`;
}

function sitemap(ctx) {
  const { site, posts, pages, tags } = ctx;
  const today = ctx.buildDate.toISOString().slice(0, 10);
  const urls = [
    { loc: '/', lastmod: today },
    { loc: '/blog/', lastmod: today },
    { loc: '/tags/', lastmod: today },
    { loc: '/explore/', lastmod: today },
    ...pages.filter((p) => !p.draft).map((p) => ({ loc: p.url, lastmod: p.updated ? p.updated.iso : today })),
    ...posts.filter((p) => !p.draft).map((p) => ({ loc: p.url, lastmod: p.updated ? p.updated.iso : p.isoDate })),
    ...tags.map((t) => ({ loc: t.url, lastmod: today })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${abs(site, u.loc)}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}
</urlset>
`;
}

module.exports = { layout, home, post, page, blog, tags, tag, explore, notFound, feed, sitemap, postList, esc };
