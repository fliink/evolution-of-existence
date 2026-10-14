'use strict';
/**
 * new-post.js: scaffold a post file with today's date.
 *
 *   npm run new -- "Title of the post"
 *   node new-post.js "Title of the post"
 */
const fs = require('fs');
const path = require('path');
const { slugify } = require('./lib/markdown.js');

const title = process.argv.slice(2).join(' ').trim();
if (!title) {
  console.error('Usage: npm run new -- "Title of the post"');
  process.exit(1);
}

const now = new Date();
const iso = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
].join('-');
const slug = slugify(title) || 'untitled';
const file = path.join(__dirname, 'content', 'posts', `${iso}-${slug}.md`);

if (fs.existsSync(file)) {
  console.error(`${path.relative(process.cwd(), file)} already exists`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(
  file,
  `---
title: ${title}
date: ${iso}
tags: []
summary:
---

`
);

console.log(`created ${path.relative(process.cwd(), file)}`);
console.log(`it will publish at /blog/${slug}/ on the next build; add "draft: true" to the frontmatter to hold it back`);
