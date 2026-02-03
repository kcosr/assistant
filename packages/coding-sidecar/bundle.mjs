#!/usr/bin/env node
// Bundle the coding-sidecar for standalone execution
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'dist/server.bundle.js',
  format: 'cjs',
  sourcemap: true,
  // Mark node built-ins as external
  external: [],
});

console.log('Bundle created: dist/server.bundle.js');
