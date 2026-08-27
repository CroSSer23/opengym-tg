/* OpenAI-compatible endpoint adapter.
 *
 * Unlike the Claude and Codex adapters this one spawns nothing: the "runtime" is one HTTPS
 * POST to `<baseUrl>/chat/completions`. That removes the whole process-isolation apparatus --
 * there is no child, so there is nothing to drop privileges for and nothing that could go
 * looking at ./data. What is left is the network boundary, and the two rules that govern it:
 *
 *   - the payload is the same allowlisted JSON every other provider gets (payload.js), and
 *   - the answer is the same untrusted string every other provider returns; validate.js is
 *     still the only thing standing between a model and someone's training plan.
 *
 * "OpenAI-compatible" is a family, not a spec. Ollama, llama.cpp, vLLM, LiteLLM, OpenRouter,
 * Together and Azure all answer this URL and each rejects a different optional field. Rather
 * than maintain a matrix of which server takes what, the request starts with everything that
 * improves the odds of clean JSON and drops whichever field the server names in a 400, once
 * per field, remembering the downgrade for the life of the process.
 */

const SYSTEM_PROMPT = [
  'You are the LiftMate Coach.',
  'Answer only the supplied task and return exactly the requested JSON.',
  'You have no tools, filesystem access, external services, or persistent memory.'
].join(' ');

// Low but not zero: plan design benefits from some variation, JSON validity does not.
const TEMPERATURE = 0.2;
// Enough for the largest thing the schema allows (7 routines of 20 exercises, each with a
// rationale). Left generous rather than tuned: an answer truncated mid-JSON costs a whole
// job, and nobody is billed for tokens the model did not need.
const MAX_TOKENS = 8192;
const CHECK_TIMEOUT_MS = 20000;

/* ---------- base URL ---------- */

/**
 * Normalise whatever the operator typed into a chat-completions URL.
 *   https://api.example.com      -> https://api.example.com/v1/chat/completions
 *   https://api.example.com/v1   -> https://api.example.com/v1/chat/completions
 * A URL that already names the endpoint is left alone, so a gateway with its own route works.
 */
export function completionsURL(baseUrl) {
  const u = new URL(String(baseUrl || '').trim());
  let p = u.pathname.replace(/\/+$/, '');
  if (p.endsWith('/chat/completions')) return u.origin + p + u.search;
  // An empty path means the operator gave a bare host; /v1 is the near-universal convention.
  if (p === '') p = '/v1';
  return u.origin + p + '/chat/completions' + u.search;
}
export function modelsURL(baseUrl) {
  return completionsURL(baseUrl).replace(/\/chat\/completions(\?|$)/, '/models$1');
}

/* ---------- per-endpoint capability memo ---------- */

// Fields this server has already rejected. Keyed by endpoint and model, because the same
// gateway can front a strict reasoning model and a permissive chat model at once.
const dropped = new Map();
const memoKey = (url, model) => url + ' ' + (model || '');
const droppedFor = (url, model) => dropped.get(memoKey(url, model)) || new Set();
function remember(url, model, field) {
  const key = memoKey(url, model);
  const set = dropped.get(key) || new Set();
  set.add(field);
  dropped.set(key, set);
}
// Test seam.
export function _resetCapabilities() { dropped.clear(); }

// Optional fields, in the order they are given up. response_format goes last because it is
// the one that actually improves JSON validity; the other two are refusals of taste.
const OPTIONAL_FIELDS = ['temperature', 'max_tokens', 'response_format'];

/** Which optional field is this 400 complaining about? Null when it is a real error. */
export function offendingField(status, body) {
  if (status !== 400 && status !== 422) return null;
  // A 400 often ends with a list of what the endpoint *does* accept. Matching a field name
  // inside that list read "Accepted parameters are: ... temperature, max_tokens" as a
  // rejection of both, and the memo below then remembered it for the life of the process.
  const t = String(body || '').toLowerCase()
    .replace(/\b(accepted|supported|allowed|valid|permitted|recognized|recognised|known)\s+(request\s+)?(parameters?|fields?|options?|arguments?|properties)\b[^.!?\n]*/g, ' ');
  // max_completion_tokens is the successor field; a server naming it is rejecting max_tokens.
  if (/max_tokens|max_completion_tokens/.test(t)) return 'max_tokens';
  if (/temperature/.test(t)) return 'temperature';
  if (/response_format|json_object|json_schema|structured output/.test(t)) return 'response_format';
  return null;
}

/* ---------- answer extraction ---------- */

/**
 * Reasoning models emit their scratchpad either in a think block inside the content or in a
 * sibling field. Neither is the answer, and a scratchpad full of braces defeats the
 * brace-scanning fallback in extractJSON, so it is removed here rather than there.
 */
