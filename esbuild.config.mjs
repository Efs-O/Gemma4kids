import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'fs';

const mode = process.argv[2]; // 'main' | 'renderer' | undefined (both)

const buildMain = () =>
  esbuild.build({
    entryPoints: ['src/main/main.ts', 'src/main/preload.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    external: ['electron'],
    outdir: 'dist/main',
    sourcemap: true,
  });

const buildRenderer = () => {
  mkdirSync('dist/renderer', { recursive: true });
  copyFileSync('src/renderer/index.html', 'dist/renderer/index.html');
  copyFileSync('src/renderer/styles.css', 'dist/renderer/styles.css');
  return esbuild.build({
    entryPoints: ['src/renderer/index.tsx'],
    bundle: true,
    platform: 'browser',
    target: 'chrome114',
    jsx: 'automatic',
    outfile: 'dist/renderer/renderer.js',
    sourcemap: true,
  });
};

if (mode === 'main') {
  await buildMain();
} else if (mode === 'renderer') {
  await buildRenderer();
} else {
  await Promise.all([buildMain(), buildRenderer()]);
}
