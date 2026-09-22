import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const action = fileURLToPath(new URL('../dist/action.cjs', import.meta.url));
const bundle = '#!/usr/bin/env node\nif (process.argv.includes("--help")) { console.log("ppr-tool stub"); process.exit(0); }\nprocess.exit(3);\n';
const sha256 = value => createHash('sha256').update(value).digest('hex');

async function releases(t, { tamper = false } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/latest/SHA256SUMS' || req.url === '/v0.1.0/SHA256SUMS') { res.end(`${tamper ? 'a'.repeat(64) : sha256(bundle)}  ppr-tool.mjs\n`); return; }
    if (req.url === '/latest/ppr-tool.mjs') { res.writeHead(302, { location: '/v0.1.0/ppr-tool.mjs' }); res.end(); return; }
    if (req.url === '/v0.1.0/ppr-tool.mjs') { res.end(bundle); return; }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { url: `http://127.0.0.1:${server.address().port}/`, requests };
}

async function run(t, env) {
  const dir = await mkdtemp(path.join(tmpdir(), 'setup-ppr-tool-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const envFile = path.join(dir, 'env'), pathFile = path.join(dir, 'path');
  const child = spawn(process.execPath, [action], { env: { ...process.env, INPUT_REGISTRY: 'https://registry.example.test', RUNNER_TEMP: dir, GITHUB_ENV: envFile, GITHUB_PATH: pathFile, ...env }, stdio: 'pipe' });
  let output = '';
  child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
  const code = await new Promise(resolve => child.on('exit', resolve));
  return { dir, envFile, pathFile, code, output };
}

test('installs the released bundle, verifies its checksum and exposes ppr-tool on PATH', async t => {
  const { url, requests } = await releases(t);
  const { dir, envFile, pathFile, code, output } = await run(t, { PPR_TOOL_RELEASES_URL: url });
  assert.equal(code, 0, output);
  assert.deepEqual(requests.slice(0, 2), ['/latest/SHA256SUMS', '/latest/ppr-tool.mjs']);
  assert.match(output, /ppr-tool v0\.1\.0 ready/);
  assert.match(await readFile(envFile, 'utf8'), /^PPR_REGISTRY=https:\/\/registry\.example\.test$/m);
  assert.match(await readFile(envFile, 'utf8'), /^PPR_STATE=.*ppr-tool-state.*state\.json$/m);
  assert.match(await readFile(pathFile, 'utf8'), /ppr-tool-bin/);
  const help = spawn(process.platform === 'win32' ? process.execPath : path.join(dir, 'ppr-tool-bin/ppr-tool'), process.platform === 'win32' ? [path.join(dir, 'ppr-tool-bin/ppr-tool.mjs'), '--help'] : ['--help']);
  assert.equal(await new Promise(resolve => help.on('exit', resolve)), 0);
});

test('pins an explicit version', async t => {
  const { url, requests } = await releases(t);
  const { code, output } = await run(t, { PPR_TOOL_RELEASES_URL: url, INPUT_VERSION: '0.1.0' });
  assert.equal(code, 0, output);
  assert.deepEqual(requests, ['/v0.1.0/SHA256SUMS', '/v0.1.0/ppr-tool.mjs']);
});

test('rejects a bundle whose checksum does not match and leaves nothing on PATH', async t => {
  const { url } = await releases(t, { tamper: true });
  const { dir, code, output, pathFile } = await run(t, { PPR_TOOL_RELEASES_URL: url });
  assert.equal(code, 1);
  assert.match(output, /does not match SHA256SUMS/);
  await assert.rejects(stat(path.join(dir, 'ppr-tool-bin/ppr-tool.mjs')));
  await assert.rejects(stat(pathFile));
});

test('rejects malformed versions and registries before downloading', async t => {
  const { url, requests } = await releases(t);
  assert.equal((await run(t, { PPR_TOOL_RELEASES_URL: url, INPUT_VERSION: '../evil' })).code, 1);
  assert.equal((await run(t, { PPR_TOOL_RELEASES_URL: url, INPUT_REGISTRY: 'https://user:pw@registry.example.test/path' })).code, 1);
  assert.deepEqual(requests, []);
});
