import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const action = fileURLToPath(new URL('../dist/action.cjs', import.meta.url));
const platformBundle = await build({ entryPoints: [fileURLToPath(new URL('../src/platform.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
const { assetName, binaryName } = await import(`data:text/javascript;base64,${Buffer.from(platformBundle.outputFiles[0].text).toString('base64')}`);

// A real ppr-tool build (CI sets PPR_TOOL_TEST_BINARY) or a POSIX stand-in that answers --help.
const realBinary = process.env.PPR_TOOL_TEST_BINARY;
const binary = realBinary ? readFileSync(realBinary) : Buffer.from('#!/bin/sh\nif [ "$1" = "--help" ]; then echo "ppr-tool stub"; exit 0; fi\nexit 3\n');
const runnable = Boolean(realBinary) || process.platform !== 'win32';
const asset = assetName();
const sha256 = value => createHash('sha256').update(value).digest('hex');

async function releases(t, { tamper = false } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/latest/SHA256SUMS' || req.url === '/v0.0.1/SHA256SUMS') { res.end(`${sha256('other')}  ppr-tool-other\n${tamper ? 'a'.repeat(64) : sha256(binary)}  ${asset}\n`); return; }
    if (req.url === `/latest/${asset}`) { res.writeHead(302, { location: `/v0.0.1/${asset}` }); res.end(); return; }
    if (req.url === `/v0.0.1/${asset}`) { res.end(binary); return; }
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

test('maps runner platforms to release assets', () => {
  assert.equal(assetName('linux', 'x64'), 'ppr-tool-x86_64-unknown-linux-musl');
  assert.equal(assetName('linux', 'arm64'), 'ppr-tool-aarch64-unknown-linux-musl');
  assert.equal(assetName('darwin', 'x64'), 'ppr-tool-x86_64-apple-darwin');
  assert.equal(assetName('darwin', 'arm64'), 'ppr-tool-aarch64-apple-darwin');
  assert.equal(assetName('win32', 'x64'), 'ppr-tool-x86_64-pc-windows-msvc.exe');
  assert.throws(() => assetName('win32', 'arm64'), /Unsupported runner platform win32\/arm64/);
  assert.throws(() => assetName('freebsd', 'x64'), /Unsupported/);
  assert.equal(binaryName('win32'), 'ppr-tool.exe');
  assert.equal(binaryName('linux'), 'ppr-tool');
});

test('installs the released binary, verifies its checksum and exposes ppr-tool on PATH', async t => {
  const { url, requests } = await releases(t);
  const { dir, envFile, pathFile, code, output } = await run(t, { PPR_TOOL_RELEASES_URL: url });
  assert.equal(code, 0, output);
  assert.deepEqual(requests.slice(0, 2), ['/latest/SHA256SUMS', `/latest/${asset}`]);
  assert.match(output, new RegExp(`ppr-tool v0\\.0\\.1 \\(${asset.replaceAll('.', '\\.')}\\) ready`));
  assert.match(await readFile(envFile, 'utf8'), /^PPR_REGISTRY=https:\/\/registry\.example\.test$/m);
  assert.match(await readFile(envFile, 'utf8'), /^PPR_STATE=.*ppr-tool-state.*state\.json$/m);
  assert.match(await readFile(pathFile, 'utf8'), /ppr-tool-bin/);
  const installed = path.join(dir, 'ppr-tool-bin', binaryName());
  assert.deepEqual(await readFile(installed), binary);
  if (process.platform !== 'win32') assert.equal((await stat(installed)).mode & 0o111, 0o111, 'executable');
  if (!runnable) return t.diagnostic('no ppr-tool build for this platform; skipped running --help');
  const help = spawn(installed, ['--help']);
  assert.equal(await new Promise(resolve => help.on('exit', resolve)), 0);
});

test('pins an explicit version', async t => {
  const { url, requests } = await releases(t);
  const { code, output } = await run(t, { PPR_TOOL_RELEASES_URL: url, INPUT_VERSION: '0.0.1' });
  assert.equal(code, 0, output);
  assert.deepEqual(requests, ['/v0.0.1/SHA256SUMS', `/v0.0.1/${asset}`]);
});

test('rejects a binary whose checksum does not match and leaves nothing on PATH', async t => {
  const { url } = await releases(t, { tamper: true });
  const { dir, code, output, pathFile } = await run(t, { PPR_TOOL_RELEASES_URL: url });
  assert.equal(code, 1);
  assert.match(output, /does not match SHA256SUMS/);
  await assert.rejects(stat(path.join(dir, 'ppr-tool-bin', binaryName())));
  await assert.rejects(stat(pathFile));
});

test('rejects malformed versions and registries before downloading', async t => {
  const { url, requests } = await releases(t);
  assert.equal((await run(t, { PPR_TOOL_RELEASES_URL: url, INPUT_VERSION: '../evil' })).code, 1);
  assert.equal((await run(t, { PPR_TOOL_RELEASES_URL: url, INPUT_REGISTRY: 'https://user:pw@registry.example.test/path' })).code, 1);
  assert.deepEqual(requests, []);
});
