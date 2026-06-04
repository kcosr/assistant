import { build } from 'esbuild';

const variant = process.env.ASSISTANT_DESKTOP_VARIANT === 'work' ? 'work' : 'default';
const defaultBackendUrl =
  process.env.ASSISTANT_DESKTOP_DEFAULT_BACKEND_URL?.trim() ||
  (variant === 'work' ? 'https://assistant/assistant-work' : 'https://assistant');

await build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outdir: 'dist',
  external: ['electron'],
  define: {
    ASSISTANT_DESKTOP_VARIANT: JSON.stringify(variant),
    ASSISTANT_DESKTOP_DEFAULT_BACKEND_URL: JSON.stringify(defaultBackendUrl),
  },
});
