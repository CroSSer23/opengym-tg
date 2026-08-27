/* The OpenAI-compatible adapter.
 *
 * Everything here runs against a stubbed `fetch`, because the point is not that some vendor
 * answers correctly -- it is that this adapter keeps the contract jobs.js classifies against
 * (`code`/`text`/`stderr`/`timedOut`/`spawnError`) no matter how badly the far end behaves,
 * and that it never sends a credential it was not given.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const mod = await import('../coach/adapters/openai-compat.js');
const adapter = mod.default;
const { completionsURL, modelsURL, offendingField, contentOf, _resetCapabilities } = mod;

const realFetch = globalThis.fetch;
/** Stub fetch with a queue of responders; returns the recorded calls. */
function stubFetch(...responders) {
  const calls = [];
  let i = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    const r = responders[Math.min(i++, responders.length - 1)];
    return typeof r === 'function' ? r(calls.at(-1)) : r;
  };
  return calls;
}
const restore = () => { globalThis.fetch = realFetch; };

const reply = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
  text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload))
});
const answer = text => reply(200, { choices: [{ message: { content: text }, finish_reason: 'stop' }] });

const CFG = { baseUrl: 'https://gw.example/v1' };
const call = (over = {}) => adapter.invoke({
  cfg: CFG, prompt: 'do the thing', env: {}, model: 'm1', timeoutMs: 5000, ...over
});

/* ---------------- URL shaping ---------------- */

