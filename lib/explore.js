'use strict';
/**
 * lib/explore.js: the data behind the Explore page and the per-post
 * "Connections" section. Pure functions over the entries build.js produces.
 *
 *   buildGraph(entries, pillars, tags)  -> { nodes, edges } for the full web
 *   neighborhood(entry, graph)          -> the slice around one entry
 *   buildWords(entries, opts)           -> word cloud data
 */

/** Pillar pages share a node with their pillar; everything else is keyed by URL. */
const nodeIdOf = (entry) => (entry.layout === 'pillar' ? `pillar:${entry.slug}` : entry.url);

const accentOf = (entry) => {
  const t = (entry.tags || []).find((tag) => tag.pillar);
  return t ? t.accent : null;
};

function buildGraph(entries, pillars, tags, thoughts = []) {
  const nodes = [];
  for (const e of entries) {
    if (e.layout === 'pillar') continue; // represented by the pillar node below
    nodes.push({ id: nodeIdOf(e), title: e.title, url: e.url, kind: e.kind, color: accentOf(e) });
  }
  for (const p of pillars) nodes.push({ id: `pillar:${p.slug}`, title: p.title, url: p.url, kind: 'pillar', color: p.accent });
  for (const t of tags) nodes.push({ id: `tag:${t.slug}`, title: `#${t.name}`, url: t.url, kind: 'tag', color: null });
  // Thoughts only join the web when they link to something; otherwise they'd be confetti.
  for (const t of thoughts) nodes.push({ id: nodeIdOf(t), title: t.title, url: t.url, kind: 'thought', color: null });

  const edges = [];
  const seen = new Set();
  const add = (s, t, kind) => {
    if (s === t) return;
    const key = s < t ? `${s}|${t}` : `${t}|${s}`;
    if (seen.has(key)) return; // first writer wins; links are added before tag memberships
    seen.add(key);
    edges.push({ s, t, kind });
  };
  for (const e of [...entries, ...thoughts]) for (const target of e.links || []) add(nodeIdOf(e), nodeIdOf(target), 'link');
  for (const e of entries) {
    for (const tag of e.tags || []) add(nodeIdOf(e), tag.pillar ? `pillar:${tag.slug}` : `tag:${tag.slug}`, 'tag');
  }
  return { nodes, edges };
}

/** The entry plus everything it links to or is linked from, and the links among them. */
function neighborhood(entry, graph) {
  const focus = nodeIdOf(entry);
  const ids = new Set([focus]);
  for (const e of entry.links || []) ids.add(nodeIdOf(e));
  for (const e of entry.backlinks || []) ids.add(nodeIdOf(e));
  return {
    focus,
    nodes: graph.nodes.filter((n) => ids.has(n.id)),
    edges: graph.edges.filter((e) => e.kind === 'link' && ids.has(e.s) && ids.has(e.t)),
  };
}

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set(
  `a about above across after again against all almost along already also although always am among an and
  another any anyone anything are around as at away back be became because become been before being below
  between both but by came can cannot come could did do does doing done down during each either else enough
  even ever every everyone everything few for from further get gets getting go goes going gone got had has
  have having he her here hers herself him himself his how however i if in into is it its itself just keep
  kept know knew last least less let like likely little long made make makes making many may maybe me might
  more most much must my myself near need neither never new next no nor not now of off often on once one only
  onto or other others ought our ours ourselves out over own part per put quite rather really right said same
  saw say says see seen she should since so some someone something sometimes somewhere still such take taken
  than that the their theirs them themselves then there these they thing things think this those though
  through time to too took toward under until up upon us use used using very want was way we well went were
  what when where whether which while who whole whom whose why will with within without would year years yes
  yet you your yours yourself yourselves
  dont doesnt didnt isnt arent wasnt werent im ive ill id youre youve youll youd hes shes theyre theyve theyll
  thats whats heres theres wheres cant couldnt wouldnt shouldnt wont havent hasnt hadnt lets`
    .split(/\s+/)
    .filter(Boolean)
);

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/'/g, '')
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 3);
}

/**
 * Counts words across entries (title + body text, minus code and stopwords).
 * Returns { entries: [{t,u,k,c}], words: [{w, n, d: [[entryIndex, count], ...]}] }
 * with the top `maxWords` by total count, listed alphabetically.
 */
function buildWords(entries, opts = {}) {
  const maxWords = opts.maxWords || 100;
  const minDocs = opts.minDocs || 1;
  const stop = new Set([...STOPWORDS, ...(opts.stopwords || []).map((s) => String(s).toLowerCase())]);

  const totals = new Map();
  entries.forEach((e, i) => {
    const counts = new Map();
    for (const w of tokenize(`${e.title} ${e.text || ''}`)) {
      if (stop.has(w)) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
    for (const [w, c] of counts) {
      const t = totals.get(w) || { n: 0, d: [] };
      t.n += c;
      t.d.push([i, c]);
      totals.set(w, t);
    }
  });

  const words = [...totals]
    .filter(([, t]) => t.d.length >= minDocs)
    .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
    .slice(0, maxWords)
    .map(([w, t]) => ({ w, n: t.n, d: t.d.sort((a, b) => b[1] - a[1]) }))
    .sort((a, b) => a.w.localeCompare(b.w));

  return {
    entries: entries.map((e) => ({ t: e.title, u: e.url, k: e.kind, c: accentOf(e) })),
    words,
  };
}

module.exports = { buildGraph, neighborhood, buildWords, tokenize, nodeIdOf };
