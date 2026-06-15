// Test runner: bundles tests/*.test.ts with esbuild (already a dependency) into
// dist-tests/, then runs them with Node's built-in test runner. No new npm deps.
import esbuild from 'esbuild';
import { readdirSync, existsSync, rmSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = path.join(root, 'tests');
const outDir = path.join(root, 'dist-tests');

if (!existsSync(testsDir)) {
  console.error('No tests/ directory found.');
  process.exit(1);
}

const entryPoints = readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => path.join(testsDir, f));

if (entryPoints.length === 0) {
  console.error('No *.test.ts files found in tests/.');
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });

await esbuild.build({
  entryPoints,
  outdir: outDir,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  sourcemap: 'inline',
  target: 'node18',
  logLevel: 'warning',
});

const builtTests = readdirSync(outDir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => path.join(outDir, f));

const result = spawnSync(process.execPath, ['--test', ...builtTests], { stdio: 'inherit' });
process.exit(result.status ?? 1);
