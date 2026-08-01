import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tempData, sampleState } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const cadence = await import('../coach/cadence.js');

/* ---------------- configuration ---------------- */

test('an unconfigured instance offers nothing at all', () => {
  assert.equal(cfg.isEnabled(), false);
  assert.equal(cfg.isConnected(), false);
  assert.equal(cfg.publicConfig(), null, 'no coach key in /api/config ⇒ no Coach UI anywhere');
});

test('a provider that is enabled but not signed in is still not offered', () => {
  cfg.save({ enabled: true, provider: 'claude' });
  assert.equal(cfg.isEnabled(), true);
  assert.equal(cfg.isConnected(), false);
  assert.equal(cfg.publicConfig(), null, 'half-configured is off, not broken');
});

test('credentials survive a round-trip and are unreadable in the file', () => {
  cfg.save({ enabled: true, provider: 'claude', auth: { type: 'apikey', data: cfg.encrypt({ token: 'sk-ant-secret' }) } });
  assert.equal(cfg.isConnected(), true);
  const onDisk = fs.readFileSync(`${DIR}/coach.json`, 'utf8');
  assert.ok(!onDisk.includes('sk-ant-secret'), 'the token is not sitting in the file in the clear');
  assert.equal(cfg.decrypt(cfg.load().auth.data).token, 'sk-ant-secret');
});

test('a credential encrypted under a different secret fails closed', () => {
  const blob = cfg.encrypt({ token: 'sk-ant-secret' });
  fs.writeFileSync(`${DIR}/secret`, 'b'.repeat(64));
  cfg.reset();
  assert.equal(cfg.decrypt(blob), null, 'restoring ./data without its secret does not leak the token');
  fs.writeFileSync(`${DIR}/secret`, 'a'.repeat(64));
  cfg.reset();
});

test('the job environment carries the credential and nothing else', () => {
  cfg.save({ enabled: true, provider: 'claude', auth: { type: 'oauth', data: cfg.encrypt({ token: 'oauth-tok' }) } });
  process.env.RP_ID = 'gym.example.com';
  process.env.ADMIN_UIDS = 'someadmin';
  const env = cfg.jobEnv('/tmp/jobdir');
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, 'oauth-tok');
  assert.equal(env.HOME, '/tmp/jobdir', 'the CLI writes its own config into the throwaway job dir');
  assert.equal(env.RP_ID, undefined, 'nothing is inherited from this process');
  assert.equal(env.ADMIN_UIDS, undefined);
  assert.deepEqual(Object.keys(env).sort(), ['CLAUDE_CODE_OAUTH_TOKEN', 'HOME', 'PATH', 'TMPDIR']);
});

test('an API key goes in under the provider\'s key variable, not the OAuth one', () => {
  cfg.save({ provider: 'claude', auth: { type: 'apikey', data: cfg.encrypt({ token: 'sk-ant-key' }) } });
  const env = cfg.jobEnv('/tmp/jobdir');
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-key');
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
});

test('the instance job log records outcomes, never contents', () => {
  cfg.save({ log: [] });
  cfg.logJob({ at: new Date().toISOString(), uid: 'u1', kind: 'review', outcome: 'ready', ms: 1200 });
  cfg.logJob({ at: new Date().toISOString(), uid: 'u1', kind: 'review', outcome: 'failed', errorClass: 'auth', ms: 400 });
  const log = cfg.load().log;
  assert.equal(log.length, 2);
  assert.equal(cfg.lastError().errorClass, 'auth');
  assert.equal(cfg.lastSuccess().outcome, 'ready');
  assert.ok(!JSON.stringify(log).includes('changes'), 'no proposal content ever reaches the instance log');
});

/* ---------------- cadence ---------------- */

const coachWith = over => ({ consent: { agreedAt: '2026-01-01T00:00:00Z' }, ...over });

test('cadence off never fires', () => {
  assert.equal(cadence.isDue(coachWith({ cadence: 'off' }), sampleState(), null), false);
  assert.equal(cadence.isDue(coachWith({}), sampleState(), null), false);
});

test('no new training since the last review means nothing to review', () => {
  const S = sampleState();
  const coach = coachWith({ cadence: { everyWorkouts: 1 }, lastReview: { at: Date.now() } });
  assert.equal(cadence.isDue(coach, S, null), false);
});

test('every-N-workouts fires once the count is met', () => {
  const S = sampleState();
  S.workouts = [1, 2, 3].map(i => ({ id: 'w' + i, d: '2026-07-2' + i, end: Date.now(), entries: [] }));
  assert.equal(cadence.isDue(coachWith({ cadence: { everyWorkouts: 4 } }), S, null), false);
  assert.equal(cadence.isDue(coachWith({ cadence: { everyWorkouts: 3 } }), S, null), true);
});

test('weekly fires on the chosen weekday and minute, in the user\'s own timezone', () => {
  const S = sampleState();
  S.workouts = [{ id: 'w1', d: '2026-07-25', end: Date.now(), entries: [] }];
  const coach = coachWith({ cadence: { weekly: { day: 0, time: '18:00' } } });
  assert.equal(cadence.isDue(coach, S, { date: '2026-07-26', hhmm: '18:00', weekday: 0 }), true);
  assert.equal(cadence.isDue(coach, S, { date: '2026-07-26', hhmm: '17:59', weekday: 0 }), false);
  assert.equal(cadence.isDue(coach, S, { date: '2026-07-27', hhmm: '18:00', weekday: 1 }), false);
});

test('weekly does not fire twice on the same day', () => {
  const S = sampleState();
  S.workouts = [{ id: 'w1', d: '2026-07-25', end: Date.now(), entries: [] }];
  const coach = coachWith({
    cadence: { weekly: { day: 0, time: '18:00' } },
    lastReview: { at: new Date('2026-07-26T18:00:00Z').getTime() }
  });
  assert.equal(cadence.isDue(coach, S, { date: '2026-07-26', hhmm: '18:00', weekday: 0 }), false);
});
