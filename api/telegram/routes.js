/* Telegram sign-in and account linking.
 *
 * Same factory shape as coach/routes.js, and for the same reason: the helpers it needs are
 * closures over db and the session secret, so they are passed in rather than imported.
 *
 * The security of every route here reduces to one call -- verifyInitData. A launch that fails
 * it is anonymous traffic; a launch that passes it is proof that Telegram, holding the bot
 * token's counterpart, vouched for this account id. Nothing else about the request is trusted,
 * including any user id it might name.
 */
import { verifyInitData, displayName, DEFAULT_MAX_AGE_S } from './verify.js';
import * as bot from './bot.js';

const MAX_AGE = Math.max(60, +(process.env.TELEGRAM_AUTH_MAX_AGE || 0) || DEFAULT_MAX_AGE_S);

export function telegramRoutes({ json, readBody, readSession, db, saveDb, sessionCookie, isAdmin, inviteOnly }) {
  /** Verify the launch, or answer the client and return null. */
  const launch = async (req, res) => {
    if (!bot.enabled()) { json(res, 503, { error: 'this instance has no Telegram bot configured' }); return null; }
    const body = await readBody(req);
    const v = verifyInitData(body.initData, process.env.TELEGRAM_BOT_TOKEN, { maxAgeSeconds: MAX_AGE });
    if (!v.ok) { json(res, 401, { error: v.error }); return null; }
    return { ...v, body };
  };
  const publicUser = u => ({ id: u.id, name: u.name, admin: isAdmin(u) });

  return {
    /**
     * Sign in from inside the Mini App, creating the profile on first launch.
     *
     * This is the passkey flow's sibling, not a bypass of it: a Telegram account is a
     * credential the same way a passkey is, held by a party that will not hand it over. What
     * it is *not* is a second door into an existing profile -- a launch only ever reaches the
     * profile already bound to that Telegram id, and binding one to an existing profile is a
     * deliberate act performed from a signed-in session (see /link below).
     */
    'POST /api/telegram/auth': async (req, res) => {
      const v = await launch(req, res); if (!v) return;

      const existing = db.users.find(u => u.tg === v.user.id);
      if (existing) {
        if (existing.disabled) return json(res, 403, { error: 'this account has been disabled' });
        // Keep the handle current: people rename themselves, and the admin dashboard shows it.
        if (existing.tgUsername !== v.user.username) { existing.tgUsername = v.user.username; saveDb(); }
        return json(res, 200, { user: publicUser(existing), created: false }, { 'Set-Cookie': sessionCookie(existing) });
      }

      // First launch: this is a signup, and it obeys the same invite gate signup already has.
      let invite = null;
      if (inviteOnly()) {
        // Telegram deep links (`t.me/bot?startapp=CODE`) arrive as start_param, so an invite can
        // be a link someone taps rather than a code they retype.
        const code = String(v.body.code || v.startParam || '').trim().toUpperCase();
        invite = code ? db.invites.find(i => i.code === code && !i.usedBy && !i.revoked) : null;
        if (!invite) return json(res, 403, { error: 'a valid invite code is required', code: 'invite' });
      }

      const user = {
        // The id is the app's own, not Telegram's. Telegram ids are public, guessable and
        // reused across every bot that account ever talks to; they are a lookup key here and
        // never an identifier anything else in the app hangs off.
        id: 'tg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        name: displayName(v.user),
        tg: v.user.id,
        tgUsername: v.user.username,
        created: new Date().toISOString()
      };
      if (invite) { user.invitedBy = invite.code; invite.usedBy = user.id; invite.usedAt = user.created; }
      db.users.push(user);
      saveDb();
      json(res, 200, { user: publicUser(user), created: true }, { 'Set-Cookie': sessionCookie(user) });
    },

    /**
     * Bind this Telegram account to the profile already signed in — the path for someone who
     * started on the web with a passkey and now wants the bot's notifications.
     */
    'POST /api/telegram/link': async (req, res) => {
      const me = readSession(req);
      if (!me) return json(res, 401, { error: 'not signed in' });
      const v = await launch(req, res); if (!v) return;

      const taken = db.users.find(u => u.tg === v.user.id && u.id !== me.id);
      if (taken) return json(res, 409, { error: 'that Telegram account already has a profile here' });
      me.tg = v.user.id;
      me.tgUsername = v.user.username;
      saveDb();
      json(res, 200, { ok: true, telegram: { username: v.user.username, name: displayName(v.user) } });
    },

    /**
     * Unbind. Deliberately allowed even when the profile has no passkey: someone who signed up
     * through Telegram and unlinks it locks themselves out, so the client asks first, and the
     * server says plainly that it will happen rather than refusing.
     */
    'POST /api/telegram/unlink': async (req, res) => {
      const me = readSession(req);
      if (!me) return json(res, 401, { error: 'not signed in' });
      const hadPasskey = db.creds.some(c => c.userId === me.id);
      delete me.tg;
      delete me.tgUsername;
      saveDb();
      json(res, 200, { ok: true, lockedOut: !hadPasskey });
    },

    /** What Settings renders: is this profile linked, and to whom. */
    'GET /api/telegram/me': async (req, res) => {
      const me = readSession(req);
      if (!me) return json(res, 401, { error: 'not signed in' });
      json(res, 200, {
        linked: !!me.tg,
        username: me.tgUsername || null,
        bot: bot.botUsername(),
        hasPasskey: db.creds.some(c => c.userId === me.id)
      });
    }
  };
}