/* Telegram sign-in.
 *
 * The signature check is the whole security model of this path, so most of what follows is
 * ways of getting it wrong: a tampered field, a launch signed for a different bot, a stale
 * one, one with the newer `signature` field that must stay out of the check string. Each of
 * those has to fail, and fail without saying which part gave it away.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { tempData } from './helpers.mjs';

tempData();
process.env.TELEGRAM_BOT_TOKEN = '123456:TEST-TOKEN';
const { verifyInitData, dataCheckString, displayName } = await import('../telegram/verify.js');
const { telegramRoutes } = await import('../telegram/routes.js');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const USER = { id: 777, first_name: 'Sam', last_name: 'Reyes', username: 'samr', language_code: 'uk' };

/** Build a launch string the way Telegram does, so the tests sign rather than hard-code. */
function makeInitData({ token = TOKEN, user = USER, authDate = Math.floor(Date.now() / 1000), extra = {}, tamper = null } = {}) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: 'AAH_test',
    user: JSON.stringify(user),
    ...extra
  });
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dataCheckString(params)).digest('hex'));
  if (tamper) tamper(params);
  return params.toString();
}

/* ------------------------------- the signature ------------------------------- */

test('a launch Telegram signed for this bot is accepted', () => {
  const v = verifyInitData(makeInitData(), TOKEN);
  assert.equal(v.ok, true);
  assert.deepEqual(v.user, { id: 777, firstName: 'Sam', lastName: 'Reyes', username: 'samr', language: 'uk' });
});

test('the newer signature field stays out of the check string', () => {
  // Telegram added `signature` for third-party validation after the HMAC scheme; folding it
  // into the check string makes every launch from a current client fail.
  const v = verifyInitData(makeInitData({ extra: { signature: 'ed25519-blob' } }), TOKEN);
  assert.equal(v.ok, true, 'the field rides along unsigned, exactly as documented');
});

test('changing any signed field invalidates the launch', () => {
  for (const [field, value] of [['user', JSON.stringify({ ...USER, id: 1 })], ['query_id', 'AAH_other'], ['auth_date', '1']]) {
    const v = verifyInitData(makeInitData({ tamper: p => p.set(field, value) }), TOKEN);
    assert.equal(v.ok, false, field + ' is covered by the signature');
    assert.equal(v.error, 'bad signature', 'and the client is not told which part failed');
  }
});

test('a launch signed for another bot does not work here', () => {
  const v = verifyInitData(makeInitData({ token: '999:OTHER-BOT' }), TOKEN);
  assert.equal(v.ok, false);
  assert.equal(v.error, 'bad signature');
});

test('a missing, empty or oversized launch is refused before any crypto runs', () => {
  assert.equal(verifyInitData('', TOKEN).ok, false);
  assert.equal(verifyInitData(null, TOKEN).ok, false);
  assert.equal(verifyInitData('auth_date=1', TOKEN).error, 'bad signature', 'no hash is no signature');
  assert.match(verifyInitData('x=' + 'a'.repeat(9000), TOKEN).error, /implausibly large/);
  assert.match(verifyInitData(makeInitData(), '').error, /not configured/, 'no token means nobody can sign in');
});

/* ------------------------------- freshness ------------------------------- */

test('a launch expires, but not so fast that it signs people out mid-workout', () => {
  const day = 24 * 3600;
  const fresh = makeInitData({ authDate: Math.floor(Date.now() / 1000) - (day - 60) });
  assert.equal(verifyInitData(fresh, TOKEN).ok, true, 'initData is fixed for a Mini App session');
  const stale = makeInitData({ authDate: Math.floor(Date.now() / 1000) - (day + 60) });
  assert.match(verifyInitData(stale, TOKEN).error, /expired/);
});

test('a future-dated launch is refused, with a little room for clock skew', () => {
  const now = Date.now();
  const skewed = makeInitData({ authDate: Math.floor(now / 1000) + 120 });
  assert.equal(verifyInitData(skewed, TOKEN, { now }).ok, true, 'two minutes of skew is a clock, not an attack');
  const future = makeInitData({ authDate: Math.floor(now / 1000) + 3600 });
  assert.match(verifyInitData(future, TOKEN, { now }).error, /future/);
});

/* ------------------------------- who is launching ------------------------------- */

test('a launch with nobody in it signs nobody in', () => {
  assert.match(verifyInitData(makeInitData({ user: null }), TOKEN).error, /no Telegram account/);
  assert.match(verifyInitData(makeInitData({ user: { id: 5, is_bot: true } }), TOKEN).error, /bots cannot/);
  assert.match(verifyInitData(makeInitData({ user: { id: 'not-a-number' } }), TOKEN).error, /no Telegram account/);
});

test('a profile name is made from whatever the account actually has', () => {
  assert.equal(displayName({ firstName: 'Sam', lastName: 'Reyes' }), 'Sam Reyes');
  assert.equal(displayName({ firstName: 'Sam' }), 'Sam');
  assert.equal(displayName({ username: 'samr' }), '@samr');
  assert.equal(displayName({}), 'Athlete');
  assert.equal(displayName({ firstName: 'x'.repeat(60) }).length, 40, 'the app has a 40-character budget');
});

/* ------------------------------- the routes ------------------------------- */

