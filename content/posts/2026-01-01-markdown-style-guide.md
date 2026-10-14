---
title: Markdown style guide
date: 2026-01-01
tags: [meta]
summary: Every Markdown feature this site supports, on one page. Kept as a draft so it never publishes.
draft: true
---

This post is a kitchen sink for checking how things look. Because it is marked `draft: true` it only appears in the dev server (`npm run dev`) or with `node build.js --drafts`.

## Headings

### Third level

#### Fourth level

## Text

Paragraphs are separated by blank lines. You can use **bold**, *italic*, ~~strikethrough~~ and `inline code`. Links look like [this](https://example.com "with an optional title"), autolinks like <https://example.com>, and bare URLs such as https://example.com get linked too. Stray characters like & and 2 < 3 are escaped for you, while real inline HTML such as <kbd>Ctrl</kbd> passes through.

Two trailing spaces  
force a line break.

## Lists

- Unordered
- lists
  - with nesting
  - and more nesting
    1. even ordered
    2. inside unordered
- and back out

1. Ordered
2. lists
3. count themselves

- [ ] A task list
- [x] with a finished item

## Quotes

> Blockquotes work, and can run
> across several lines.
>
> > They can even nest.

## Code

```js
// Fenced code blocks, with the language noted for styling hooks.
const site = 'evolutionofexistence.com';
console.log(`Hello from ${site}`);
```

## Tables

| Feature          | Supported | Notes          |
|:-----------------|:---------:|---------------:|
| Tables           | yes       | with alignment |
| Escaped \| pipes | yes       | inside cells   |

## Images

![A gradient horizon used as a placeholder](/images/sample.svg "Optional title")

Put images in `static/images/` and reference them from the root, like `/images/photo.jpg`.

## Rules

---

## Raw HTML

<details>
<summary>Raw HTML passes straight through</summary>

Which is handy for the few things Markdown can't express.

</details>

<p class="muted small">That's everything.</p>
