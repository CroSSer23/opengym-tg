/* Coach instance configuration — the one place that knows whether this instance offers the
   AI Coach at all, which provider drives it, and how to authenticate to it.

   Everything lives in ./data/coach.json rather than the environment, because the whole point
   of the admin-dashboard flow is that enabling the Coach never requires editing a file or
   restarting the stack. The one env knob is COACH_DISABLED, which force-disables the feature
   regardless of what is stored — a fleet operator's kill switch, not a configuration step.

   The provider credential is encrypted at rest with a key derived from ./data/secret (the
   same file that already signs session cookies, generated 0600 on first boot). That does not
   defend against someone who owns the box — nothing can — but it does mean a coach.json that
   leaks on its own, in a backup or a screenshot, is not a working credential. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA, 'coach.json');
export const COACH_DISABLED = /^(1|true|yes|on)$/i.test(process.env.COACH_DISABLED || '');

// Providers this build can drive. `cli` is the binary the adapter spawns; `envVar` is how the
// credential reaches it. Adding one is an adapter file plus a row here — nothing else in the
// codebase branches on provider identity.
export const PROVIDERS = {
  claude: { label: 'Claude Code', cli: 'claude', oauth: true, apiKeyEnv: 'ANTHROPIC_API_KEY', oauthEnv: 'CLAUDE_CODE_OAUTH_TOKEN' },
  gemini: { label: 'Gemini CLI', cli: 'gemini', oauth: false, apiKeyEnv: 'GEMINI_API_KEY', oauthEnv: null },
  codex: { label: 'OpenAI Codex CLI', cli: 'codex', oauth: false, apiKeyEnv: 'OPENAI_API_KEY', oauthEnv: null },
  // Owner-supplied command honouring the same contract (FR-03): prompt file path as argv[1],
  // JSON on stdout. `scripts/coach-fixture-cli.mjs` is the reference implementation.
  custom: { label: 'Custom command', cli: null, oauth: false, apiKeyEnv: null, oauthEnv: null },
  // Test-only: drives the in-repo fixture CLI. Selectable so an instance can be exercised
  // end-to-end (and demoed) without any AI account at all.
  fixture: { label: 'Fixture (testing)', cli: null, oauth: false, apiKeyEnv: null, oauthEnv: null }
};

const DEFAULTS = {
  enabled: false,
  provider: 'claude',
  model: null,
  customCommand: null,
  auth: null,                                    // { type:'oauth'|'apikey', data:<encrypted> }
  caps: { perProfileDaily: 10, instanceDaily: 0 },   // 0 = unlimited
  log: []
};
const LOG_MAX = 100;

/* ---------- at-rest encryption ---------- */

let keyCache = null;
function key() {
  if (keyCache) return keyCache;
  // Read the secret lazily: server.js creates it at boot, and this module may be imported first.
  const secret = fs.readFileSync(path.join(DATA, 'secret'), 'utf8').trim();
  keyCache = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), Buffer.from('opengym-coach-v1'), 32));
  return keyCache;
}
export function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
export function decrypt(blob) {
  try {
    const buf = Buffer.from(String(blob || ''), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
  } catch { return null; }   // wrong key (restored ./data without the secret), or tampered file
}

/* ---------- load / save ---------- */

let cache = null;
function atomicWrite(file, content, mode) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}
export function load() {
  if (cache) return cache;
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* absent = feature off */ }
  cache = { ...DEFAULTS, ...stored, caps: { ...DEFAULTS.caps, ...(stored.caps || {}) } };
  return cache;
}
export function save(patch) {
  const next = { ...load(), ...patch };
  cache = next;
  atomicWrite(FILE, JSON.stringify(next, null, 2), 0o600);
  return next;
}
// Test seam: forget the in-memory copy so the next load() re-reads from disk.
export function reset() { cache = null; keyCache = null; }

/* ---------- derived state ---------- */

export const providerMeta = cfg => PROVIDERS[(cfg || load()).provider] || PROVIDERS.claude;

/** Is the feature switched on at all (before asking whether it can actually reach a model)? */
export function isEnabled() {
  if (COACH_DISABLED) return false;
  const cfg = load();
  return !!cfg.enabled && !!PROVIDERS[cfg.provider];
}
/** Credentials present? `custom` and `fixture` carry their own auth (or need none). */
export function isConnected() {
  const cfg = load();
  if (!isEnabled()) return false;
  if (cfg.provider === 'fixture' || cfg.provider === 'custom') return true;
  return !!(cfg.auth && decrypt(cfg.auth.data));
}
/** What /api/config tells every client. Absent ⇒ no Coach UI exists anywhere (FR-55/56). */
export function publicConfig() {
  if (!isEnabled() || !isConnected()) return null;
  const cfg = load();
  return { enabled: true, provider: cfg.provider, providerLabel: providerMeta(cfg).label };
}

/**
 * The environment a job's CLI process gets. Deliberately built from nothing rather than
 * filtered from process.env: the child must not inherit RP_ID, ADMIN_UIDS, VAPID material or
 * anything else this server happens to hold.
 */
export function jobEnv(jobDir) {
  const cfg = load();
  const meta = providerMeta(cfg);
  const env = { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', HOME: jobDir, TMPDIR: jobDir };
  const auth = cfg.auth ? decrypt(cfg.auth.data) : null;
  if (auth && auth.token) {
    const name = cfg.auth.type === 'oauth' ? meta.oauthEnv : meta.apiKeyEnv;
    if (name) env[name] = auth.token;
  }
  return env;
}

/* ---------- instance-level job log (counts and outcomes only, never contents — FR-12/42) ---------- */

export function logJob(entry) {
  const cfg = load();
  const log = [...(cfg.log || []), entry].slice(-LOG_MAX);
  save({ log });
}
export const lastError = () => [...(load().log || [])].reverse().find(e => e.outcome === 'failed') || null;
export const lastSuccess = () => [...(load().log || [])].reverse().find(e => e.outcome === 'ready' || e.outcome === 'nochange') || null;
