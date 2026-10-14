'use strict';
/**
 * studio/server.js: the private writing room for the site.
 *
 *   node studio/server.js            local mode: edits the files in this checkout,
 *                                    no sign-in, only reachable from this machine.
 *                                    Run `npm run dev` alongside it to preview.
 *   node studio/server.js --github   the production flow from your PC: Google
 *                                    sign-in, saves commit to GitHub.
 *
 * In production (Fly.io) it runs in github mode: every save is a commit to the
 * repo through GitHub's API, which triggers the Pages deploy. Google sign-in is
 * required there and only the emails in ALLOWED_EMAILS get in.
 *
 * Configuration is by environment variables (or a studio/.env file locally):
 *   STUDIO_MODE          local | github   (default: github if GITHUB_TOKEN is set)
 *   GITHUB_TOKEN         fine-grained token with Contents read/write on the repo
 *   GITHUB_REPO          owner/name            GITHUB_BRANCH   default "main"
 *   GOOGLE_CLIENT_ID     GOOGLE_CLIENT_SECRET  from Google Cloud Console
 *   ALLOWED_EMAILS       comma-separated       SESSION_SECRET  long random string
 *   BASE_URL             public URL of this app, e.g. https://write.example.com
 *   SITE_URL             where "View site" points     PORT       default 4100
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { LocalStore, GitHubStore, httpError } = require('./store.js');
const auth = require('./auth.js');
const weather = require('./weather.js');
const md = require('../lib/markdown.js');
const C = require('../lib/context.js');
const TH = require('../lib/thoughts.js');

const ROOT = path.resolve(__dirname, '..');
const UI = path.join(__dirname, 'ui');

loadDotEnv(path.join(__dirname, '.env'));
const env = process.env;
const PORT = Number(env.PORT) || 4100;
// `--github` / `--local` on the command line win over STUDIO_MODE.
const MODE = process.argv.includes('--github')
  ? 'github'
  : process.argv.includes('--local')
    ? 'local'
    : env.STUDIO_MODE || (env.GITHUB_TOKEN ? 'github' : 'local');
const BASE_URL = (env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_URL = env.SITE_URL || 'https://evolutionofexistence.com';
const ALLOWED = String(env.ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const GOOGLE =
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: `${BASE_URL}/auth/callback` }
    : null;
const SESSION_SECRET = env.SESSION_SECRET || (GOOGLE ? null : crypto.randomBytes(32).toString('hex'));
const SESSION_DAYS = Number(env.SESSION_DAYS) || 30;
const SECURE = BASE_URL.startsWith('https://');
const MAX_BODY = 8 * 1024 * 1024;
const MAX_IMAGE = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg']);
const ENTRY_PATH = /^content\/(posts|pages)\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;
const IMAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

if (MODE === 'github' && !env.GITHUB_TOKEN) die('GITHUB_TOKEN is required in github mode.');
if (MODE === 'github' && !env.GITHUB_REPO) die('GITHUB_REPO is required in github mode (owner/name).');
if (GOOGLE && !SESSION_SECRET) die('SESSION_SECRET is required when Google sign-in is configured.');
if (GOOGLE && !ALLOWED.length) die('ALLOWED_EMAILS is required when Google sign-in is configured.');
if (!GOOGLE && MODE === 'github') die('Refusing to expose GitHub write access without sign-in. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
// Without sign-in the server only listens on this machine.
const HOST = env.HOST || (GOOGLE ? '0.0.0.0' : '127.0.0.1');

const store =
  MODE === 'github'
    ? new GitHubStore({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO, branch: env.GITHUB_BRANCH || 'main' })
    : new LocalStore(ROOT);

// The site's own config, for the thread chips and its title. Optional.
let siteConfig = {};
try {
  siteConfig = require(path.join(ROOT, 'site.config.js'));
} catch (e) {
  console.warn('studio: site.config.js not found; thread chips will be unavailable');
}

function die(msg) {
  console.error(`studio: ${msg}`);
  process.exit(1);
}

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

/* ---------- http helpers ---------- */

