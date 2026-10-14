/* Word cloud for the Explore page. Click a word to list the entries that use it.
 *
 *   <input id="word-filter" type="search">              narrows the cloud as you type
 *   <div id="cloud"></div>                               the words
 *   <div id="word-results"></div>                        where the chosen word shows up
 *   <script type="application/json" id="words-data">     { entries: [...], words: [...] }
 *
 * The chosen word is kept in the URL hash, so /explore/#existence is shareable.
 */
(function () {
  'use strict';

  const source = document.getElementById('words-data');
  const cloud = document.getElementById('cloud');
  const results = document.getElementById('word-results');
  const filter = document.getElementById('word-filter');
  if (!source || !cloud || !results) return;

  const data = JSON.parse(source.textContent);
  const words = data.words || [];
  if (!words.length) {
    cloud.innerHTML = '<p class="muted">Nothing to show yet. Words appear here once there are posts to count.</p>';
    return;
  }

  const escape = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const counts = words.map((w) => w.n);
  const max = Math.max.apply(null, counts);
  const min = Math.min.apply(null, counts);
  const weight = (n) => (max === min ? 0.5 : Math.sqrt((n - min) / (max - min)));

  const buttons = new Map();
  let current = null;

  for (const w of words) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cloud-word';
    b.textContent = w.w;
    b.dataset.word = w.w;
    b.style.setProperty('--weight', weight(w.n).toFixed(3));
    b.title = w.n + (w.n === 1 ? ' use in ' : ' uses in ') + w.d.length + (w.d.length === 1 ? ' entry' : ' entries');
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => select(current === w.w ? null : w.w, true));
    cloud.appendChild(b);
    buttons.set(w.w, b);
  }

  function select(word, updateHash) {
    current = word;
    for (const [w, b] of buttons) b.setAttribute('aria-pressed', String(w === word));
    if (updateHash) history.replaceState(null, '', word ? '#' + encodeURIComponent(word) : location.pathname);
    if (!word) {
      results.innerHTML = '';
      return;
    }
    const entry = words.find((x) => x.w === word);
    const items = entry.d
      .map(([i, c]) => {
        const e = data.entries[i];
        const kind = e.k === 'page' ? '<span class="kind">page</span>' : '';
        return (
          '<li>' +
          (e.c ? '<span class="swatch" style="--pillar:' + escape(e.c) + '"></span>' : '<span class="swatch post"></span>') +
          '<a href="' + escape(e.u) + '">' + escape(e.t) + '</a>' + kind +
          '<span class="muted small">' + c + (c === 1 ? ' time' : ' times') + '</span>' +
          '</li>'
        );
      })
      .join('');
    results.innerHTML =
      '<div class="section-head"><h3>“' + escape(word) + '” shows up in ' + entry.d.length +
      (entry.d.length === 1 ? ' entry' : ' entries') + '</h3>' +
      '<button type="button" class="link-button" id="word-clear">Clear</button></div>' +
      '<ul class="word-list">' + items + '</ul>';
    results.querySelector('#word-clear').addEventListener('click', () => select(null, true));
    results.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  if (filter) {
    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      cloud.classList.toggle('filtering', q.length > 0);
      for (const [w, b] of buttons) b.classList.toggle('match', !q || w.indexOf(q) !== -1);
    });
  }

  function fromHash() {
    let w = '';
    try { w = decodeURIComponent(location.hash.slice(1)); } catch (e) { /* ignore bad hashes */ }
    if (w && buttons.has(w)) select(w, false);
  }
  window.addEventListener('hashchange', fromHash);
  fromHash();
})();