/** A stand-in for server.js's closures: enough to see what a route decided. */
function harness({ inviteOnly = false, users = [], creds = [], invites = [] } = {}) {
  const db = { users, creds, invites, subs: [] };
  const sent = [];
  const routes = telegramRoutes({
    json: (res, code, body, headers) => sent.push({ code, body, headers }),
    readBody: async req => req.body,
    readSession: req => req.session || null,
    db,
    saveDb: () => { db.saved = (db.saved || 0) + 1; },
    sessionCookie: u => 'gymsid=for-' + u.id,
    isAdmin: () => false,
    inviteOnly: () => inviteOnly
  });
  return { db, sent, routes, last: () => sent.at(-1) };
}
const req = (body, session) => ({ body, session });

test('a first launch creates a profile and signs it in', async () => {
  const h = harness();
  await h.routes['POST /api/telegram/auth'](req({ initData: makeInitData() }), {});
  const { code, body, headers } = h.last();
  assert.equal(code, 200);
  assert.equal(body.created, true);
  assert.equal(body.user.name, 'Sam Reyes');
  assert.match(headers['Set-Cookie'], /^gymsid=/);
  assert.equal(h.db.users.length, 1);
  assert.equal(h.db.users[0].tg, 777);
  assert.notEqual(h.db.users[0].id, '777', 'a public Telegram id is a lookup key, never the profile id');
});

test('a second launch returns to the same profile rather than making another', async () => {
  const h = harness();
  await h.routes['POST /api/telegram/auth'](req({ initData: makeInitData() }), {});
  const first = h.last().body.user.id;
  await h.routes['POST /api/telegram/auth'](req({ initData: makeInitData() }), {});
  assert.equal(h.last().body.created, false);
  assert.equal(h.last().body.user.id, first);
  assert.equal(h.db.users.length, 1);
});

test('a renamed Telegram handle is kept current', async () => {
  const h = harness({ users: [{ id: 'u1', name: 'Sam', tg: 777, tgUsername: 'old' }] });
  await h.routes['POST /api/telegram/auth'](req({ initData: makeInitData() }), {});
  assert.equal(h.db.users[0].tgUsername, 'samr');
});

test('a disabled account cannot come in through Telegram either', async () => {
  const h = harness({ users: [{ id: 'u1', name: 'Sam', tg: 777, disabled: true }] });
  await h.routes['POST /api/telegram/auth'](req({ initData: makeInitData() }), {});
  assert.equal(h.last().code, 403);
  assert.equal(h.last().headers, undefined, 'no cookie is minted for a locked-out profile');
});

test('an unsigned launch creates nothing', async () => {
  const h = harness();
  await h.routes['POST /api/telegram/auth'](req({ initData: 'user=%7B%22id%22%3A1%7D&hash=deadbeef' }), {});
  assert.equal(h.last().code, 401);
  assert.equal(h.db.users.length, 0);
});

test('invite-only applies to Telegram signups, and a deep link can carry the code', async () => {
  const invites = [{ code: 'ABC123' }];
  let h = harness({ inviteOnly: true, invites });
  await h.routes['POST /api/telegram/auth'](req({ initData: makeInitData() }), {});
  assert.equal(h.last().code, 403);
  assert.equal(h.db.users.length, 0, 'an open bot is not an open instance');

  h = harness({ inviteOnly: true, invites: [{ code: 'ABC123' }] });
  await h.routes['POST /api/telegram/auth'](req({ initData: makeInitData({ extra: { start_param: 'abc123' } }) }), {});
  assert.equal(h.last().code, 200, 't.me/bot?startapp=CODE is a code someone taps instead of retypes');
  assert.equal(h.db.invites[0].usedBy, h.db.users[0].id);
});

/* ------------------------------- linking ------------------------------- */

test('an existing profile can bind a Telegram account to itself', async () => {
  const me = { id: 'u1', name: 'Sam' };
  const h = harness({ users: [me] });
  await h.routes['POST /api/telegram/link'](req({ initData: makeInitData() }, me), {});
  assert.equal(h.last().code, 200);
  assert.equal(me.tg, 777);
});

test('one Telegram account cannot be bound to two profiles', async () => {
  const mine = { id: 'u2', name: 'Other' };
  const h = harness({ users: [{ id: 'u1', name: 'Sam', tg: 777 }, mine] });
  await h.routes['POST /api/telegram/link'](req({ initData: makeInitData() }, mine), {});
  assert.equal(h.last().code, 409);
  assert.equal(mine.tg, undefined);
});

test('linking requires a session as well as a signed launch', async () => {
  const h = harness();
  await h.routes['POST /api/telegram/link'](req({ initData: makeInitData() }, null), {});
  assert.equal(h.last().code, 401);
});

test('unlinking says so when it is the last way in', async () => {
  const tgOnly = { id: 'u1', name: 'Sam', tg: 777 };
  let h = harness({ users: [tgOnly] });
  await h.routes['POST /api/telegram/unlink'](req({}, tgOnly), {});
  assert.equal(h.last().body.lockedOut, true);
  assert.equal(tgOnly.tg, undefined);

  const both = { id: 'u2', name: 'Ada', tg: 778 };
  h = harness({ users: [both], creds: [{ userId: 'u2' }] });
  await h.routes['POST /api/telegram/unlink'](req({}, both), {});
  assert.equal(h.last().body.lockedOut, false, 'a passkey is still a way back in');
});