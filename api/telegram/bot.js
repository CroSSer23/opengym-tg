/* The Telegram side of the bot: one Bot API client, one long-polling loop, and the two
 * outbound things LiftMate ever does -- greet someone who opened the chat, and tell someone
 * their rest is over.
 *
 * Long polling rather than a webhook, deliberately. A webhook needs a publicly resolvable
 * HTTPS URL, a secret header and a route that is reachable before anyone has signed in; a
 * self-hoster behind a tunnel, on a LAN, or halfway through setting up DNS has none of that,
 * and the failure mode is a bot that silently never answers. getUpdates works from anywhere
 * outbound traffic works, which is the same bar the rest of this app sets.
 *
 * Nothing here is allowed to take the server down with it. Every call is wrapped, every
 * failure is logged and retried with backoff, and the whole module is inert when
 * TELEGRAM_BOT_TOKEN is unset.
 */
import fs from 'node:fs';
import path from 'node:path';

const DATA = process.env.DATA_DIR || '/data';
const STATE_FILE = path.join(DATA, 'telegram.json');

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
// Where the Mini App lives. Almost always the app's own origin; separate because a self-hoster
// may put the Mini App on a different hostname from the one passkeys are bound to.
const WEBAPP_URL = (process.env.TELEGRAM_WEBAPP_URL || ORIGIN).replace(/\/+$/, '');
const API = 'https://api.telegram.org/bot' + TOKEN + '/';

// Telegram refuses web_app buttons on anything but HTTPS, so a localhost instance gets a plain
// text bot rather than a broken button.
const LAUNCHABLE = /^https:/i.test(WEBAPP_URL);

export const enabled = () => !!TOKEN;
export const webAppUrl = () => WEBAPP_URL;
export const launchable = () => LAUNCHABLE;

let me = null;                     // { id, username } once getMe has answered
export const botUsername = () => me?.username || null;

/* ---------- offset, so a restart does not replay the whole backlog ---------- */

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function writeState(patch) {
  const next = { ...readState(), ...patch };
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
  fs.renameSync(tmp, STATE_FILE);
  return next;
}

/* ---------- Bot API ---------- */

/**
 * One Bot API call. Resolves { ok, result } or { ok:false, error } -- never rejects, because
 * every caller is either a fire-and-forget notification or a poll loop that must keep going.
 */
