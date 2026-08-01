/* The package-local Codex CLI. Keeping it out of PATH means Coach jobs do not accidentally
 * resolve a host-provided binary with an unknown version or configuration. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CODEX_BIN = process.env.COACH_CODEX_BIN || path.resolve(here, '../../node_modules/.bin/codex');
