import { mkdir, chmod, appendFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

declare const ACTION_VERSION: string;
const RELEASES = 'https://github.com/private-package-registry/ppr-tool/releases';
const BUNDLE = 'ppr-tool.mjs';
const SUMS = 'SHA256SUMS';

// Same origin rules as registryUrl() in ppr-tool (tool/src/client.ts); the CLI validates again at stage time.
function registryUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Registry must be an origin without credentials, path or query');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Registry requires HTTPS');
  return url.origin;
}

function releaseBase(version: string): string {
  const override = process.env.PPR_TOOL_RELEASES_URL;
  const requested = version.trim() || 'latest';
  let tag = 'latest';
  if (requested !== 'latest') {
    const match = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(requested);
    if (!match) throw new Error(`Invalid ppr-tool version "${requested}": use latest or a release tag such as v0.1.0`);
    tag = `v${match[1]}`;
  }
  if (override) {
    const base = new URL(override);
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) throw new Error('PPR_TOOL_RELEASES_URL requires HTTPS');
    return new URL(`${tag}/`, base.href.endsWith('/') ? base.href : base.href + '/').href;
  }
  return tag === 'latest' ? `${RELEASES}/latest/download/` : `${RELEASES}/download/${tag}/`;
}

async function download(url: string): Promise<{ body: Buffer; finalUrl: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000), headers: { 'user-agent': `setup-ppr-tool-action/${ACTION_VERSION}` } });
      if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw Object.assign(new Error(`Download of ${url} failed with HTTP ${response.status}`), { fatal: true });
      return { body: Buffer.from(await response.arrayBuffer()), finalUrl: response.url };
    } catch (error) {
      if ((error as { fatal?: boolean }).fatal) throw error;
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw new Error(`Download of ${url} failed: ${lastError instanceof Error ? lastError.message : 'network error'}`);
}

function expectedDigest(sums: string): string {
  for (const line of sums.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (match && match[2] === BUNDLE) return match[1];
  }
  throw new Error(`${SUMS} has no entry for ${BUNDLE}`);
}

async function main() {
  const registry = registryUrl(process.env.INPUT_REGISTRY || '');
  const temp = process.env.RUNNER_TEMP;
  if (!temp || !process.env.GITHUB_PATH || !process.env.GITHUB_ENV) throw new Error('GitHub Actions runner environment is required');
  const base = releaseBase(process.env.INPUT_VERSION || 'latest');
  const sums = await download(base + SUMS);
  const digest = expectedDigest(sums.body.toString('utf8'));
  const bundle = await download(base + BUNDLE);
  const actual = createHash('sha256').update(bundle.body).digest('hex');
  if (actual !== digest) throw new Error(`ppr-tool download does not match ${SUMS} (expected ${digest}, got ${actual})`);
  const resolved = /\/(v\d[^/]*)\/[^/]*$/.exec(bundle.finalUrl)?.[1] ?? 'latest';

  const directory = path.join(temp, 'ppr-tool-bin');
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, BUNDLE), bundle.body, { mode: 0o755 });
  if (process.platform === 'win32') {
    await writeFile(path.join(directory, 'ppr-tool.cmd'), `@"${process.execPath}" "%~dp0${BUNDLE}" %*\r\n`);
  } else {
    const nodePath = process.execPath.replaceAll("'", "'\\''");
    await writeFile(path.join(directory, 'ppr-tool'), `#!/bin/sh\nexec '${nodePath}' "$(dirname "$0")/${BUNDLE}" "$@"\n`, { mode: 0o755 });
    await chmod(path.join(directory, 'ppr-tool'), 0o755);
  }
  await appendFile(process.env.GITHUB_PATH, directory + '\n');
  await appendFile(process.env.GITHUB_ENV, `PPR_REGISTRY=${registry}\nPPR_STATE=${path.join(temp, 'ppr-tool-state', 'state.json')}\n`);
  console.log(`ppr-tool ${resolved} ready (sha256 ${actual}). OIDC will be requested when staging.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Setup failed'); process.exitCode = 1; });
