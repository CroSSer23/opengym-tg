/* Does the image actually contain the app?
 *
 * The Dockerfile lists what goes into the image by hand, which is right - the image should
 * carry the app and nothing else - and which means adding a directory to the api and
 * forgetting to add the COPY line produces a container that dies on ERR_MODULE_NOT_FOUND the
 * moment it starts, and then loops on it forever under `restart: unless-stopped`.
 *
 * Nothing else catches it. Running the server from a source checkout cannot: there, the
 * directory is simply there. The tests cannot: same reason. It only shows up in a deployment,
 * as a 502 from a proxy that has no idea why.
 *
 * So this walks the real import graph from server.js and asserts every file it reaches is
 * covered by a COPY.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = path.dirname(fileURLToPath(new URL('.', import.meta.url)));

/** The paths the Dockerfile copies in, relative to the api directory. */
function copiedPaths() {
  const df = fs.readFileSync(path.join(API, 'Dockerfile'), 'utf8');
  const out = [];
  // Split on \r?\n, not \n. On a CRLF checkout every line keeps a trailing \r, and `.` in a
  // JS regex does not match \r - it is a line terminator - so `(.+)$` never reaches the end
  // and the whole file parses as "no COPY lines at all", which is a test that passes by
  // finding nothing.
  for (const line of df.split(/\r?\n/)) {
    const m = line.match(/^\s*COPY\s+(?!--from)(.+)$/i);
    if (!m) continue;
    const parts = m[1].trim().split(/\s+/);
    parts.pop();                                   // the destination
    for (const src of parts) out.push(src.replace(/\/$/, ''));
  }
  return out;
}

/** Every local file reachable from server.js by relative import. */
function importGraph(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    // Only source files have imports to follow; a .json reached below is a leaf.
    if (!/\.[cm]?js$/.test(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    // Static imports and re-exports, the one dynamic import jobs.js uses, and createRequire
    // calls - payload.js pulls coach/library.json in through one, and the walker used to
    // report a clean bill of health for a runtime dependency no COPY line mentioned.
    for (const m of src.matchAll(/(?:from|import|require\w*)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
      const resolved = path.resolve(path.dirname(file), m[1]);
      if (fs.existsSync(resolved)) queue.push(resolved);
    }
  }
  return [...seen];
}

test('every module the server imports is copied into the image', () => {
  const copied = copiedPaths();
  const missing = [];
  for (const file of importGraph(path.join(API, 'server.js'))) {
    const rel = path.relative(API, file).split(path.sep).join('/');
    const covered = copied.some(c => c === '.' || rel === c || rel.startsWith(c + '/'));
    if (!covered) missing.push(rel);
  }
  assert.deepEqual(missing, [], 'add a COPY line to api/Dockerfile for these');
});

test('the walker follows createRequire, not just import', () => {
  // payload.js reaches coach/library.json through createRequire. A walker that only reads
  // import statements gives a clean bill of health to a runtime file no COPY line mentions;
  // today that is masked because the Dockerfile copies coach/ whole.
  const graph = importGraph(path.join(API, 'server.js'))
    .map(f => path.relative(API, f).split(path.sep).join('/'));
  assert.ok(graph.includes('coach/library.json'), 'library.json is reachable from server.js');
});

test('the prompts the Coach reads at runtime are in the image too', () => {
  // These are read with fs at job time rather than imported, so the graph above cannot see
  // them - and a missing prompt fails a job rather than the boot, which is worse.
  const copied = copiedPaths();
  const prompts = fs.readdirSync(path.join(API, 'coach', 'prompts'));
  assert.ok(prompts.length > 0, 'the Coach has prompt files');
  assert.ok(
    copied.some(c => c === '.' || c === 'coach' || c === 'coach/prompts'),
    'coach/ is copied, which carries the prompts'
  );
});