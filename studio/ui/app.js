/* Studio client: talks to /api/*, previews with the site's own Markdown engine. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = {
    app: $('app'), status: $('status'), counts: $('counts'), list: $('entries'), filter: $('filter'),
    text: $('text'), preview: $('preview'), panes: $('panes'), pane: $('pane'), empty: $('empty'),
    path: $('path'), save: $('btn-save'), previewBtn: $('btn-preview'), draft: $('btn-draft'),
    raw: $('btn-raw'), del: $('btn-delete'), newBtn: $('btn-new'), newPageBtn: $('btn-new-page'),
    login: $('login'), logout: $('btn-logout'), site: $('link-site'), toggleList: $('toggle-list'),
    picker: $('picker'), fields: $('fields'), details: $('details'), detailsBtn: $('btn-details'),
    toolbar: $('toolbar'), image: $('file-image'),
    thoughts: $('thoughts'), thoughtText: $('thought-text'), post: $('btn-post'), stream: $('thought-stream'),
    thoughtsBtn: $('btn-thoughts'),
  };
  const mdx = window.markdown;

  // What the details panel shows for each kind of entry. Anything else in the
  // frontmatter is preserved untouched and editable through Raw.
  const FIELDS = {
    post: [
      { key: 'title', label: 'Title', type: 'text', placeholder: 'Title' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'tags', label: 'Tags', type: 'tags' },
      { key: 'summary', label: 'Summary', type: 'textarea', placeholder: 'One or two sentences for lists and the feed. Optional; the first paragraph is used otherwise.' },
      // "While writing": shown as a collapsible group, all optional, all public.
      { key: 'time', label: 'Time', type: 'time', group: 'context' },
      { key: 'place', label: 'Place', type: 'text', group: 'context', suggest: true, placeholder: 'City is plenty' },
      { key: 'weather', label: 'Weather', type: 'weather', group: 'context', placeholder: 'Fetch, or type it' },
      { key: 'listening', label: 'Listening to', type: 'text', group: 'context', suggest: true, placeholder: 'Artist, album or song' },
      { key: 'watching', label: 'Watching', type: 'text', group: 'context', suggest: true, placeholder: 'Show or film' },
      { key: 'reading', label: 'Reading', type: 'text', group: 'context', suggest: true, placeholder: 'Book' },
      { key: 'mood', label: 'Mood', type: 'text', group: 'context', suggest: true, placeholder: 'A word or two' },
    ],
    page: [
      { key: 'title', label: 'Title', type: 'text', placeholder: 'Title' },
      { key: 'lede', label: 'Lede', type: 'text', placeholder: 'One line under the title. Optional.' },
      { key: 'description', label: 'Description', type: 'text', placeholder: 'For search engines and link previews. Optional.' },
      { key: 'updated', label: 'Updated', type: 'date' },
    ],
  };

  let me = null;
  let entries = [];
  let current = null; // { kind, path, sha, data: Map, isNew }
  let dirty = false;
  let rawMode = false;
  let previewOn = false;
  let previewTimer = null;
  let deployTimer = null;
  const fieldEls = new Map();

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const today = () => {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  };
  const nowTime = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const lastPlace = () => { try { return localStorage.getItem('studio:place') || ''; } catch (e) { return ''; } };
  const rememberPlace = (place) => { try { if (place) localStorage.setItem('studio:place', place); } catch (e) { /* ignore */ } };

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: Object.assign({ 'x-studio': '1' }, body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    if (res.status === 401) {
      el.login.hidden = false;
      throw new Error('Please sign in.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  function setStatus(text, kind, link) {
    el.status.innerHTML = esc(text) + (link ? ` <a href="${esc(link.href)}" target="_blank" rel="noopener">${esc(link.label)}</a>` : '');
    el.status.dataset.kind = kind || '';
  }

  /* ---------- frontmatter: split a file into fields + body, and back ---------- */

  const unquote = (s) => s.replace(/^(["'])(.*)\1$/, '$2');

  function splitFile(text) {
    const data = new Map();
    const m = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!m) return { data, body: text };
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1];
      const v = kv[2].trim();
      if (key === 'tags') data.set(key, (/^\[.*\]$/.test(v) ? v.slice(1, -1) : v).split(',').map((s) => unquote(s.trim())).filter(Boolean));
      else if (key === 'draft') data.set(key, v === 'true');
      else data.set(key, unquote(v));
    }
    return { data, body: text.slice(m[0].length).replace(/^\n/, '') };
  }

  function joinFile(data, body) {
    const lines = [];
    for (const [k, v] of data) {
      if (v === '' || v == null || v === false) continue;
      if (Array.isArray(v)) {
        if (v.length) lines.push(`${k}: [${v.join(', ')}]`);
        continue;
      }
      if (v === true) {
        lines.push(`${k}: true`);
        continue;
      }
      const s = String(v);
      lines.push(`${k}: ${/^[\[\]"']|^(true|false)$/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s}`);
    }
    return `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\n+/, '')}`;
  }

  /* ---------- the list ---------- */

  async function loadEntries() {
    entries = (await api('GET', '/api/entries')).entries;
    renderList();
  }

  function pillarColor(tag) {
    const p = (me && me.pillars || []).find((x) => x.slug === String(tag).toLowerCase());
    return p ? p.accent : null;
  }

  function renderList() {
    const q = el.filter.value.trim().toLowerCase();
    const match = (e) =>
      !q || e.title.toLowerCase().includes(q) || e.name.toLowerCase().includes(q) || (e.tags || []).join(' ').toLowerCase().includes(q);
    const posts = entries
      .filter((e) => e.kind === 'post' && match(e))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title));
    const pages = entries.filter((e) => e.kind === 'page' && match(e)).sort((a, b) => a.title.localeCompare(b.title));
    const dots = (e) => (e.tags || []).map(pillarColor).filter(Boolean).map((c) => `<span class="dot" style="--pillar:${esc(c)}"></span>`).join('');
    const item = (e) =>
      `<a href="#${encodeURIComponent(e.path)}" class="entry${current && current.path === e.path ? ' active' : ''}" data-path="${esc(e.path)}">` +
      `<span class="entry-title">${esc(e.title)}</span>${e.draft ? '<span class="badge">draft</span>' : ''}` +
      `<span class="entry-meta">${dots(e)}${esc(e.date || e.name)}</span></a>`;
    el.list.innerHTML =
      `<h2>Posts <span class="count">${posts.length}</span></h2>${posts.map(item).join('') || '<p class="muted small">None yet.</p>'}` +
      `<h2>Pages <span class="count">${pages.length}</span></h2>${pages.map(item).join('') || '<p class="muted small">None.</p>'}`;
  }

  el.list.addEventListener('click', (ev) => {
    const a = ev.target.closest('a.entry');
    if (!a) return;
    ev.preventDefault();
    open(a.dataset.path);
  });
  el.filter.addEventListener('input', renderList);
  el.toggleList.addEventListener('click', () => el.app.classList.toggle('show-list'));

  /* ---------- opening and showing an entry ---------- */

  function confirmDiscard() {
    return !dirty || confirm('You have unsaved changes. Discard them?');
  }

  async function open(path) {
    if (current && current.path === path && !current.isNew) {
      el.app.classList.remove('show-list');
      return;
    }
    if (!confirmDiscard()) return;
    setStatus('Loading…');
    try {
      const e = await api('GET', '/api/entry?path=' + encodeURIComponent(path));
      const { data, body } = splitFile(e.content);
      current = { kind: path.startsWith('content/posts/') ? 'post' : 'page', path, sha: e.sha, data, isNew: false };
      rawMode = false;
      show(body);
      dirty = false;
      el.save.disabled = true;
      setStatus('');
      const backup = readBackup(path);
      if (backup && backup !== e.content && confirm('This browser has an unsaved version of this file. Restore it?')) {
        const b = splitFile(backup);
        current.data = b.data;
        show(b.body);
        markDirty();
      } else {
        clearBackup(path);
      }
      history.replaceState(null, '', '#' + encodeURIComponent(path));
      renderList();
      el.app.classList.remove('show-list');
      el.text.focus();
    } catch (err) {
      setStatus(err.message, 'error');
    }
  }

  /** Put the current entry on screen: fields, text, path, buttons. */
  function show(body) {
    hideThoughts();
    el.raw.setAttribute('aria-pressed', String(rawMode));
    el.fields.hidden = rawMode;
    renderFields();
    el.text.value = rawMode ? joinFile(current.data, body) : body;
    el.empty.hidden = true;
    el.pane.hidden = false;
    updatePath();
    updateDraftButton();
    updateCounts();
    if (previewOn) renderPreview();
  }

  function startNew(kind) {
    if (!confirmDiscard()) return;
    const data = new Map(kind === 'post'
      ? [['title', ''], ['date', today()], ['tags', []], ['summary', ''], ['draft', true], ['time', nowTime()], ['place', lastPlace()]]
      : [['title', ''], ['lede', ''], ['description', '']]);
    // Seed every known key (empty ones are dropped on save) so files always read in the same order.
    for (const def of FIELDS[kind] || []) if (!data.has(def.key)) data.set(def.key, '');
    current = { kind, path: null, sha: null, data, isNew: true };
    rawMode = false;
    show('');
    dirty = false;
    el.save.disabled = true;
    setStatus(kind === 'post' ? 'New post. Give it a title, write, then Save.' : 'New page. Give it a title, write, then Save.', 'info');
    history.replaceState(null, '', location.pathname);
    renderList();
    el.app.classList.remove('show-list');
    el.details.classList.add('open');
    const title = fieldEls.get('title');
    if (title) title.focus();
  }
  el.newBtn.addEventListener('click', () => startNew('post'));
  el.newPageBtn.addEventListener('click', () => startNew('page'));

  function computePath() {
    if (!current.isNew) return current.path;
    const slug = mdx.slugify(current.data.get('title') || '') || 'untitled';
    return current.kind === 'post' ? `content/posts/${current.data.get('date') || today()}-${slug}.md` : `content/pages/${slug}.md`;
  }

  function entryUrl() {
    const name = computePath().split('/').pop().replace(/\.md$/, '');
    const slug = current.data.get('slug') || (current.kind === 'post' ? name.replace(/^\d{4}-\d{2}-\d{2}-?/, '') || name : name);
    return current.kind === 'post' ? `/blog/${slug}/` : `/${slug}/`;
  }

  function updatePath() {
    el.path.textContent = computePath() + (current.isNew ? '  (not saved yet)' : '');
  }

  /* ---------- the details panel ---------- */

  function renderFields() {
    el.fields.innerHTML = '';
    fieldEls.clear();
    const defs = FIELDS[current.kind] || FIELDS.page;
    for (const def of defs.filter((d) => !d.group)) el.fields.appendChild(renderField(def));
    const context = defs.filter((d) => d.group === 'context');
    if (context.length) {
      const group = document.createElement('details');
      group.className = 'field-group';
      group.open = current.isNew || context.some((d) => current.data.get(d.key));
      const summary = document.createElement('summary');
      summary.textContent = 'While writing';
      group.appendChild(summary);
      const grid = document.createElement('div');
      grid.className = 'grid';
      for (const def of context) grid.appendChild(renderField(def));
      group.appendChild(grid);
      el.fields.appendChild(group);
    }
    const known = new Set([...defs.map((d) => d.key), 'draft']);
    const other = [...current.data].filter(([k]) => !known.has(k));
    if (other.length) {
      const p = document.createElement('p');
      p.className = 'muted small field-other';
      p.textContent = 'Also in this file: ' + other.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ') + '. Use Raw to change these.';
      el.fields.appendChild(p);
    }
  }

  /** One labelled field. Registers its input in fieldEls so other code can read it. */
  function renderField(def) {
    const wrap = document.createElement('label');
    wrap.className = `field field-${def.type}`;
    const label = document.createElement('span');
    label.className = 'field-label';
    label.textContent = def.label;
    wrap.appendChild(label);
    let input;
    if (def.type === 'tags') {
      input = renderTags();
      wrap.appendChild(input);
    } else if (def.type === 'weather') {
      input = renderInput({ ...def, type: 'text' });
      const row = document.createElement('div');
      row.className = 'weather-field';
      row.appendChild(input);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn small';
      btn.textContent = 'Fetch';
      btn.title = 'Look up the current weather where you are';
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        fetchWeather();
      });
      row.appendChild(btn);
      wrap.appendChild(row);
    } else {
      input = renderInput(def);
      wrap.appendChild(input);
      if (def.suggest) {
        const list = document.createElement('datalist');
        list.id = `dl-${def.key}`;
        for (const v of suggestions(def.key)) {
          const o = document.createElement('option');
          o.value = v;
          list.appendChild(o);
        }
        input.setAttribute('list', list.id);
        wrap.appendChild(list);
      }
    }
    input.dataset.key = def.key;
    fieldEls.set(def.key, input);
    return wrap;
  }

  /** Values used before for a context field, for the datalist. */
  function suggestions(key) {
    const seen = new Map();
    for (const e of entries) {
      const v = e.context && e.context[key];
      if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }

  async function fetchWeather() {
    const input = fieldEls.get('weather');
    const placeInput = fieldEls.get('place');
    if (!input || !current) return;
    setStatus('Checking the weather…');
    const ask = (qs) => api('GET', '/api/weather?' + qs);
    try {
      let result = null;
      const geo = window.navigator && window.navigator.geolocation;
      if (geo) {
        try {
          const pos = await new Promise((resolve, reject) => geo.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 600000 }));
          result = await ask(`lat=${pos.coords.latitude.toFixed(3)}&lon=${pos.coords.longitude.toFixed(3)}`);
        } catch (e) {
          result = null; // no permission or no fix: fall back to the place name
        }
      }
      if (!result) {
        const place = (current.data.get('place') || '').trim();
        if (!place) throw new Error('Allow location access, or type a place first.');
        result = await ask('place=' + encodeURIComponent(place));
      }
      if (result.weather) {
        input.value = result.weather;
        current.data.set('weather', result.weather);
      }
      if (result.place && placeInput && !(current.data.get('place') || '').trim()) {
        placeInput.value = result.place;
        current.data.set('place', result.place);
      }
      markDirty();
      setStatus(`${result.weather}${result.place ? ` in ${result.place}` : ''}`, 'ok');
    } catch (err) {
      setStatus(err.message, 'error');
    }
  }

  function renderInput(def) {
    const input = document.createElement(def.type === 'textarea' ? 'textarea' : 'input');
    if (def.type !== 'textarea') input.type = def.type;
    else input.rows = 2;
    input.placeholder = def.placeholder || '';
    input.value = current.data.get(def.key) || '';
    input.addEventListener('input', () => {
      current.data.set(def.key, input.value);
      onFieldChange(def.key);
    });
    return input;
  }

  function renderTags() {
    const box = document.createElement('div');
    box.className = 'tags-field';
    const pillars = (me && me.pillars) || [];
    const pillarSlugs = new Set(pillars.map((p) => p.slug));
    const tags = () => current.data.get('tags') || [];
    const has = (slug) => tags().some((t) => String(t).toLowerCase() === slug);

    for (const p of pillars) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = p.title;
      chip.style.setProperty('--pillar', p.accent);
      chip.setAttribute('aria-pressed', String(has(p.slug)));
      chip.addEventListener('click', () => {
        current.data.set('tags', has(p.slug) ? tags().filter((t) => String(t).toLowerCase() !== p.slug) : [...tags(), p.slug]);
        chip.setAttribute('aria-pressed', String(has(p.slug)));
        onFieldChange('tags');
      });
      box.appendChild(chip);
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tags-input';
    input.placeholder = pillars.length ? 'other tags, comma separated' : 'tags, comma separated';
    input.value = tags().filter((t) => !pillarSlugs.has(String(t).toLowerCase())).join(', ');
    input.addEventListener('input', () => {
      const keep = tags().filter((t) => pillarSlugs.has(String(t).toLowerCase()));
      const free = input.value.split(',').map((s) => s.trim()).filter(Boolean);
      current.data.set('tags', [...keep, ...free]);
      onFieldChange('tags');
    });
    box.appendChild(input);
    return box;
  }

  function onFieldChange(key) {
    markDirty();
    if (key === 'title' || key === 'date') updatePath();
    if (key === 'title' && previewOn) schedulePreview();
  }

  el.detailsBtn.addEventListener('click', () => {
    const open = el.details.classList.toggle('open');
    el.detailsBtn.setAttribute('aria-expanded', String(open));
  });

  /* ---------- draft and raw toggles ---------- */

  function isDraft() {
    return rawMode ? splitFile(el.text.value).data.get('draft') === true : current.data.get('draft') === true;
  }

  function updateDraftButton() {
    const d = isDraft();
    el.draft.classList.toggle('on', d);
    el.draft.textContent = d ? 'Draft (hidden)' : 'Published';
    el.draft.title = d ? 'Hidden from the site. Click to publish on the next save.' : 'Live on the site. Click to turn it back into a draft.';
  }

  el.draft.addEventListener('click', () => {
    if (rawMode) {
      const { data, body } = splitFile(el.text.value);
      data.set('draft', !(data.get('draft') === true));
      el.text.value = joinFile(data, body);
    } else {
      current.data.set('draft', !isDraft());
    }
    markDirty();
    updateDraftButton();
  });

  el.raw.addEventListener('click', () => {
    if (rawMode) {
      const { data, body } = splitFile(el.text.value);
      current.data = data;
      rawMode = false;
      show(body);
    } else {
      const body = el.text.value;
      rawMode = true;
      show(body);
    }
  });

  /* ---------- editing, saving, deleting ---------- */

  function markDirty() {
    dirty = true;
    el.save.disabled = false;
    setStatus(current && current.isNew ? 'Not saved yet' : 'Unsaved changes', 'dirty');
    if (current && !current.isNew) writeBackup(current.path, composeFile());
  }

  function composeFile() {
    return rawMode ? el.text.value : joinFile(current.data, el.text.value);
  }

  el.text.addEventListener('input', () => {
    markDirty();
    updateCounts();
    maybeAutocomplete();
    if (previewOn) schedulePreview();
  });

  async function save() {
    if (!current || !dirty) return;
    if (!rawMode && !(current.data.get('title') || '').trim()) {
      setStatus('Give it a title first.', 'error');
      const t = fieldEls.get('title');
      if (t) t.focus();
      return;
    }
    const path = computePath();
    const content = composeFile();
    const title = (rawMode ? splitFile(content).data.get('title') : current.data.get('title')) || path;
    el.save.disabled = true;
    setStatus('Saving…');
    try {
      const r = await api('PUT', '/api/entry', {
        path,
        content,
        sha: current.sha || undefined,
        message: `Studio: ${current.isNew ? 'add' : 'update'} ${title}`,
      });
      const wasNew = current.isNew;
      current.isNew = false;
      current.path = path;
      current.sha = r.sha;
      dirty = false;
      clearBackup(path);
      updatePath();
      rememberPlace(current.data.get('place'));
      history.replaceState(null, '', '#' + encodeURIComponent(path));
      if (r.commit) {
        setStatus(`Saved · commit ${r.commit.slice(0, 7)} · the site is rebuilding`, 'ok');
        watchDeploy(r.commit, me.site + entryUrl());
      } else {
        setStatus(wasNew ? 'Created on disk' : 'Saved to disk', 'ok');
      }
      await loadEntries();
    } catch (err) {
      el.save.disabled = false;
      setStatus(err.message, 'error');
    }
  }
  el.save.addEventListener('click', save);

  async function remove() {
    if (!current) return;
    if (current.isNew) {
      current = null;
      dirty = false;
      el.pane.hidden = true;
      el.empty.hidden = false;
      setStatus('');
      return;
    }
    if (!confirm(`Delete ${current.path}?${me && me.mode === 'github' ? ' This commits the deletion.' : ''}`)) return;
    try {
      await api('DELETE', '/api/entry', { path: current.path, sha: current.sha });
      clearBackup(current.path);
      current = null;
      dirty = false;
      el.pane.hidden = true;
      el.empty.hidden = false;
      history.replaceState(null, '', location.pathname);
      setStatus('Deleted', 'ok');
      await loadEntries();
    } catch (err) {
      setStatus(err.message, 'error');
    }
  }
  el.del.addEventListener('click', remove);

  /** After a commit, follow the site build and say when the entry is live. */
  function watchDeploy(commit, liveHref) {
    clearTimeout(deployTimer);
    if (!me || me.mode !== 'github') return;
    const started = Date.now();
    const live = { href: liveHref, label: 'open it' };
    const tick = async () => {
      if (dirty) return; // the user moved on; stop narrating
      try {
        const d = await api('GET', '/api/deploy?sha=' + commit);
        if (d.status === 'completed') {
          if (d.conclusion === 'success') setStatus('Live on the site.', 'ok', live);
          else setStatus('The site build failed.', 'error', d.url ? { href: d.url, label: 'see why' } : null);
          return;
        }
        setStatus(`Saved · commit ${commit.slice(0, 7)} · the site is rebuilding`, 'ok');
      } catch (e) { /* keep polling */ }
      if (Date.now() - started < 5 * 60 * 1000) deployTimer = setTimeout(tick, 12000);
      else setStatus('Saved. The build is taking longer than usual.', 'ok', live);
    };
    deployTimer = setTimeout(tick, 8000);
  }

  /* ---------- counts, preview ---------- */

  function bodyText() {
    return rawMode ? splitFile(el.text.value).body : el.text.value;
  }

  function updateCounts() {
    const words = bodyText().replace(/<!--[\s\S]*?-->/g, ' ').split(/\s+/).filter(Boolean).length;
    el.counts.textContent = words ? `${words} words · ${Math.max(1, Math.round(words / 220))} min` : '';
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 250);
  }

  function renderPreview() {
    const title = rawMode ? splitFile(el.text.value).data.get('title') : current.data.get('title');
    const byKey = new Map();
    for (const e of entries) {
      for (const k of [e.slug, e.title, mdx.slugify(e.title)]) if (k) byKey.set(String(k).toLowerCase(), e);
    }
    const resolveWikilink = (t) => byKey.get(t.trim().toLowerCase()) || byKey.get(mdx.slugify(t)) || null;
    el.preview.innerHTML = `<h1>${esc(title || '')}</h1>` + mdx.render(bodyText(), { resolveWikilink });
  }

  function setPreview(on) {
    previewOn = on;
    el.previewBtn.setAttribute('aria-pressed', String(on));
    el.preview.hidden = !on;
    el.panes.classList.toggle('split', on);
    try { localStorage.setItem('studio:preview', on ? '1' : '0'); } catch (e) { /* ignore */ }
    if (on && current) renderPreview();
  }
  el.previewBtn.addEventListener('click', () => setPreview(!previewOn));

  /* ---------- formatting ---------- */

  function replaceRangeIn(ta, start, end, text, selectFrom, selectTo) {
    const v = ta.value;
    ta.value = v.slice(0, start) + text + v.slice(end);
    const a = selectFrom === undefined ? start + text.length : selectFrom;
    const b = selectTo === undefined ? a : selectTo;
    ta.setSelectionRange(a, b);
    ta.focus();
  }

  function replaceRange(start, end, text, selectFrom, selectTo) {
    replaceRangeIn(el.text, start, end, text, selectFrom, selectTo);
    markDirty();
    updateCounts();
    if (previewOn) schedulePreview();
  }

  function insertAtCursor(text) {
    replaceRange(el.text.selectionStart, el.text.selectionEnd, text);
  }

  function wrapSelection(before, after, placeholder) {
    const s = el.text.selectionStart;
    const e = el.text.selectionEnd;
    const sel = el.text.value.slice(s, e) || placeholder;
    replaceRange(s, e, before + sel + after, s + before.length, s + before.length + sel.length);
  }

  function prefixLines(prefix, numbered) {
    const v = el.text.value;
    const start = v.lastIndexOf('\n', el.text.selectionStart - 1) + 1;
    let end = v.indexOf('\n', Math.max(el.text.selectionEnd - 1, start));
    if (end === -1) end = v.length;
    const lines = v.slice(start, end).split('\n');
    const re = numbered ? /^\d+\.\s/ : new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const allHave = lines.every((l) => re.test(l));
    const out = lines.map((l, i) => (allHave ? l.replace(re, '') : (numbered ? `${i + 1}. ` : prefix) + l)).join('\n');
    replaceRange(start, end, out, start, start + out.length);
  }

  function format(kind) {
    const sel = el.text.value.slice(el.text.selectionStart, el.text.selectionEnd);
    switch (kind) {
      case 'bold': return wrapSelection('**', '**', 'bold text');
      case 'italic': return wrapSelection('*', '*', 'italic text');
      case 'code': return sel.includes('\n') ? wrapSelection('```\n', '\n```', 'code') : wrapSelection('`', '`', 'code');
      case 'link': return wrapSelection('[', '](https://)', 'link text');
      case 'h2': return prefixLines('## ');
      case 'h3': return prefixLines('### ');
      case 'quote': return prefixLines('> ');
      case 'ul': return prefixLines('- ');
      case 'ol': return prefixLines('1. ', true);
      case 'hr': return insertAtCursor('\n\n---\n\n');
      case 'wikilink': return showPicker('', (e) => insertAtCursor(`[[${e.title}]]`));
      default: return undefined;
    }
  }

  el.toolbar.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-fmt]');
    if (b && current) format(b.dataset.fmt);
  });

  document.addEventListener('keydown', (ev) => {
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === 's') { ev.preventDefault(); save(); return; }
    if (ev.key === 'Escape') { hidePicker(); return; }
    if (!current || document.activeElement !== el.text) return;
    if (mod && ev.key.toLowerCase() === 'b') { ev.preventDefault(); format('bold'); }
    else if (mod && ev.key.toLowerCase() === 'i') { ev.preventDefault(); format('italic'); }
    else if (mod && ev.key.toLowerCase() === 'k') { ev.preventDefault(); format('link'); }
  });

  window.addEventListener('beforeunload', (ev) => {
    if (dirty) {
      ev.preventDefault();
      ev.returnValue = '';
    }
  });

  /* ---------- images: button, paste, drop ---------- */

  const toBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  async function uploadImages(files) {
    if (!current) return;
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 5 * 1024 * 1024) { setStatus(`${file.name} is over 5 MB.`, 'error'); continue; }
      setStatus(`Uploading ${file.name}…`);
      try {
        const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
        const name = /^(image|blob)\.\w+$/i.test(file.name) ? `pasted-${stamp}.${file.name.split('.').pop()}` : file.name;
        const r = await api('POST', '/api/upload', { name, data: await toBase64(file) });
        const alt = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
        insertAtCursor(`![${alt}](${r.url})`);
        setStatus(r.commit ? `Uploaded · commit ${r.commit.slice(0, 7)}` : 'Uploaded', 'ok');
      } catch (err) {
        setStatus(err.message, 'error');
      }
    }
  }

  el.image.addEventListener('change', () => {
    uploadImages([...el.image.files]);
    el.image.value = '';
  });
  el.text.addEventListener('paste', (ev) => {
    const files = [...((ev.clipboardData && ev.clipboardData.files) || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      ev.preventDefault();
      uploadImages(files);
    }
  });
  el.text.addEventListener('dragover', (ev) => ev.preventDefault());
  el.text.addEventListener('drop', (ev) => {
    const files = [...((ev.dataTransfer && ev.dataTransfer.files) || [])];
    if (files.length) {
      ev.preventDefault();
      uploadImages(files);
    }
  });

  /* ---------- wikilink picker ---------- */

  function showPicker(query, onPick) {
    const q = query.toLowerCase();
    const items = entries
      .filter((e) => e.title.toLowerCase().includes(q) || e.slug.includes(q))
      .sort((a, b) => a.title.toLowerCase().indexOf(q) - b.title.toLowerCase().indexOf(q))
      .slice(0, 8);
    if (!items.length) return hidePicker();
    el.picker.innerHTML = items
      .map((e, i) => `<button type="button" data-i="${i}"${i === 0 ? ' class="active"' : ''}>${esc(e.title)}<span class="muted small">${e.kind}${e.draft ? ' · draft' : ''}</span></button>`)
      .join('');
    el.picker.hidden = false;
    el.picker._items = items;
    el.picker._onPick = onPick;
  }

  function hidePicker() {
    el.picker.hidden = true;
    el.picker._items = null;
  }

  function pick(i) {
    const items = el.picker._items;
    if (!items || !items[i]) return;
    const onPick = el.picker._onPick;
    hidePicker();
    onPick(items[i]);
  }

  el.picker.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (b) pick(Number(b.dataset.i));
  });

  /** Arrow keys and Enter drive the picker from whichever text box opened it. */
  function bindPicker(ta) {
    ta.addEventListener('keydown', (ev) => {
      if (el.picker.hidden) return;
      const buttons = [...el.picker.querySelectorAll('button')];
      let idx = Math.max(0, buttons.findIndex((b) => b.classList.contains('active')));
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        buttons[idx].classList.remove('active');
        idx = (idx + (ev.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[idx].classList.add('active');
      } else if (ev.key === 'Enter' || ev.key === 'Tab') {
        ev.preventDefault();
        pick(idx);
      }
    });
  }
  bindPicker(el.text);
  bindPicker(el.thoughtText);

  function maybeAutocomplete(ta = el.text) {
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const m = before.match(/\[\[([^\[\]\n]*)$/);
    if (!m) return hidePicker();
    const start = pos - m[1].length - 2;
    showPicker(m[1], (e) =>
      ta === el.text ? replaceRange(start, pos, `[[${e.title}]]`) : replaceRangeIn(ta, start, pos, `[[${e.title}]]`)
    );
  }

  /* ---------- thoughts: the quick stream ---------- */

  let thoughts = [];

  function hideThoughts() {
    el.thoughts.hidden = true;
    el.thoughtsBtn.classList.remove('active');
  }

  async function showThoughts() {
    if (!confirmDiscard()) return;
    current = null;
    dirty = false;
    el.save.disabled = true;
    el.counts.textContent = '';
    el.pane.hidden = true;
    el.empty.hidden = true;
    el.thoughts.hidden = false;
    el.thoughtsBtn.classList.add('active');
    el.app.classList.remove('show-list');
    history.replaceState(null, '', '#thoughts');
    renderList();
    setStatus('');
    el.thoughtText.focus();
    try {
      thoughts = (await api('GET', '/api/thoughts?limit=50')).thoughts;
      renderStream();
    } catch (err) {
      setStatus(err.message, 'error');
    }
  }
  el.thoughtsBtn.addEventListener('click', showThoughts);

  const prettyStamp = (stamp) => {
    const d = new Date(stamp.replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return stamp;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) + ' · ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  };

  function renderMd(text) {
    const byKey = new Map();
    for (const e of entries) for (const k of [e.slug, e.title, mdx.slugify(e.title)]) if (k) byKey.set(String(k).toLowerCase(), e);
    return mdx.render(text, { resolveWikilink: (t) => byKey.get(t.trim().toLowerCase()) || byKey.get(mdx.slugify(t)) || null });
  }

  function makeButton(label, className, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderStream() {
    el.stream.innerHTML = '';
    if (!thoughts.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Nothing yet. The box above is for whatever is on your mind.';
      el.stream.appendChild(p);
      return;
    }
    for (const t of thoughts) el.stream.appendChild(thoughtCard(t));
  }

  function thoughtCard(t) {
    const card = document.createElement('article');
    card.className = 'thought-card';
    const body = document.createElement('div');
    body.className = 'thought-body prose';
    body.innerHTML = renderMd(t.body);
    const footer = document.createElement('footer');
    const time = document.createElement('time');
    time.textContent = prettyStamp(t.stamp);
    const actions = document.createElement('span');
    actions.className = 'thought-actions';
    actions.appendChild(makeButton('Edit', 'link-button', () => editThought(t, card)));
    actions.appendChild(makeButton('Delete', 'link-button', () => deleteThought(t)));
    footer.appendChild(time);
    footer.appendChild(actions);
    card.appendChild(body);
    card.appendChild(footer);
    return card;
  }

  function editThought(t, card) {
    card.innerHTML = '';
    const ta = document.createElement('textarea');
    ta.className = 'thought-edit';
    ta.rows = 4;
    ta.value = t.body;
    const footer = document.createElement('footer');
    const actions = document.createElement('span');
    actions.className = 'thought-actions';
    actions.appendChild(
      makeButton('Save', 'btn small primary', async () => {
        const text = ta.value.trim();
        if (!text) return;
        setStatus('Saving…');
        try {
          const r = await api('PUT', '/api/thoughts', { id: t.id, text });
          t.body = text;
          renderStream();
          afterThought(r, t, 'Saved');
        } catch (err) {
          setStatus(err.message, 'error');
        }
      })
    );
    actions.appendChild(makeButton('Cancel', 'btn small', () => renderStream()));
    footer.appendChild(actions);
    card.appendChild(ta);
    card.appendChild(footer);
    ta.focus();
  }

  async function deleteThought(t) {
    if (!confirm('Delete this thought?')) return;
    try {
      const r = await api('DELETE', '/api/thoughts', { id: t.id });
      thoughts = thoughts.filter((x) => x.id !== t.id);
      renderStream();
      setStatus(r.commit ? `Deleted · commit ${r.commit.slice(0, 7)}` : 'Deleted', 'ok');
    } catch (err) {
      setStatus(err.message, 'error');
    }
  }

  function afterThought(r, t, verb) {
    if (r.commit) {
      setStatus(`${verb} · commit ${r.commit.slice(0, 7)} · the site is rebuilding`, 'ok');
      watchDeploy(r.commit, me.site + (r.url || t.url || '/thoughts/'));
    } else {
      setStatus(`${verb} to disk`, 'ok');
    }
  }

  async function postThought() {
    const text = el.thoughtText.value.trim();
    if (!text) return;
    const stamp = `${today()} ${nowTime()}:${String(new Date().getSeconds()).padStart(2, '0')}`;
    el.post.disabled = true;
    setStatus('Posting…');
    try {
      const r = await api('POST', '/api/thoughts', { text, stamp });
      const t = { id: r.id, stamp: r.stamp, body: text, url: r.url };
      thoughts.unshift(t);
      el.thoughtText.value = '';
      renderStream();
      afterThought(r, t, 'Posted');
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      el.post.disabled = false;
    }
  }
  el.post.addEventListener('click', postThought);
  el.thoughtText.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
      ev.preventDefault();
      postThought();
    }
  });
  el.thoughtText.addEventListener('input', () => maybeAutocomplete(el.thoughtText));

  /* ---------- local backups (survive a closed tab) ---------- */

  const key = (path) => 'studio:backup:' + path;
  function writeBackup(path, value) { try { localStorage.setItem(key(path), value); } catch (e) { /* ignore */ } }
  function readBackup(path) { try { return localStorage.getItem(key(path)); } catch (e) { return null; } }
  function clearBackup(path) { try { localStorage.removeItem(key(path)); } catch (e) { /* ignore */ } }

  /* ---------- sign out, start ---------- */

  el.logout.addEventListener('click', async () => {
    if (!confirmDiscard()) return;
    await fetch('/auth/logout', { method: 'POST', headers: { 'x-studio': '1' } });
    location.reload();
  });

  async function init() {
    try {
      me = await api('GET', '/api/me');
    } catch (e) {
      return; // the sign-in card is showing
    }
    el.login.hidden = true;
    el.logout.hidden = !me.auth;
    el.site.href = me.site;
    if (me.mode === 'local') setStatus('Local mode: writing straight to the files on this machine', 'info');
    let pref = null;
    try { pref = localStorage.getItem('studio:preview'); } catch (e) { /* ignore */ }
    setPreview(pref === null ? window.innerWidth >= 1100 : pref === '1');
    await loadEntries();
    const h = location.hash.slice(1);
    if (h === 'thoughts') showThoughts();
    else if (h) open(decodeURIComponent(h));
  }

  init();
})();
