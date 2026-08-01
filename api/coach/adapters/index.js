/* Provider adapters. Everything above this layer speaks one interface:
 *
 *   check(cfg, env)                                  → { ok, version?, error? }
 *   invoke({ prompt, jobDir, env, model, timeoutMs }) → { code, text, stderr, timedOut, spawnError }
 *
 * Adding a provider is a file here plus a row in config.PROVIDERS. Nothing else in the
 * codebase — routes, jobs, payload, validation, UI — knows which one is configured.
 */
import { run } from './spawn.js';
import claude from './claude.js';
import { CODEX_BIN } from './codex-cli.js';

const CODEX_DISABLED_FEATURES = [
  'auth_elicitation', 'shell_tool', 'unified_exec', 'shell_snapshot', 'browser_use',
  'browser_use_external', 'browser_use_full_cdp_access', 'in_app_browser', 'computer_use',
  'apps', 'plugins', 'plugin_sharing', 'remote_plugin', 'multi_agent', 'skill_search',
  'skill_mcp_dependency_install', 'workspace_dependencies', 'image_generation', 'hooks',
  'code_mode_host', 'tool_suggest'
];

/** Gemini CLI — `-p` is its non-interactive mode; it prints the answer bare. */
const gemini = {
  id: 'gemini',
  cli: 'gemini',
  async check(cfg, env) {
    const r = await run('gemini', ['--version'], { env, timeoutMs: 20000 });
    if (r.spawnError) return { ok: false, error: 'the Gemini CLI is not installed in this container' };
    return r.code === 0 ? { ok: true, version: (r.stdout || '').trim().split('\n')[0] } : { ok: false, error: (r.stderr || '').trim().slice(0, 200) };
  },
  async invoke({ prompt, jobDir, env, model, timeoutMs }) {
    const argv = ['-p'];
    if (model) argv.push('-m', model);
    const r = await run('gemini', argv, { stdin: prompt, env, cwd: jobDir, timeoutMs });
    return { ...r, text: (r.stdout || '').trim() };
  }
};

/** OpenAI Codex CLI — `exec` is the headless subcommand. */
const codex = {
  id: 'codex',
  cli: CODEX_BIN,
  async check(cfg, env) {
    const r = await run(CODEX_BIN, ['--version'], { env, timeoutMs: 20000 });
    if (r.spawnError) return { ok: false, error: 'the Codex CLI is not installed in this container' };
    return r.code === 0 ? { ok: true, version: (r.stdout || '').trim().split('\n')[0] } : { ok: false, error: (r.stderr || '').trim().slice(0, 200) };
  },
  async invoke({ prompt, jobDir, env, model, timeoutMs }) {
    // The managed config grants spawned commands read access only to this job directory and
    // minimal runtime files; it explicitly denies /codex, where Codex itself keeps its auth
    // cache. Keep sessions ephemeral and ignore project-level exec rules. The prompt is data on
    // stdin, never a shell argument.
    const argv = ['exec', '--strict-config', '--skip-git-repo-check', '--ephemeral', '--ignore-rules', '-c', 'cli_auth_credentials_store="file"'];
    for (const feature of CODEX_DISABLED_FEATURES) argv.push('--disable', feature);
    if (model) argv.push('-m', model);
    const r = await run(CODEX_BIN, argv, { stdin: prompt, env, cwd: jobDir, timeoutMs });
    return { ...r, text: (r.stdout || '').trim() };
  }
};

/**
 * Owner-supplied command (FR-03). The contract is the whole interface: prompt on stdin, one
 * JSON object on stdout, non-zero exit means failure. api/coach/fixture-cli.mjs is a working
 * reference implementation — a local model wrapper only has to match that.
 *
 * The command is split on whitespace, never run through a shell: it is set by the instance
 * admin in a text field, and a field that can start a shell is a field that eventually does.
 */
const custom = {
  id: 'custom',
  cli: null,
  parse(cfg) {
    const parts = String(cfg.customCommand || '').trim().split(/\s+/).filter(Boolean);
    return { cmd: parts[0], argv: parts.slice(1) };
  },
  async check(cfg, env) {
    const { cmd } = custom.parse(cfg);
    if (!cmd) return { ok: false, error: 'no custom command configured' };
    return { ok: true, version: cmd };
  },
  async invoke({ cfg, prompt, jobDir, env, timeoutMs }) {
    const { cmd, argv } = custom.parse(cfg);
    if (!cmd) return { code: -1, text: '', stderr: 'no custom command configured', spawnError: true };
    const r = await run(cmd, argv, { stdin: prompt, env, cwd: jobDir, timeoutMs });
    return { ...r, text: (r.stdout || '').trim() };
  }
};

/**
 * The in-repo fake provider. Ships with the image on purpose: it is what CI drives, and it
 * lets an instance owner see the entire Coach loop — intake, proposal, apply, revert —
 * before deciding whether to connect a real account to it.
 */
const FIXTURE = new URL('../fixture-cli.mjs', import.meta.url).pathname;
const fixture = {
  id: 'fixture',
  cli: process.execPath,
  async check() { return { ok: true, version: 'fixture' }; },
  async invoke({ prompt, jobDir, env, timeoutMs }) {
    const r = await run(process.execPath, [FIXTURE], {
      stdin: prompt, cwd: jobDir, timeoutMs,
      // The fixture needs its mode knob, which the sanitised job env deliberately drops.
      env: { ...env, FIXTURE_MODE: process.env.FIXTURE_MODE || '' },
      asCoach: false   // a temp dir owned by root in tests; the fixture reads only stdin anyway
    });
    return { ...r, text: (r.stdout || '').trim() };
  }
};

const ADAPTERS = { claude, gemini, codex, custom, fixture };
export const adapterFor = provider => ADAPTERS[provider] || null;
export default ADAPTERS;
