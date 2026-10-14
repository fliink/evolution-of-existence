'use strict';
/**
 * studio/auth.js: Google sign-in and signed session cookies, no libraries.
 *
 * Flow: /auth/login sends the browser to Google with a random `state` kept in
 * a short-lived cookie. Google sends the browser back to /auth/callback with a
 * code; the server swaps it for tokens, asks Google who the user is, checks the
 * email against the allowlist, and sets a session cookie signed with HMAC.
 */
const crypto = require('crypto');

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';

const sign = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

/* ---------- sessions ---------- */

function createSession(secret, payload, maxAgeSeconds) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + maxAgeSeconds * 1000 })).toString('base64url');
  return `${body}.${sign(secret, body)}`;
}

function readSession(secret, token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = sign(secret, body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

/* ---------- cookies ---------- */

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name, value, { maxAge, secure, path = '/' } = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax'];
  if (maxAge !== undefined) bits.push(`Max-Age=${maxAge}`);
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

/* ---------- Google ---------- */

function loginUrl({ clientId, redirectUri, state }) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH}?${q}`;
}

/** Trades the one-time code for tokens and returns who signed in. */
async function exchangeCode({ clientId, clientSecret, redirectUri, code }) {
  const tokenRes = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) throw new Error(`Google token exchange failed (${tokenRes.status})`);
  const tokens = await tokenRes.json();

  const infoRes = await fetch(GOOGLE_USERINFO, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  if (!infoRes.ok) throw new Error(`Google userinfo failed (${infoRes.status})`);
  const user = await infoRes.json();
  return {
    email: String(user.email || '').toLowerCase(),
    verified: user.email_verified === true,
    name: user.name || '',
  };
}

module.exports = { createSession, readSession, parseCookies, cookie, loginUrl, exchangeCode };
