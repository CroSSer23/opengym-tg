/* Claude Code CLI adapter.
 *
 * The CLI is installed into the api image at a pinned version (api/Dockerfile), so the flags
 * below can be exact rather than defensive. They are deliberately gathered in one constant:
 * bumping the pin means re-checking this block and nothing else.
 *
 * The prompt goes in on stdin, not argv — a review payload runs to tens of kilobytes and
 * would otherwise flirt with ARG_MAX. Tools are switched off: this job is text in, JSON out,
 * and a coach that can read files or run commands is a coach that can surprise someone.
 */
import { run } from './spawn.js';

const FLAGS = {
  print: '--print',                    // non-interactive: read stdin, print result, exit
  outputFormat: ['--output-format', 'json'],
  maxTurns: ['--max-turns', '1'],
  noTools: ['--allowed-tools', ''],    // empty allowlist = the model gets no tools at all
  model: m => ['--model', m]
};

export default {
  id: 'claude',
  cli: 'claude',

  async check(cfg, env) {
    const r = await run('claude', ['--version'], { env, timeoutMs: 20000 });
    if (r.spawnError) return { ok: false, error: 'the Claude CLI is not installed in this container' };
    if (r.code !== 0) return { ok: false, error: (r.stderr || r.stdout || '').trim().slice(0, 200) };
    return { ok: true, version: (r.stdout || '').trim().split('\n')[0] };
  },

  async invoke({ prompt, jobDir, env, model, timeoutMs }) {
    const argv = [FLAGS.print, ...FLAGS.outputFormat, ...FLAGS.maxTurns, ...FLAGS.noTools];
    if (model) argv.push(...FLAGS.model(model));
    const r = await run('claude', argv, { stdin: prompt, env, cwd: jobDir, timeoutMs });
    return { ...r, text: extract(r.stdout) };
  }
};

/**
 * `--output-format json` wraps the answer in a result envelope; older/edge paths print the
 * text bare. Accept both, and let the validator deal with whatever text comes out — this
 * layer's job is transport, not meaning.
 */
export function extract(stdout) {
  const raw = (stdout || '').trim();
  if (!raw) return '';
  try {
    const env = JSON.parse(raw);
    if (env && typeof env === 'object') {
      if (typeof env.result === 'string') return env.result;
      // Streaming-style output: an array of events, the last of which carries the result.
      if (Array.isArray(env)) {
        const last = [...env].reverse().find(e => typeof e?.result === 'string');
        if (last) return last.result;
      }
    }
  } catch { /* not an envelope — the CLI printed the answer directly */ }
  return raw;
}