test('an endpoint URL is normalised however the operator typed it', () => {
  assert.equal(completionsURL('https://api.openai.com/v1'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(completionsURL('https://api.openai.com/v1/'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(completionsURL('http://localhost:11434'), 'http://localhost:11434/v1/chat/completions',
    'a bare host gets the near-universal /v1');
  assert.equal(completionsURL('https://gw/proxy/chat/completions'), 'https://gw/proxy/chat/completions',
    'a URL that already names the endpoint is left alone');
  assert.equal(modelsURL('https://api.openai.com/v1'), 'https://api.openai.com/v1/models');
});

/* ---------------- reading the answer ---------------- */

test('a reasoning scratchpad is not the answer', () => {
  assert.equal(contentOf({ choices: [{ message: { content: '<think>{ maybe }</think>{"a":1}' } }] }).text, '{"a":1}');
  assert.equal(contentOf({ choices: [{ message: { content: [{ text: '{"a"' }, { text: ':1}' }] } }] }).text, '{"a":1}');
  assert.match(contentOf({ choices: [{ message: { content: '', reasoning_content: 'hmm' } }] }).error, /only reasoning/);
  assert.match(contentOf({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }).error, /cut off/);
  assert.match(contentOf({ choices: [] }).error, /no message content/);
});

/* ---------------- the happy path ---------------- */

test('a well-behaved endpoint yields the model text and a zero exit', async () => {
  _resetCapabilities();
  const calls = stubFetch(answer('{"coach_contract":1}'));
  try {
    const r = await call();
    assert.deepEqual(r, { code: 0, text: '{"coach_contract":1}', stderr: '', timedOut: false, spawnError: false });
    assert.equal(calls[0].url, 'https://gw.example/v1/chat/completions');
    assert.equal(calls[0].body.model, 'm1');
    assert.equal(calls[0].body.stream, false);
    assert.deepEqual(calls[0].body.response_format, { type: 'json_object' },
      'JSON mode is asked for first, since it is the thing that makes the validator pass');
    assert.equal(calls[0].body.messages[1].content, 'do the thing');
  } finally { restore(); }
});

test('a key is sent when there is one and no header is invented when there is not', async () => {
  _resetCapabilities();
  let calls = stubFetch(answer('{}'));
  try {
    await call({ env: { OPENAI_API_KEY: 'sk-test' } });
    assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-test');
  } finally { restore(); }
  calls = stubFetch(answer('{}'));
  try {
    await call({ env: {} });
    assert.ok(!('Authorization' in calls[0].init.headers), 'a LAN endpoint takes no credential');
  } finally { restore(); }
});

/* ---------------- surviving the "compatible" part ---------------- */

test('a rejected optional field is dropped once and remembered', async () => {
  _resetCapabilities();
  const calls = stubFetch(
    reply(400, { error: { message: "Unsupported parameter: response_format is not supported" } }),
    answer('{"ok":true}')
  );
  try {
    const r = await call();
    assert.equal(r.code, 0, 'the retry is the answer, not a failure');
    assert.equal(calls.length, 2);
    assert.ok(calls[0].body.response_format, 'the first attempt still asks');
    assert.ok(!('response_format' in calls[1].body), 'the second does not');
  } finally { restore(); }

  const later = stubFetch(answer('{"ok":true}'));
  try {
    await call();
    assert.equal(later.length, 1, 'the downgrade is remembered, so nobody pays for the 400 twice');
    assert.ok(!('response_format' in later[0].body));
  } finally { restore(); }
});

test('each optional field is given up at most once, then the error stands', async () => {
  _resetCapabilities();
  // A server that rejects everything, always, naming a different field each time.
  const calls = stubFetch(
    reply(400, 'temperature is not supported'),
    reply(400, 'max_tokens is not supported'),
    reply(400, 'response_format is not supported'),
    reply(400, 'and now something real')
  );
  try {
    const r = await call();
    assert.equal(r.code, 1);
    assert.equal(calls.length, 4, 'three downgrades, then it stops trying');
    assert.match(r.stderr, /HTTP 400/);
  } finally { restore(); }
});

test('offendingField only fires on the statuses that mean "bad request"', () => {
  assert.equal(offendingField(400, 'temperature must be 1'), 'temperature');
  assert.equal(offendingField(422, 'use max_completion_tokens'), 'max_tokens');
  assert.equal(offendingField(400, 'json_object is unavailable'), 'response_format');
  assert.equal(offendingField(400, 'your account is out of credit'), null);
  assert.equal(offendingField(500, 'temperature'), null, 'a 500 is not a request the adapter can fix');
});

test('a 400 that lists the parameters it accepts is not a rejection of them', () => {
  // Gateways answer an unrelated 400 with a reminder of the schema. Reading a field name out
  // of that list dropped it, and the memo kept it dropped for the life of the process.
  const body = 'model "gpt-x" not found. Accepted parameters are: model, messages, stream, temperature, max_tokens, top_p.';
  assert.equal(offendingField(400, body), null);
  assert.equal(offendingField(400, 'supported fields: temperature, response_format'), null);
  // A real rejection that happens to name the list as well is still a rejection.
  assert.equal(offendingField(400, 'temperature is not supported by this model'), 'temperature');
  assert.equal(offendingField(400, 'unsupported parameter: max_tokens'), 'max_tokens');
});

/* ---------------- failure, classified the way jobs.js reads it ---------------- */

test('an auth failure carries its status, which is what routes it to the auth bucket', async () => {
  _resetCapabilities();
  stubFetch(reply(401, { error: { message: 'invalid api key' } }));
  try {
    const r = await call();
    assert.equal(r.code, 1);
    assert.equal(r.spawnError, false, 'there is no runtime to be missing');
    assert.match(r.stderr, /401/, 'jobs.js classifies on this string');
  } finally { restore(); }
});

test('a 200 carrying an error object is still a failure', async () => {
  _resetCapabilities();
  stubFetch(reply(200, { error: { message: 'upstream provider is down' } }));
  try {
    const r = await call();
    assert.equal(r.code, 1);
    assert.match(r.stderr, /upstream provider is down/);
  } finally { restore(); }
});

test('an unreachable endpoint reads as a provider problem, not a missing runtime', async () => {
  _resetCapabilities();
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  try {
    const r = await call();
    assert.equal(r.spawnError, false);
    assert.equal(r.timedOut, false);
    assert.match(r.stderr, /could not reach the endpoint/);
  } finally { restore(); }
});

test('a configuration missing its model or URL fails before any request is made', async () => {
  _resetCapabilities();
  const calls = stubFetch(answer('{}'));
  try {
    assert.match((await call({ model: null })).stderr, /no model is configured/);
    assert.match((await call({ cfg: {} })).stderr, /no endpoint URL/);
    assert.match((await call({ cfg: { baseUrl: 'not a url' } })).stderr, /not a valid URL/);
    assert.equal(calls.length, 0, 'nothing was sent anywhere');
  } finally { restore(); }
});

/* ---------------- check() ---------------- */

test('a gateway without a /models listing is still a usable endpoint', async () => {
  stubFetch(reply(404, 'not found'));
  try {
    const r = await adapter.check(CFG, {});
    assert.equal(r.ok, true);
    assert.match(r.version, /gw\.example/);
  } finally { restore(); }
});

test('check reports a rejected credential and an unreachable host differently', async () => {
  stubFetch(reply(401, 'nope'));
  try {
    const r = await adapter.check(CFG, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /rejected the credential/);
  } finally { restore(); }

  globalThis.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  try {
    const r = await adapter.check(CFG, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /could not reach/);
  } finally { restore(); }

  assert.equal((await adapter.check({}, {})).ok, false, 'no URL is not a reachable endpoint');
});

test('a models listing is counted, because that is the useful part of it', async () => {
  stubFetch(reply(200, { data: [{ id: 'a' }, { id: 'b' }] }));
  try {
    assert.match((await adapter.check(CFG, {})).version, /2 models/);
  } finally { restore(); }
});