export async function call(method, body, { timeoutMs = 15000 } = {}) {
  if (!TOKEN) return { ok: false, error: 'no bot token' };
  try {
    const res = await fetch(API + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const data = await res.json().catch(() => null);
    if (!data) return { ok: false, error: 'telegram returned no JSON (HTTP ' + res.status + ')' };
    if (!data.ok) return { ok: false, error: data.description || 'telegram refused the call', code: data.error_code };
    return { ok: true, result: data.result };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The button that opens the Mini App, or nothing at all on an instance Telegram cannot open. */
function launchKeyboard(text, deepLink) {
  if (!LAUNCHABLE) return undefined;
  const url = deepLink ? WEBAPP_URL + '?to=' + encodeURIComponent(deepLink) : WEBAPP_URL;
  return { inline_keyboard: [[{ text, web_app: { url } }]] };
}

export function sendMessage(chatId, html, { deepLink = null, button = 'Open LiftMate' } = {}) {
  return call('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: launchKeyboard(button, deepLink)
  });
}

/**
 * Deliver one of the app's notifications to a linked account. Takes the same payload shape
 * the web-push path uses, so the two stay interchangeable at the call site.
 */
export function notify(chatId, { title, body, url }) {
  const text = title ? '<b>' + esc(title) + '</b>' + (body ? '\n' + esc(body) : '') : esc(body || '');
  // The push payload's `url` is a hash route ('#/coach'); the Mini App takes its deep link as a
  // query parameter instead, because Telegram owns the fragment on launch.
  const deepLink = url ? String(url).replace(/^#\/?/, '') || null : null;
  return sendMessage(chatId, text, { deepLink });
}

/* ---------- commands ---------- */

const WELCOME = [
  '<b>LiftMate</b>',
  '',
  'Your plan, your workouts and your weight — on your own server.',
  'Tap the button below to open it. The first time, it signs you in from this Telegram account;',
  'after that it is just your app.'
].join('\n');

const HELP = [
  '<b>What this bot is for</b>',
  '',
  'Everything happens in the Mini App — this chat exists to open it and to tell you when',
  'something needs you:',
  '',
  '• rest timer finished',
  '• a workout is planned today and not logged yet',
  '• your AI Coach has read your training and has suggestions',
  '',
  'Turn those off any time in <b>Settings → Notifications</b> inside the app.',
  '',
  '/app — open LiftMate',
  '/help — this message'
].join('\n');

const NO_HTTPS = [
  '<b>LiftMate</b>',
  '',
  'This instance is served over plain HTTP, and Telegram will only open a Mini App over HTTPS.',
  'Put it behind an HTTPS domain and set <code>TELEGRAM_WEBAPP_URL</code>, then send /start again.'
].join('\n');

async function handleMessage(msg) {
  const chatId = msg.chat?.id;
  if (!chatId || msg.chat.type !== 'private') return;    // groups have nobody to sign in
  const text = String(msg.text || '').trim();
  // "/start deeplink" and "/start@thisbot" both arrive here.
  const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();

  if (!LAUNCHABLE && (command === '/start' || command === '/app')) {
    await sendMessage(chatId, NO_HTTPS);
    return;
  }
  if (command === '/start' || command === '/app') { await sendMessage(chatId, WELCOME); return; }
  if (command === '/help') { await sendMessage(chatId, HELP); return; }
  // Anything else: one line, no conversation. This bot is a door, not an interface.
  await sendMessage(chatId, 'Everything lives in the app — open it below, or send /help.');
}

/* ---------- boot-time setup ---------- */

async function configure() {
  const who = await call('getMe');
  if (!who.ok) {
    console.error('telegram: getMe failed —', who.error);
    return false;
  }
  me = { id: who.result.id, username: who.result.username };
  await call('setMyCommands', {
    commands: [
      { command: 'app', description: 'Open LiftMate' },
      { command: 'help', description: 'What this bot does' }
    ]
  });
  // The persistent menu button is the nicest way in, but it is a web_app button like any other.
  if (LAUNCHABLE) {
    await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'LiftMate', web_app: { url: WEBAPP_URL } } });
  } else {
    console.warn('telegram: TELEGRAM_WEBAPP_URL is not https (' + WEBAPP_URL + ') — the Mini App cannot be opened from Telegram');
  }
  console.log('telegram: connected as @' + me.username + (LAUNCHABLE ? ' → ' + WEBAPP_URL : ''));
  return true;
}

/* ---------- the poll loop ---------- */

let running = false;
const POLL_TIMEOUT_S = 50;
const BACKOFF_MAX_MS = 60000;

async function loop() {
  let offset = readState().offset || 0;
  let backoff = 1000;
  while (running) {
    const r = await call('getUpdates', {
      offset,
      timeout: POLL_TIMEOUT_S,
      // Only what this bot acts on. Telegram then drops the rest server-side instead of
      // queueing callback queries and edits nobody reads.
      allowed_updates: ['message']
    // The HTTP timeout has to outlast the long poll itself, or every poll looks like a failure.
    }, { timeoutMs: (POLL_TIMEOUT_S + 15) * 1000 });

    if (!running) break;
    if (!r.ok) {
      // 409 means another process is polling the same token — usually a second container, or a
      // webhook still registered. Say so plainly; it is not a transient error and backing off
      // silently would hide it.
      if (r.code === 409) console.error('telegram: another process is polling this bot token (409) — only one may.');
      else console.error('telegram: getUpdates failed —', r.error);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
      continue;
    }
    backoff = 1000;

    for (const update of r.result) {
      offset = update.update_id + 1;
      try { if (update.message) await handleMessage(update.message); }
      catch (e) { console.error('telegram: handler threw', e); }
    }
    // Persisted after the batch, not per update: replaying one message after a hard kill is
    // cheaper than an fsync per message, and the handlers are idempotent anyway.
    if (r.result.length) writeState({ offset });
  }
}

const sleep = ms => new Promise(r => { setTimeout(r, ms); });

/** Start the bot. Safe to call when unconfigured — it simply does nothing. */
export async function start() {
  if (!TOKEN || running) return false;
  running = true;
  const ok = await configure();
  if (!ok) { running = false; return false; }
  loop().catch(e => { console.error('telegram: poll loop died', e); running = false; });
  return true;
}
export function stop() { running = false; }

/** What /api/config tells the client. Absent ⇒ no Telegram UI anywhere in the app. */
export function publicConfig() {
  if (!TOKEN) return null;
  return { enabled: true, bot: me?.username || null, launchable: LAUNCHABLE };
}