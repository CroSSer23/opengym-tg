/* Verifying that a Telegram Mini App really is talking to us.
 *
 * A Mini App is just a web page Telegram opens in a WebView, so the only thing separating
 * "this is user 12345" from "someone typed 12345 into a request" is the signature Telegram
 * attaches to the launch parameters. That check is this file, and it is the entire basis of
 * the Telegram sign-in path -- get it wrong and the bot token becomes a password anyone can
 * mint sessions with.
 *
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
import crypto from 'node:crypto';

/** How old a launch may be before it is refused. Telegram keeps initData fixed for the life of
 *  a Mini App session, so this cannot be minutes: it would sign people out mid-workout. */
export const DEFAULT_MAX_AGE_S = 24 * 3600;

// `hash` is the signature itself. `signature` is Telegram's separate Ed25519 field for
// third-party validation, added later and explicitly excluded from the HMAC's check string --
// including it makes every launch from a current client fail.
const NOT_SIGNED = new Set(['hash', 'signature']);

/** HMAC-SHA256 as hex, the shape Telegram uses throughout. */
const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest();

/**
 * The canonical string Telegram signed: every other parameter as `k=v`, sorted by key,
 * newline-joined. Exported for the tests, which is the only reason it is not inlined.
 */
export function dataCheckString(params) {
  return [...params.entries()]
    .filter(([k]) => !NOT_SIGNED.has(k))
    .map(([k, v]) => k + '=' + v)
    .sort()
    .join('\n');
}

const equalHex = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); }
  catch { return false; }
};

/**
 * Check one `initData` string against a bot token.
 * Returns { ok:true, user, authDate, startParam } or { ok:false, error } -- never throws, and
 * never reports *why* a signature failed beyond "bad signature": the caller is an unauthenticated
 * HTTP route and the difference between "wrong hash" and "no hash" is not the client's business.
 */
export function verifyInitData(initData, botToken, { maxAgeSeconds = DEFAULT_MAX_AGE_S, now = Date.now() } = {}) {
  if (!botToken) return { ok: false, error: 'telegram sign-in is not configured' };
  if (typeof initData !== 'string' || !initData) return { ok: false, error: 'no launch parameters' };
  if (initData.length > 8192) return { ok: false, error: 'launch parameters are implausibly large' };

  let params;
  try { params = new URLSearchParams(initData); }
  catch { return { ok: false, error: 'bad launch parameters' }; }

  const hash = params.get('hash');
  if (!hash) return { ok: false, error: 'bad signature' };

  // The token is the message, not the key: this is what stops a signature made for one bot from
  // validating against another.
  const secret = hmac('WebAppData', botToken);
  if (!equalHex(hash, hmac(secret, dataCheckString(params)).toString('hex'))) {
    return { ok: false, error: 'bad signature' };
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, error: 'bad signature' };
  const ageSeconds = now / 1000 - authDate;
  // A future-dated launch is either a clock skew or a replay; a small allowance covers the first.
  if (ageSeconds < -300) return { ok: false, error: 'this launch is dated in the future' };
  if (ageSeconds > maxAgeSeconds) return { ok: false, error: 'this launch has expired -- reopen the app from Telegram' };

  let user;
  try { user = JSON.parse(params.get('user') || 'null'); }
  catch { return { ok: false, error: 'bad launch parameters' }; }
  // A launch from an inline context or a channel carries no user, and there is nobody to sign in.
  if (!user || !Number.isInteger(user.id)) return { ok: false, error: 'this launch carries no Telegram account' };
  if (user.is_bot) return { ok: false, error: 'bots cannot have a training plan' };

  return {
    ok: true,
    authDate,
    startParam: params.get('start_param') || null,
    user: {
      id: user.id,
      firstName: String(user.first_name || '').slice(0, 64),
      lastName: String(user.last_name || '').slice(0, 64),
      username: user.username ? String(user.username).slice(0, 32) : null,
      language: user.language_code ? String(user.language_code).slice(0, 8) : null
    }
  };
}

/** The profile name a new Telegram sign-up gets, in the app's 40-character budget. */
export function displayName(u) {
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return (full || (u.username ? '@' + u.username : '') || 'Athlete').slice(0, 40);
}