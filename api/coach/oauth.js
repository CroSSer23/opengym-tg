/* Connecting the instance to the provider, from the admin dashboard, without a terminal.
 *
 * This is a standard OAuth 2.0 authorization-code + PKCE exchange against the provider's own
 * CLI client. Two things about it are worth knowing before changing anything here:
 *
 *  1. The redirect target is the provider's code-display page, not this instance. A
 *     self-hosted openGym has no domain the provider has ever heard of, so it cannot be a
 *     registered redirect URI — the admin copies the one-time code the provider shows them
 *     and pastes it back. One paste, and it is part of the provider's flow rather than ours.
 *
 *  2. The client parameters below belong to the CLI, and the CLI is pinned in the Dockerfile.
 *     They are verified against that exact version; bumping the pin means re-checking this
 *     block, which is why it is one block and not spread through the file. If the flow ever
 *     stops working, the API-key path in the same admin card keeps the feature usable while
 *     it is fixed.
 */
import crypto from 'node:crypto';
import { load, save, encrypt, decrypt, providerMeta } from './config.js';

// Verified against @anthropic-ai/claude-code 2.0.x (the version pinned in api/Dockerfile).
const CLIENT = {
  claude: {
    id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    authorize: 'https://claude.ai/oauth/authorize',
    token: 'https://console.anthropic.com/v1/oauth/token',
    redirect: 'https://console.anthropic.com/oauth/code/callback',
    scope: 'org:create_api_key user:profile user:inference'
  }
};

const pending = new Map();   // state -> { verifier, provider, exp }
const TTL = 10 * 60000;      // the admin has to sign in and copy a code — 5 minutes is tight
setInterval(() => { for (const [k, v] of pending) if (v.exp < Date.now()) pending.delete(k); }, 60000).unref();

const b64u = buf => buf.toString('base64url');

/** Step 1: hand the admin a URL to open. Returns { url, state }. */
export function start() {
  const cfg = load();
  const client = CLIENT[cfg.provider];
  if (!client) throw new Error('this provider does not support browser sign-in — use an API key');
  const verifier = b64u(crypto.randomBytes(32));
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const state = b64u(crypto.randomBytes(16));
  pending.set(state, { verifier, provider: cfg.provider, exp: Date.now() + TTL });
  const url = new URL(client.authorize);
  url.searchParams.set('code', 'true');
  url.searchParams.set('client_id', client.id);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', client.redirect);
  url.searchParams.set('scope', client.scope);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  return { url: url.toString(), state };
}

/**
 * Step 2: exchange the pasted code. The provider's code-display page shows `<code>#<state>`;
 * accept either that or the bare code, because which one lands in the clipboard depends on
 * how carefully the admin selected the text — and failing on a trailing fragment would be a
 * miserable way to end an otherwise clean flow.
 */
export async function finish(rawCode, state) {
  const entry = pending.get(state);
  if (!entry) throw new Error('this sign-in expired — start again');
  pending.delete(state);
  const client = CLIENT[entry.provider];
  const [code, statePart] = String(rawCode || '').trim().split('#');
  if (!code) throw new Error('paste the code the provider showed you');
  const res = await fetch(client.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      state: statePart || state,
      client_id: client.id,
      redirect_uri: client.redirect,
      code_verifier: entry.verifier
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `the provider refused the code (HTTP ${res.status})`);
  }
  store(data);
  return { account: data.account?.email_address || data.account?.uuid || null };
}

function store(data, keepRefresh) {
  save({
    auth: {
      type: 'oauth',
      connectedAt: new Date().toISOString(),
      account: data.account?.email_address || data.account?.uuid || null,
      data: encrypt({
        token: data.access_token,
        refresh: data.refresh_token || keepRefresh || null,
        expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null
      })
    }
  });
}

/** API-key path: same storage, different env var at job time (config.jobEnv). */
export function setApiKey(k) {
  const keyStr = String(k || '').trim();
  if (!keyStr) throw new Error('paste an API key');
  if (!providerMeta().apiKeyEnv) throw new Error('this provider takes no API key');
  save({ auth: { type: 'apikey', connectedAt: new Date().toISOString(), account: null, data: encrypt({ token: keyStr }) } });
}

export function disconnect() { save({ auth: null }); }

/**
 * Refresh shortly before expiry, once at a time. Called on the path to every job rather than
 * on a timer: an instance that trains nobody for a month should not be waking up to renew a
 * token it isn't using, and the first job after that month can afford one HTTP round-trip.
 */
let refreshing = null;
export async function ensureFresh() {
  const cfg = load();
  if (cfg.auth?.type !== 'oauth') return;
  const auth = decrypt(cfg.auth.data);
  if (!auth?.expiresAt || auth.expiresAt - Date.now() > 5 * 60000) return;
  if (!auth.refresh) return;                 // nothing to refresh with — let the job fail honestly
  if (refreshing) return refreshing;
  const client = CLIENT[cfg.provider];
  refreshing = (async () => {
    try {
      const res = await fetch(client.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: auth.refresh, client_id: client.id })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.access_token) store(data, auth.refresh);
      else save({ auth: { ...cfg.auth, expired: true } });
    } catch { /* offline: leave the credential alone and let the job report the real failure */ }
    finally { refreshing = null; }
  })();
  return refreshing;
}

/** Admin-card view of the credential. Never returns the token itself. */
export function authStatus() {
  const cfg = load();
  if (cfg.provider === 'fixture' || cfg.provider === 'custom') return { state: 'not-required' };
  if (!cfg.auth) return { state: 'disconnected' };
  const auth = decrypt(cfg.auth.data);
  if (!auth) return { state: 'unreadable' };   // ./data restored without its secret file
  if (cfg.auth.expired) return { state: 'expired', account: cfg.auth.account, connectedAt: cfg.auth.connectedAt };
  return {
    state: 'connected', type: cfg.auth.type, account: cfg.auth.account,
    connectedAt: cfg.auth.connectedAt, expiresAt: auth.expiresAt || null
  };
}
