# Studio: write from anywhere

A private editor for the site. Sign in with Google, write Markdown, press Save, and the change is committed to the repo. GitHub Pages rebuilds the site a minute later. It runs on Fly.io, scales to zero when idle, and has no dependencies beyond Node.

```
npm run studio          # local mode on http://localhost:4100 (no sign-in, edits this checkout)
npm run studio:github   # the production flow from your PC: Google sign-in, saves commit to GitHub
npm run studio:deploy   # ship to Fly (after the one-time setup below)
```

Run it next to `npm run dev` on your PC and you get the editor on one tab and the live site on another.

## How it works

- `server.js` is a plain Node HTTP server: sign-in, a small JSON API, and the editor's static files.
- `store.js` is where files come from. Locally that's the folder on disk; in production it's GitHub's Contents API, so every save is a commit under your account.
- `auth.js` is Google sign-in done by hand (authorization code flow) and HMAC-signed session cookies. Only the addresses in `ALLOWED_EMAILS` are let in.
- `ui/` is the editor. The frontmatter shows up as fields (title, date, thread chips and tags, summary; lede, description and updated for pages) and the text box holds only the writing; a Raw toggle exposes the whole file. Live preview uses the site's own `lib/markdown.js`. A formatting bar and Ctrl+B / Ctrl+I / Ctrl+K cover the basics; typing `[[` searches your titles. Images upload into `static/images/` from the button, from a paste, or from a drop. New entries start as drafts and aren't written until you save. In production the status line follows the site build after a save and says when the entry is live. Unsaved text is backed up in the browser.
- **Thoughts** in the sidebar opens the stream: a compose box (Ctrl+Enter posts) and the latest fifty with edit and delete. Each post appends to that month's file in `content/thoughts/` and commits as "Thought: first few words".
- The "While writing" group in the details panel holds time (filled in for new posts), place (remembers your last one), weather, and what you were listening to, watching and reading, plus a mood. Fetch asks the browser for your location and looks up current conditions through `weather.js` (Open-Meteo for weather, OpenStreetMap for the city name; no accounts, nothing stored). Only the text you see is saved, and it's public on the post. Previous values appear as suggestions.

Guard rails: it refuses to start in GitHub mode without sign-in configured; without sign-in it only listens on `127.0.0.1`; writes are limited to `content/posts`, `content/pages` and `static/images`; a save includes the file's version so two edits can't silently overwrite each other; state-of-the-art-boring CSRF checks on every write.

## One-time setup

### 1. GitHub token

GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
Repository access: only `evolution-of-existence`. Permissions: **Contents: Read and write**. Set an expiry you'll remember to renew (a year is fine).

### 2. Google sign-in

[console.cloud.google.com](https://console.cloud.google.com) → create or pick a project → APIs & Services.

- **OAuth consent screen**: External. App name "Studio". Add your Gmail address under Test users. Leaving the app in "Testing" status is ideal: only test users can sign in at all.
- **Credentials** → Create credentials → OAuth client ID → Web application. Authorized redirect URIs:
  - `https://write.evolutionofexistence.com/auth/callback`
  - `http://localhost:4100/auth/callback` (only if you want sign-in locally too)

Copy the client ID and client secret.

### 3. Fly

`fly.toml` and the `Dockerfile` sit at the repo root, because the image needs `lib/` as well as `studio/`. Run these from the repo root:

```
fly auth login
fly apps create eoe-studio                       # pick another name if taken, and update fly.toml
grep -E '^(GITHUB_TOKEN|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|SESSION_SECRET)=' studio/.env | fly secrets import
fly deploy
fly certs add write.evolutionofexistence.com
```

The `secrets import` line reads the values from `studio/.env` so they never appear on the command line. Then at your DNS provider add a CNAME: `write` → `eoe-studio.fly.dev`. Fly issues the certificate once it sees the record. Open `https://write.evolutionofexistence.com`, sign in, write.

To change who can sign in or the branch it writes to, edit `[env]` in `fly.toml` and redeploy. To rotate a secret: `fly secrets set GITHUB_TOKEN=...` and the app restarts with it.

## Local sign-in (optional)

Local mode needs no accounts. If you'd like to test the Google flow on your PC, create `studio/.env` (it's git-ignored):

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
ALLOWED_EMAILS=you@gmail.com
SESSION_SECRET=any-long-random-string
```

The same file can hold `GITHUB_TOKEN` and `GITHUB_REPO` to run GitHub mode from your PC.
