import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
await build({ absWorkingDir: root, entryPoints: ['src/action.ts'], outfile: 'dist/action.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node24', define: { ACTION_VERSION: JSON.stringify(version) } });
