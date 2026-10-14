# evolutionofexistence.com

A personal site and blog, built with a few hundred lines of plain Node.js and no dependencies. Posts are Markdown files. A build turns them into static HTML you can host anywhere.

```
npm run dev                      # preview at http://localhost:4000 with live reload
npm run new -- "Post title"      # scaffold content/posts/YYYY-MM-DD-post-title.md
npm run build                    # write the finished site to dist/
```

## How it fits together

```
content/
  posts/        one .md per blog post            -> /blog/<slug>/
  pages/        one .md per standalone page      -> /<slug>/
static/         copied to dist/ as-is (css, js, images, favicon, CNAME, robots.txt)
templates.js    the HTML for every page type, as plain JS functions
site.config.js  title, tagline, nav, footer links
lib/markdown.js the Markdown -> HTML converter
build.js        reads everything above and writes dist/
serve.js        dev server with live reload (shows drafts)
new-post.js     helper that creates a dated post file
dist/           generated output; never edit by hand, never commit
```

The generator also writes `/tags/`, `/tags/<tag>/`, `/feed.xml` (RSS), `/sitemap.xml` and `/404.html`.

## Writing

### Posts

Create a file in `content/posts/`. The filename can carry the date (`2026-10-14-hello-world.md`) or you can put it in the frontmatter. The slug comes from the filename with the date removed.

```markdown
---
title: Hello, world. Again.
date: 2026-10-14
tags: [meta, journey]
summary: One or two sentences shown in lists and feeds. Optional; the first paragraph is used otherwise.
---

Your post, in Markdown.
```

Optional frontmatter keys:

| Key       | What it does                                                        |
|-----------|---------------------------------------------------------------------|
| `slug`    | Override the URL segment                                            |
| `updated` | `YYYY-MM-DD`, shows a "last updated" line and feeds into the sitemap |
| `draft`   | `true` hides the post from `npm run build`; the dev server still shows it |

### Pages

Files in `content/pages/` become `/<filename>/`. Frontmatter: `title`, `description`, `lede` (a one-line intro under the title), `updated`, `draft`, and `layout`. Setting `layout: timeline` renders every `##` heading as a point on a vertical timeline, which is how the Journey page works.

Two pages are special by name:

- `now.md` also appears as a card on the home page. Keep it short and bump `updated` when it changes.
- `journey.md` is linked from the hero button. Rename the link in `site.config.js` if you rename the page.

### The three threads: Mind, Body, Spirit

The site is organized around three pillars defined in the `pillars` list in `site.config.js`. Tag a post `mind`, `body` or `spirit` and it is listed on `/mind/`, `/body/` or `/spirit/`, and its tag chip takes that thread's color. A post can belong to more than one thread. The intro at the top of each thread page is the matching file in `content/pages/` (`mind.md`, `body.md`, `spirit.md`); delete one and the page still exists, built from the config blurb. Rename, recolor or add threads in the config. The nav is a separate list, so update it too.

### Linking ideas (the Foam-style part)

Link any post or page from any other with double brackets, and the connections are tracked for you:

```markdown
[[What a label does to a thing]]          by title
[[what-a-label-does-to-a-thing]]          by slug
[[now|the short version]]                 with your own link text
```

Titles match case-insensitively; spacing and punctuation are forgiven. A link to something that doesn't exist yet renders as a dotted placeholder (hover shows "Nothing written here yet") and the build prints a warning naming the file, so you can see which ideas are still waiting to be written. Ordinary Markdown links to `/blog/<slug>/` or `/<page>/` count as connections too.

Every post and page that is linked to anything gets a **Connections** section: a small graph of its neighborhood, what it links to, and what links to it (backlinks).

`/explore/` has the full picture:

- **The web**: a force-directed graph of every post, page, thread and tag. Drag, zoom, hover to highlight neighbors, click to open. Tag nodes can be toggled off.
- **Words**: the words used most across your posts, sized by frequency. Click a word to list every entry that uses it and how often; the choice goes in the URL hash so `/explore/#existence` is shareable. A search box narrows the cloud.

Tune it in the `explore` block of `site.config.js`: how many words, the minimum number of entries a word must appear in, extra stopwords, and whether pages count. Drafts are included in the dev server and excluded from production builds, graph and all.

### Markdown support

Headings, paragraphs, bold, italic, strikethrough, inline code, fenced code blocks, blockquotes, nested and ordered lists, task lists, tables with alignment, links, images, autolinks, bare URLs, horizontal rules, and raw HTML. See the draft post `content/posts/2026-01-01-markdown-style-guide.md` for a sample of everything, visible in the dev server.

Images go in `static/images/` and are referenced from the root: `![alt](/images/photo.jpg)`.

## Customizing

- **Words**: `site.config.js` for the title, tagline, description, nav and footer links. The hero buttons are `heroLinks`.
- **Look**: `static/css/style.css`. The palette is the token block at the top; change `--accent` and `--accent-2` and the gradient, buttons, timeline dots and link colors all follow. Light mode has its own token block.
- **Fonts**: system fonts only, so nothing is downloaded. To use a webfont, add a `<link>` in `templates.js` and change `--font-display` or `--font-body`.
- **Structure**: `templates.js`. Each page type is one function returning HTML. `layout()` is the shell they all share.

## Deploying

The site is a folder of files, so any static host works. The build command is `node build.js` and the output folder is `dist/`.

### GitHub Pages (included)

1. `git init`, commit, and push this folder to a GitHub repo on a branch named `main`.
2. In the repo: Settings → Pages → Build and deployment → Source: **GitHub Actions**. The workflow in `.github/workflows/deploy.yml` builds and publishes on every push.
3. Settings → Pages → Custom domain: `evolutionofexistence.com`. Tick "Enforce HTTPS" once the certificate is issued. The `static/CNAME` file keeps the domain attached across deploys.
4. At your DNS provider, point the domain at GitHub Pages:

   | Type  | Name  | Value                    |
   |-------|-------|--------------------------|
   | A     | `@`   | `185.199.108.153`        |
   | A     | `@`   | `185.199.109.153`        |
   | A     | `@`   | `185.199.110.153`        |
   | A     | `@`   | `185.199.111.153`        |
   | CNAME | `www` | `<your-github-username>.github.io` |

   These are GitHub's published addresses; confirm against their current docs if anything fails to verify.

### Cloudflare Pages or Netlify

Connect the repo, set the build command to `node build.js` and the output directory to `dist`. Add the custom domain in their dashboard and follow the DNS instructions they give you. You can delete the GitHub workflow if you go this route.

## Why no dependencies

So that it keeps working. There is nothing to update, nothing to break on install, and nothing you did not write. If the Markdown converter ever feels limiting, `lib/markdown.js` is the only file to swap; `build.js` just calls `render()` and `parseFrontmatter()`.
