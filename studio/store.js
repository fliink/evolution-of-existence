'use strict';
/**
 * studio/store.js: where the studio reads and writes files.
 *
 *   LocalStore   the checkout on disk. Used when running on your own machine;
 *                the site's dev server picks up changes instantly.
 *   GitHubStore  the repository on GitHub, through the Contents API. Used in
 *                production: every save is a commit, and GitHub Pages redeploys.
 *
 * Both expose the same four calls:
 *   list(dir)                               -> [{ path, name, sha, size }]
 *   read(path, { binary })                  -> { content, sha }
 *   write(path, content, { sha, message })  -> { sha, commit }
 *   remove(path, { sha, message })          -> {}
 *
 * `sha` is the git blob id of the version you read. Passing it on write guards
 * against overwriting a change made somewhere else in the meantime.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Same id git would give this content, so local and GitHub stores agree. */
const blobSha = (buf) =>
  crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

class LocalStore {
  constructor(root) {
    this.root = path.resolve(root);
    this.kind = 'local';
    this.label = this.root;
  }

  abs(rel) {
    const p = path.resolve(this.root, rel);
    if (p !== this.root && !p.startsWith(this.root + path.sep)) throw httpError(400, 'path escapes the project');
    return p;
  }

  async list(dir) {
    const d = this.abs(dir);
    if (!fs.existsSync(d)) return [];
    return fs
      .readdirSync(d, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const buf = fs.readFileSync(path.join(d, e.name));
        return { path: `${dir}/${e.name}`, name: e.name, sha: blobSha(buf), size: buf.length };
      });
  }

  async read(rel, { binary = false } = {}) {
    const file = this.abs(rel);
    if (!fs.existsSync(file)) throw httpError(404, `${rel} not found`);
    const buf = fs.readFileSync(file);
    return { content: binary ? buf : buf.toString('utf8'), sha: blobSha(buf) };
  }

  async write(rel, content, { sha } = {}) {
    const file = this.abs(rel);
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    if (fs.existsSync(file)) {
      if (!sha) throw httpError(409, `${rel} already exists`);
      if (blobSha(fs.readFileSync(file)) !== sha) throw httpError(409, `${rel} changed since you opened it; reload it first`);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    return { sha: blobSha(buf), commit: null };
  }

  async remove(rel) {
    const file = this.abs(rel);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return {};
  }
}

class GitHubStore {
  constructor({ token, repo, branch = 'main' }) {
    if (!token || !repo) throw new Error('GitHubStore needs a token and a repo (owner/name)');
    this.token = token;
    this.repo = repo;
    this.branch = branch;
    this.kind = 'github';
    this.label = `${repo} @ ${branch}`;
  }

  async api(method, url, body) {
    const res = await fetch(`https://api.github.com${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'eoe-studio',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) throw httpError(404, 'not found on GitHub');
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      const status = res.status === 409 || res.status === 422 ? 409 : 502;
      throw httpError(status, `GitHub answered ${res.status}: ${text}`);
    }
    return res.status === 204 ? null : res.json();
  }

  contentsUrl(rel) {
    return `/repos/${this.repo}/contents/${rel.split('/').map(encodeURIComponent).join('/')}`;
  }

  async list(dir) {
    let items;
    try {
      items = await this.api('GET', `${this.contentsUrl(dir)}?ref=${encodeURIComponent(this.branch)}`);
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
    return (Array.isArray(items) ? items : [])
      .filter((i) => i.type === 'file')
      .map((i) => ({ path: i.path, name: i.name, sha: i.sha, size: i.size }));
  }

  async read(rel, { binary = false } = {}) {
    const item = await this.api('GET', `${this.contentsUrl(rel)}?ref=${encodeURIComponent(this.branch)}`);
    const buf = Buffer.from(item.content || '', 'base64');
    return { content: binary ? buf : buf.toString('utf8'), sha: item.sha };
  }

  async write(rel, content, { sha, message } = {}) {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const body = { message: message || `Update ${rel}`, content: buf.toString('base64'), branch: this.branch };
    if (sha) body.sha = sha;
    const r = await this.api('PUT', this.contentsUrl(rel), body);
    return { sha: r.content.sha, commit: r.commit.sha };
  }

  async remove(rel, { sha, message } = {}) {
    if (!sha) throw httpError(400, 'sha is required to delete');
    await this.api('DELETE', this.contentsUrl(rel), { message: message || `Delete ${rel}`, sha, branch: this.branch });
    return {};
  }
}

module.exports = { LocalStore, GitHubStore, httpError, blobSha };