export function contentOf(data) {
  const choice = data?.choices?.[0];
  const msg = choice?.message || {};
  let text = typeof msg.content === 'string'
    ? msg.content
    // Some servers return the multimodal content-parts array even for plain text.
    : Array.isArray(msg.content) ? msg.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join('') : '';
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!text && (msg.reasoning_content || msg.reasoning)) {
    return { text: '', error: 'the model returned only reasoning and no answer, so it may need a higher token limit' };
  }
  if (!text && choice?.finish_reason === 'length') {
    return { text: '', error: 'the answer was cut off by the model token limit' };
  }
  if (!text) return { text: '', error: 'the endpoint returned no message content' };
  return { text };
}

/* ---------- the adapter ---------- */

function headers(env) {
  const h = { 'Content-Type': 'application/json' };
  const key = (env && env.OPENAI_API_KEY) || '';
  // A local endpoint (Ollama, llama.cpp) needs no key and rejects nothing for its absence.
  if (key) h.Authorization = 'Bearer ' + key;
  return h;
}

/** Map an HTTP failure onto the shape jobs.js classifies. 401/403 land in the auth bucket. */
function httpFailure(status, body) {
  return {
    code: 1,
    text: '',
    stderr: 'HTTP ' + status + ': ' + String(body || '').slice(0, 400),
    timedOut: false,
    spawnError: false
  };
}

const fail = stderr => ({ code: 1, text: '', stderr, timedOut: false, spawnError: false });

async function readBody(res) {
  try { return (await res.text()).slice(0, 4000); } catch { return ''; }
}

export default {
  id: 'openai',
  runtime: 'OpenAI-compatible endpoint',

  /**
   * Reachability, not authorisation. GET /models is the cheapest call in the family, but
   * plenty of gateways do not implement it, and a 404 there says nothing bad about the
   * endpoint. Only a transport failure counts as "not ready"; testRun does the real
   * round-trip.
   */
  async check(cfg, env) {
    if (!cfg?.baseUrl) return { ok: false, error: 'set the endpoint URL first' };
    let url;
    try { url = modelsURL(cfg.baseUrl); }
    catch { return { ok: false, error: 'the endpoint URL is not a valid URL' }; }
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: headers(env),
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS)
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: 'the endpoint rejected the credential (' + res.status + ')' };
      }
      const host = new URL(url).host;
      if (!res.ok) return { ok: true, version: host + ' (no /models listing)' };
      const body = await res.json().catch(() => null);
      const n = Array.isArray(body?.data) ? body.data.length : 0;
      return { ok: true, version: host + (n ? ' - ' + n + ' model' + (n === 1 ? '' : 's') : '') };
    } catch (e) {
      return { ok: false, error: 'could not reach the endpoint: ' + String(e?.message || e).slice(0, 200) };
    }
  },

  async invoke({ cfg, prompt, env, model, timeoutMs }) {
    if (!cfg?.baseUrl) return fail('no endpoint URL is configured');
    let url;
    try { url = completionsURL(cfg.baseUrl); }
    catch { return fail('the endpoint URL is not a valid URL'); }
    if (!model) return fail('no model is configured -- set one in the admin dashboard');

    // One clock for the whole exchange, downgrade retries included: a server that rejects
    // three fields in a row must not get three fresh timeouts to do it in.
    const deadline = AbortSignal.timeout(timeoutMs);

    // At most one attempt per optional field, plus the one that succeeds.
    for (let attempt = 0; attempt <= OPTIONAL_FIELDS.length; attempt++) {
      const skip = droppedFor(url, model);
      const body = {
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        stream: false
      };
      if (!skip.has('temperature')) body.temperature = TEMPERATURE;
      if (!skip.has('max_tokens')) body.max_tokens = MAX_TOKENS;
      if (!skip.has('response_format')) body.response_format = { type: 'json_object' };

      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: headers(env),
          body: JSON.stringify(body),
          signal: deadline
        });
      } catch (e) {
        if (deadline.aborted) {
          return { code: -1, text: '', stderr: 'the endpoint did not answer in time', timedOut: true, spawnError: false };
        }
        // A refused connection or DNS failure is a provider problem, not a missing runtime:
        // there is no runtime to install for this adapter.
        return fail('could not reach the endpoint: ' + String(e?.message || e));
      }

      if (!res.ok) {
        const raw = await readBody(res);
        const field = offendingField(res.status, raw);
        if (field && !skip.has(field)) {
          remember(url, model, field);
          continue;                        // same deadline, one fewer optional field
        }
        return httpFailure(res.status, raw);
      }

      let data;
      try { data = await res.json(); }
      catch { return fail('the endpoint did not return JSON'); }

      // A 200 carrying an error object is common on aggregating gateways.
      if (data?.error) return fail(String(data.error.message || JSON.stringify(data.error)).slice(0, 400));

      const { text, error } = contentOf(data);
      if (error) return fail(error);
      return { code: 0, text, stderr: '', timedOut: false, spawnError: false };
    }

    return fail('the endpoint rejected every request shape this adapter can send');
  }
};