const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https: http:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function json(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(httpError(413, 'request too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(httpError(400, 'body must be JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sameOrigin(req) {
  let origin = req.headers.origin;
  if (!origin && req.headers.referer) {
    try { origin = new URL(req.headers.referer).origin; } catch { origin = null; }
  }
  if (!origin) return true; // the custom header check below still applies
  if (origin === new URL(BASE_URL).origin) return true;
  return !GOOGLE && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/* ---------- who is asking ---------- */

function currentUser(req) {
  if (!GOOGLE) return { email: 'local', name: 'Local' };
  const cookies = auth.parseCookies(req.headers.cookie);
  const session = auth.readSession(SESSION_SECRET, cookies.studio_session);
  return session && ALLOWED.includes(session.email) ? session : null;
}

/* ---------- entries ---------- */

const metaCache = new Map(); // blob sha -> parsed frontmatter summary

async function listEntries() {
  const out = [];
  for (const [dir, kind] of [['content/posts', 'post'], ['content/pages', 'page']]) {
    const files = (await store.list(dir)).filter((f) => f.name.endsWith('.md'));
    for (const f of files) {
      let meta = metaCache.get(f.sha);
      if (!meta) {
        const { content } = await store.read(f.path);
        const { data } = md.parseFrontmatter(content);
        const name = f.name.replace(/\.md$/, '');
        const date = String(data.date || name).match(/^(\d{4}-\d{2}-\d{2})/);
        const slug = data.slug || (kind === 'post' ? name.replace(/^\d{4}-\d{2}-\d{2}-?/, '') || name : name);
        meta = {
          title: data.title || name,
          slug,
          date: date ? date[1] : '',
          draft: data.draft === true,
          tags: Array.isArray(data.tags) ? data.tags : String(data.tags || '').split(',').map((s) => s.trim()).filter(Boolean),
          url: kind === 'post' ? `/blog/${slug}/` : `/${slug}/`,
          context: C.pickContext(data),
        };
        metaCache.set(f.sha, meta);
      }
      out.push({ path: f.path, name: f.name, sha: f.sha, kind, ...meta });
    }
  }
  return out;
}

/* ---------- thoughts: one file per month ---------- */

const thoughtCache = new Map(); // blob sha -> parsed list
const snippet = (text) => text.split('\n')[0].replace(/[#*_`[\]]/g, '').slice(0, 60).trim();

async function readMonth(stamp) {
  const rel = TH.fileFor(stamp);
  try {
    const { content, sha } = await store.read(rel);
    return { rel, sha, list: TH.parse(content) };
  } catch (e) {
    if (e.status !== 404) throw e;
    return { rel, sha: undefined, list: [] };
  }
}

const writeMonth = (month, message) => store.write(month.rel, TH.serialize(month.list), { sha: month.sha, message });

/* ---------- routes ---------- */

async function authRoutes(req, res, url) {
  const p = url.pathname;

  if (p === '/auth/login') {
    if (!GOOGLE) return send(res, 302, '', { Location: '/' });
    const state = crypto.randomBytes(16).toString('base64url');
    return send(res, 302, '', {
      Location: auth.loginUrl({ clientId: GOOGLE.clientId, redirectUri: GOOGLE.redirectUri, state }),
      'Set-Cookie': auth.cookie('studio_state', state, { maxAge: 600, secure: SECURE }),
    });
  }

  if (p === '/auth/callback') {
    if (!GOOGLE) return send(res, 302, '', { Location: '/' });
    const cookies = auth.parseCookies(req.headers.cookie);
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const clearState = auth.cookie('studio_state', '', { maxAge: 0, secure: SECURE });
    if (!code || !state || state !== cookies.studio_state) {
      return send(res, 400, page('Sign-in failed', 'The sign-in attempt did not match. Go back and try again.'), { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': clearState });
    }
    let user;
    try {
      user = await auth.exchangeCode({ ...GOOGLE, code });
    } catch (e) {
      console.error('auth:', e.message);
      return send(res, 502, page('Sign-in failed', 'Google did not complete the sign-in. Try again in a moment.'), { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': clearState });
    }
    if (!user.verified || !ALLOWED.includes(user.email)) {
      console.warn(`auth: refused ${user.email || 'unknown'}`);
      return send(res, 403, page('Not for you', 'This is a private writing room. That Google account is not on the list.'), { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': clearState });
    }
    const session = auth.createSession(SESSION_SECRET, { email: user.email, name: user.name }, SESSION_DAYS * 86400);
    res.setHeader('Set-Cookie', [auth.cookie('studio_session', session, { maxAge: SESSION_DAYS * 86400, secure: SECURE }), clearState]);
    console.log(`auth: ${user.email} signed in`);
    return send(res, 302, '', { Location: '/' });
  }

  if (p === '/auth/logout' && req.method === 'POST') {
    if (req.headers['x-studio'] !== '1') return json(res, 403, { error: 'blocked' });
    return json(res, 200, { ok: true }, { 'Set-Cookie': auth.cookie('studio_session', '', { maxAge: 0, secure: SECURE }) });
  }

  return send(res, 404, 'Not found');
}

async function apiRoutes(req, res, url, user) {
  const p = url.pathname;
  if (req.method !== 'GET' && (req.headers['x-studio'] !== '1' || !sameOrigin(req))) {
    return json(res, 403, { error: 'cross-site request blocked' });
  }

  if (p === '/api/me' && req.method === 'GET') {
    return json(res, 200, {
      email: user.email,
      name: user.name || '',
      auth: Boolean(GOOGLE),
      mode: store.kind,
      store: store.label,
      site: SITE_URL,
      siteTitle: siteConfig.title || '',
      pillars: (siteConfig.pillars || []).map((x) => ({ slug: x.slug, title: x.title, accent: x.accent })),
    });
  }

  // Current weather, by coordinates from the browser or by a typed place name.
  // Coordinates are used for the lookup and then forgotten.
  if (p === '/api/weather' && req.method === 'GET') {
    const lat = parseFloat(url.searchParams.get('lat'));
    const lon = parseFloat(url.searchParams.get('lon'));
    const place = String(url.searchParams.get('place') || '').trim().slice(0, 80);
    let coords = null;
    let placeName = '';
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      coords = { lat, lon };
      placeName = await weather.reverseGeocode(lat, lon);
    } else if (place) {
      const found = await weather.geocode(place);
      if (!found) throw httpError(404, `Couldn't find a place called "${place}".`);
      coords = found;
      placeName = found.name;
    } else {
      throw httpError(400, 'Allow location access, or type a place first.');
    }
    const w = await weather.currentWeather(coords, siteConfig.units || 'imperial');
    return json(res, 200, { place: placeName, weather: w.text, description: w.description, temperature: w.temperature, isDay: w.isDay });
  }

  // Is the site build for a given commit done yet? Lets the editor say "live".
  if (p === '/api/deploy' && req.method === 'GET') {
    const sha = String(url.searchParams.get('sha') || '');
    if (!/^[0-9a-f]{7,40}$/.test(sha)) throw httpError(400, 'bad sha');
    if (store.kind !== 'github') return json(res, 200, { status: 'local' });
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'eoe-studio', 'X-GitHub-Api-Version': '2022-11-28' };
    const runsUrl = `https://api.github.com/repos/${store.repo}/actions/runs?head_sha=${sha}&per_page=1`;
    let r = await fetch(runsUrl, { headers: { ...headers, Authorization: `Bearer ${store.token}` } });
    if (r.status === 401 || r.status === 403) r = await fetch(runsUrl, { headers }); // public repo: try without the token
    if (!r.ok) return json(res, 200, { status: 'unknown' });
    const run = ((await r.json()).workflow_runs || [])[0];
    return json(res, 200, run ? { status: run.status, conclusion: run.conclusion, url: run.html_url } : { status: 'pending' });
  }

  if (p === '/api/entries' && req.method === 'GET') {
    return json(res, 200, { entries: await listEntries() });
  }

  if (p === '/api/entry' && req.method === 'GET') {
    const rel = url.searchParams.get('path') || '';
    if (!ENTRY_PATH.test(rel)) throw httpError(400, 'not an entry path');
    const { content, sha } = await store.read(rel);
    return json(res, 200, { path: rel, sha, content });
  }

  if (p === '/api/entry' && req.method === 'PUT') {
    const body = await readBody(req);
    const rel = String(body.path || '');
    if (!ENTRY_PATH.test(rel)) throw httpError(400, 'not an entry path');
    if (typeof body.content !== 'string') throw httpError(400, 'content must be a string');
    const content = body.content.replace(/\r\n?/g, '\n');
    const title = md.parseFrontmatter(content).data.title || rel;
    const message = String(body.message || `Studio: update ${title}`).slice(0, 200);
    const r = await store.write(rel, content, { sha: body.sha || undefined, message });
    metaCache.delete(body.sha);
    console.log(`${user.email}: wrote ${rel}${r.commit ? ` (${r.commit.slice(0, 7)})` : ''}`);
    return json(res, 200, r);
  }

  if (p === '/api/entry' && req.method === 'DELETE') {
    const body = await readBody(req);
    const rel = String(body.path || '');
    if (!ENTRY_PATH.test(rel)) throw httpError(400, 'not an entry path');
    await store.remove(rel, { sha: body.sha, message: `Studio: delete ${rel}` });
    console.log(`${user.email}: deleted ${rel}`);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/upload' && req.method === 'POST') {
    const body = await readBody(req);
    const original = String(body.name || 'image');
    const ext = (original.match(/\.([A-Za-z0-9]+)$/) || [, ''])[1].toLowerCase();
    if (!IMAGE_TYPES.has(ext)) throw httpError(400, `images only (${[...IMAGE_TYPES].join(', ')})`);
    const base = md.slugify(original.replace(/\.[^.]+$/, '')) || 'image';
    const name = `${base}.${ext === 'jpeg' ? 'jpg' : ext}`;
    if (!IMAGE_NAME.test(name)) throw httpError(400, 'bad file name');
    const buf = Buffer.from(String(body.data || ''), 'base64');
    if (!buf.length) throw httpError(400, 'empty file');
    if (buf.length > MAX_IMAGE) throw httpError(413, 'images must be under 5 MB');
    const rel = `static/images/${name}`;
    let sha;
    try { sha = (await store.read(rel, { binary: true })).sha; } catch (e) { if (e.status !== 404) throw e; }
    const r = await store.write(rel, buf, { sha, message: `Studio: upload ${name}` });
    console.log(`${user.email}: uploaded ${rel}`);
    return json(res, 200, { url: `/images/${name}`, path: rel, sha: r.sha, commit: r.commit });
  }

  if (p === '/api/thoughts' && req.method === 'GET') {
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const files = (await store.list('content/thoughts'))
      .filter((f) => /^\d{4}-\d{2}\.md$/.test(f.name))
      .sort((a, b) => b.name.localeCompare(a.name));
    const all = [];
    for (const f of files) {
      let parsed = thoughtCache.get(f.sha);
      if (!parsed) {
        parsed = TH.parse((await store.read(f.path)).content);
        thoughtCache.set(f.sha, parsed);
      }
      all.push(...parsed.map((t) => ({ ...t, file: f.path, url: `/thoughts/${TH.monthOf(t.stamp)}/#${t.id}` })));
      if (all.length >= limit) break;
    }
    all.sort((a, b) => b.stamp.localeCompare(a.stamp));
    return json(res, 200, { thoughts: all.slice(0, limit) });
  }

  if (p === '/api/thoughts' && req.method === 'POST') {
    const body = await readBody(req);
    const text = String(body.text || '').replace(/\r\n?/g, '\n').trim();
    const stamp = String(body.stamp || '');
    if (!text) throw httpError(400, 'nothing to post');
    if (text.length > 20000) throw httpError(413, 'that is a post, not a thought');
    if (!TH.isStamp(stamp)) throw httpError(400, 'bad timestamp');
    const month = await readMonth(stamp);
    if (month.list.some((t) => t.stamp === stamp)) throw httpError(409, 'two thoughts in the same second; try again');
    month.list.push({ stamp, body: text });
    month.list.sort((a, b) => a.stamp.localeCompare(b.stamp));
    const r = await writeMonth(month, `Thought: ${snippet(text)}`);
    thoughtCache.delete(month.sha);
    const id = TH.idOf(stamp);
    console.log(`${user.email}: thought ${id}`);
    return json(res, 200, { id, stamp, url: `/thoughts/${TH.monthOf(stamp)}/#${id}`, sha: r.sha, commit: r.commit });
  }

  if (p === '/api/thoughts' && (req.method === 'PUT' || req.method === 'DELETE')) {
    const body = await readBody(req);
    const stamp = TH.stampOfId(body.id);
    if (!stamp) throw httpError(400, 'bad id');
    const month = await readMonth(stamp);
    const idx = month.list.findIndex((t) => t.stamp === stamp);
    if (idx === -1) throw httpError(404, 'no such thought');
    const id = TH.idOf(stamp);
    let r = {};
    if (req.method === 'PUT') {
      const text = String(body.text || '').replace(/\r\n?/g, '\n').trim();
      if (!text) throw httpError(400, 'nothing left; delete it instead');
      month.list[idx].body = text;
      r = await writeMonth(month, `Thought: edit ${snippet(text)}`);
    } else {
      month.list.splice(idx, 1);
      r = month.list.length
        ? await writeMonth(month, `Thought: remove ${id}`)
        : await store.remove(month.rel, { sha: month.sha, message: `Thought: remove ${id}` });
    }
    thoughtCache.delete(month.sha);
    console.log(`${user.email}: thought ${req.method === 'PUT' ? 'edited' : 'deleted'} ${id}`);
    return json(res, 200, { ok: true, sha: r.sha || null, commit: r.commit || null });
  }

  return json(res, 404, { error: 'no such endpoint' });
}

const UI_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/studio.css': ['studio.css', 'text/css; charset=utf-8'],
};

function serveUi(req, res, p) {
  if (p === '/lib/markdown.js') {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'markdown.js'), 'utf8');
    const wrapped = `(function(){var module={exports:{}};\n${src}\nwindow.markdown=module.exports;})();`;
    return send(res, 200, wrapped, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
  }
  const hit = UI_FILES[p];
  if (!hit) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  return send(res, 200, fs.readFileSync(path.join(UI, hit[0])), { 'Content-Type': hit[1], 'Cache-Control': 'no-cache' });
}

function page(title, text) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/studio.css"><div class="login"><div class="card"><h1>${title}</h1><p>${text}</p><a class="btn" href="/">Back</a></div></div>`;
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, BASE_URL);
  } catch {
    return send(res, 400, 'Bad request');
  }
  try {
    if (url.pathname.startsWith('/auth/')) return await authRoutes(req, res, url);
    if (url.pathname.startsWith('/api/')) {
      const user = currentUser(req);
      if (!user) return json(res, 401, { error: 'sign in required' });
      return await apiRoutes(req, res, url, user);
    }
    return serveUi(req, res, url.pathname);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    return json(res, status, { error: e.message || 'something went wrong' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`studio: ${store.kind} mode, writing to ${store.label}`);
  console.log(`studio: ${GOOGLE ? `Google sign-in on, allowed: ${ALLOWED.join(', ')}` : 'no sign-in (local only)'}`);
  console.log(`studio: listening on http://${HOST}:${PORT}  (public URL ${BASE_URL})`);
});
